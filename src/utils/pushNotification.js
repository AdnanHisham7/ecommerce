const axios = require('axios');
const env = require('../config/env');
const logger = require('./logger');

const ONESIGNAL_API = 'https://onesignal.com/api/v1/notifications';

/**
 * Base OneSignal sender
 */
const sendOneSignal = async (payload) => {
  if (!env.oneSignal.appId || !env.oneSignal.apiKey) {
    logger.warn('OneSignal not configured – skipping push notification');
    return null;
  }

  try {
    const response = await axios.post(
      ONESIGNAL_API,
      { app_id: env.oneSignal.appId, ...payload },
      {
        headers: {
          Authorization: `Basic ${env.oneSignal.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`OneSignal notification sent: ${response.data.id}`);
    return response.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error('OneSignal push failed:', detail);
    return null;
  }
};

// ─── Targeting helpers ──────────────────────────────────────────────────────

/**
 * Send to specific OneSignal external user IDs (mapped to our user _id strings)
 */
const pushToUser = (userId, heading, content, data = {}) =>
  sendOneSignal({
    headings: { en: heading },
    contents: { en: content },
    include_external_user_ids: [userId.toString()],
    channel_for_external_user_ids: 'push',
    data,
  });

/**
 * Send to multiple users
 */
const pushToUsers = (userIds, heading, content, data = {}) =>
  sendOneSignal({
    headings: { en: heading },
    contents: { en: content },
    include_external_user_ids: userIds.map(String),
    channel_for_external_user_ids: 'push',
    data,
  });

/**
 * Send to ALL subscribed users (broadcast)
 */
const pushToAll = (heading, content, data = {}) =>
  sendOneSignal({
    headings: { en: heading },
    contents: { en: content },
    included_segments: ['All'],
    data,
  });

/**
 * Send to a OneSignal segment
 */
const pushToSegment = (segment, heading, content, data = {}) =>
  sendOneSignal({
    headings: { en: heading },
    contents: { en: content },
    included_segments: [segment],
    data,
  });

// ─── Pre-built notification templates ────────────────────────────────────────

const pushTemplates = {
  /** User's order status changed */
  orderStatus: (userId, orderNumber, status, orderId) =>
    pushToUser(
      userId,
      `Order ${statusLabel(status)}`,
      `Your order #${orderNumber} is now ${statusLabel(status)}.`,
      { type: 'order_status', orderId: orderId.toString(), url: `/orders/${orderId}` }
    ),

  /** Order confirmed right after placement */
  orderConfirmed: (userId, orderNumber, orderId) =>
    pushToUser(
      userId,
      '🎉 Order Confirmed!',
      `Your order #${orderNumber} has been placed successfully.`,
      { type: 'order_confirmed', orderId: orderId.toString(), url: `/orders/${orderId}` }
    ),

  /** Wallet credit */
  walletCredit: (userId, amount, reason) =>
    pushToUser(
      userId,
      '💰 Wallet Credited',
      `₹${amount} added to your wallet${reason ? ': ' + reason : ''}.`,
      { type: 'wallet_credit', url: '/profile/wallet' }
    ),

  /** New offer published – broadcast */
  newOffer: (offerName, discountText) =>
    pushToAll(
      '🔥 New Offer!',
      `${offerName} – ${discountText}. Shop now!`,
      { type: 'offer', url: '/offers' }
    ),

  /** New coupon broadcast */
  newCoupon: (code, description) =>
    pushToAll(
      '🎟️ New Coupon Available',
      `Use code ${code}${description ? ' – ' + description : ''} for a discount!`,
      { type: 'coupon', url: '/offers' }
    ),

  /** Account blocked */
  accountBlocked: (userId) =>
    pushToUser(
      userId,
      '⚠️ Account Suspended',
      'Your account has been temporarily suspended. Contact support for help.',
      { type: 'account_blocked', url: '/support' }
    ),

  /** Account unblocked */
  accountUnblocked: (userId) =>
    pushToUser(
      userId,
      '✅ Account Reinstated',
      'Your account has been reinstated. Welcome back!',
      { type: 'account_unblocked', url: '/' }
    ),

  /** Referral bonus earned */
  referralBonus: (userId, amount) =>
    pushToUser(
      userId,
      '🎁 Referral Bonus Earned!',
      `₹${amount} has been credited to your wallet for a successful referral.`,
      { type: 'referral_bonus', url: '/profile/wallet' }
    ),

  /** Return approved */
  returnApproved: (userId, orderNumber, amount) =>
    pushToUser(
      userId,
      '✅ Return Approved',
      `Your return for order #${orderNumber} is approved. ₹${amount} will be refunded.`,
      { type: 'return_approved' }
    ),

  /** New order placed – notify admin room via socket (not OneSignal) */
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(status) {
  const labels = {
    confirmed: 'Confirmed ✅',
    packed: 'Packed 📦',
    dispatched: 'Dispatched 🚚',
    delivered: 'Delivered 🎉',
    cancelled: 'Cancelled ❌',
    returned: 'Returned ↩️',
    refunded: 'Refunded 💰',
  };
  return labels[status] || status;
}

module.exports = {
  sendOneSignal,
  pushToUser,
  pushToUsers,
  pushToAll,
  pushToSegment,
  pushTemplates,
};