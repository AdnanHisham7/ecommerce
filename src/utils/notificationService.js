/**
 * Unified Notification Service
 * Handles: in-app (DB), socket.io real-time, email, OneSignal push
 *
 * Usage:
 *   await notify.orderStatus(user, order, newStatus);
 *   await notify.newOffer(offerName, discountText);
 */

const User = require('../modules/users/user.model');
const { sendEmail, emailTemplates } = require('./email');
const { pushTemplates, pushToAll } = require('./pushNotification');
const logger = require('./logger');
const env = require('../config/env');

// Get socket.io instance safely
const getIO = () => global.io || null;

// ─── Low-level helpers ────────────────────────────────────────────────────────

/**
 * Save an in-app notification to a user document and emit via socket
 */
const saveInApp = async (userId, type, message, link = '') => {
  try {
    await User.findByIdAndUpdate(userId, {
      $push: {
        notifications: {
          $each: [{ type, message, link, isRead: false, createdAt: new Date() }],
          $position: 0,
          $slice: 100, // keep last 100
        },
      },
    });

    const io = getIO();
    if (io) {
      io.to(`user_${userId}`).emit('notification', { type, message, link });
    }
  } catch (err) {
    logger.error('saveInApp error:', err.message);
  }
};

/**
 * Emit a real-time event to the admin room
 */
const notifyAdmin = (event, data) => {
  const io = getIO();
  if (io) io.to('admin_room').emit(event, data);
};

/**
 * Try to send an email silently (never throw)
 */
const tryEmail = async (to, template) => {
  try {
    await sendEmail({ to, ...template });
  } catch (err) {
    logger.error(`Email to ${to} failed: ${err.message}`);
  }
};

/**
 * Try to send a OneSignal push silently
 */
const tryPush = async (fn) => {
  try {
    await fn();
  } catch (err) {
    logger.error('Push notification error:', err.message);
  }
};

// ─── Notification Events ──────────────────────────────────────────────────────

const notify = {
  /**
   * Order placed – notify customer (email + in-app + push) and admin (socket)
   */
  async orderPlaced(user, order) {
    const userId = user._id;

    // In-app
    await saveInApp(
      userId,
      'order',
      `Your order #${order.orderNumber} has been placed successfully!`,
      `/orders/${order._id}`
    );

    // Email
    await tryEmail(user.email, emailTemplates.orderConfirmation(user.name, order));

    // Push
    await tryPush(() => pushTemplates.orderConfirmed(userId, order.orderNumber, order._id));

    // Admin real-time
    notifyAdmin('new_order', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      userName: user.name,
      amount: order.totalAmount,
      createdAt: order.createdAt || new Date(),
    });
  },

  /**
   * Order status changed by admin
   */
  async orderStatus(user, order, newStatus) {
    const userId = user._id || user;

    // In-app
    await saveInApp(
      userId,
      'order',
      `Your order #${order.orderNumber} is now ${_statusLabel(newStatus)}.`,
      `/orders/${order._id}`
    );

    // Email
    await tryEmail(
      user.email,
      emailTemplates.orderStatusUpdate
        ? emailTemplates.orderStatusUpdate(user.name, order, newStatus)
        : _fallbackOrderStatusEmail(user.name, order, newStatus)
    );

    // Push
    await tryPush(() =>
      pushTemplates.orderStatus(userId, order.orderNumber, newStatus, order._id)
    );
  },

  /**
   * Order cancelled
   */
  async orderCancelled(user, order, refundAmount = 0) {
    const userId = user._id || user;

    await saveInApp(
      userId,
      'order',
      `Your order #${order.orderNumber} has been cancelled.${refundAmount > 0 ? ` ₹${refundAmount} refunded to wallet.` : ''}`,
      `/orders/${order._id}`
    );

    await tryPush(() =>
      pushTemplates.orderStatus(userId, order.orderNumber, 'cancelled', order._id)
    );
  },

  /**
   * Return status changed
   */
  async returnStatus(user, order, status, refundAmount = 0) {
    const userId = user._id || user;

    let message = `Return request for order #${order.orderNumber}: ${status}.`;
    if (status === 'approved' && refundAmount > 0) {
      message += ` ₹${refundAmount} will be refunded.`;
    }

    await saveInApp(userId, 'order', message, `/orders/${order._id}`);

    if (status === 'approved') {
      await tryPush(() =>
        pushTemplates.returnApproved(userId, order.orderNumber, refundAmount)
      );
    }
  },

  /**
   * Wallet credited
   */
  async walletCredit(user, amount, reason = '') {
    const userId = user._id || user;

    await saveInApp(
      userId,
      'payment',
      `₹${amount} added to your wallet${reason ? ': ' + reason : ''}.`,
      '/profile/wallet'
    );

    await tryPush(() => pushTemplates.walletCredit(userId, amount, reason));
  },

  /**
   * New offer published – broadcast to all users
   */
  async newOffer(offerName, discountText) {
    // Push to all subscribers
    await tryPush(() => pushTemplates.newOffer(offerName, discountText));

    // Socket broadcast (all connected clients)
    const io = getIO();
    if (io) {
      io.emit('new_offer', { offerName, discountText });
    }
  },

  /**
   * New coupon added – broadcast
   */
  async newCoupon(code, description) {
    await tryPush(() => pushTemplates.newCoupon(code, description));

    const io = getIO();
    if (io) io.emit('new_coupon', { code, description });
  },

  /**
   * User account blocked/unblocked
   */
  async accountBlocked(user) {
    const userId = user._id || user;
    await saveInApp(
      userId,
      'system',
      'Your account has been suspended. Please contact support.',
      '/support'
    );
    await tryPush(() => pushTemplates.accountBlocked(userId));
  },

  async accountUnblocked(user) {
    const userId = user._id || user;
    await saveInApp(
      userId,
      'system',
      'Your account has been reinstated. Welcome back!',
      '/'
    );
    await tryPush(() => pushTemplates.accountUnblocked(userId));
  },

  /**
   * Referral bonus
   */
  async referralBonus(user, amount) {
    const userId = user._id || user;

    await saveInApp(
      userId,
      'referral',
      `You earned ₹${amount} referral bonus! Added to your wallet.`,
      '/profile/wallet'
    );

    await tryEmail(
      user.email,
      emailTemplates.referralBonus(user.name, amount, user.referralCode)
    );

    await tryPush(() => pushTemplates.referralBonus(userId, amount));
  },

  /**
   * System/promo broadcast to all users
   */
  async broadcast(heading, message, link = '') {
    await tryPush(() =>
      pushToAll(heading, message, link ? { url: link } : {})
    );

    const io = getIO();
    if (io) io.emit('broadcast', { heading, message, link });
  },

  /**
   * Stock alert to admin
   */
  stockAlert(productName, stock) {
    notifyAdmin('stock_alert', { productName, stock });
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _statusLabel(status) {
  const m = {
    confirmed: 'Confirmed',
    packed: 'Packed',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    returned: 'Returned',
    refunded: 'Refunded',
  };
  return m[status] || status;
}

function _fallbackOrderStatusEmail(name, order, status) {
  const statusColors = {
    confirmed: '#16a34a',
    packed: '#7c3aed',
    dispatched: '#0891b2',
    delivered: '#16a34a',
    cancelled: '#dc2626',
    returned: '#d97706',
    refunded: '#6b7280',
  };
  const color = statusColors[status] || '#6b7280';

  return {
    subject: `Order #${order.orderNumber} Update – ${_statusLabel(status)} | ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img src="${env.app.logoPublicUrl}" alt="${env.app.name}" width="64" height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;" />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">${env.app.name}</h1>
        </div>
        <div style="padding:40px;">
          <h2 style="color:#333;">Order Status Update</h2>
          <p style="color:#666;">Hi ${name}, your order status has been updated.</p>
          <div style="background:#f8f8f8;border-left:4px solid ${color};border-radius:4px;padding:20px;margin:20px 0;">
            <p style="margin:0;color:#333;"><strong>Order:</strong> #${order.orderNumber}</p>
            <p style="margin:8px 0 0;color:#333;">
              <strong>Status:</strong>
              <span style="color:${color};font-weight:bold;">${_statusLabel(status)}</span>
            </p>
            ${order.trackingNumber ? `<p style="margin:8px 0 0;color:#333;"><strong>Tracking #:</strong> ${order.trackingNumber}</p>` : ''}
          </div>
          <a href="${env.app.url}/orders/${order._id}"
            style="display:inline-block;background:linear-gradient(135deg,#f0a500,#e09400);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;margin-top:10px;">
            View Order →
          </a>
        </div>
        <div style="background:#f8f8f8;padding:20px;text-align:center;">
          <p style="color:#999;font-size:12px;margin:0;">© ${new Date().getFullYear()} ${env.app.name}. All rights reserved.</p>
        </div>
      </div></body></html>
    `,
  };
}

module.exports = notify;