const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('./order.model');
const Cart = require('../cart/cart.model');
const Product = require('../products/product.model');
const Coupon = require('../coupons/coupon.model');
const User = require('../users/user.model');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendEmail, emailTemplates } = require('../../utils/email');
const notify = require('../../utils/notificationService');
const { generateInvoice } = require('../../utils/pdfGenerator');
const generateOrderNumber = require('../../utils/generateOrderNumber');
const env = require('../../config/env');
const Setting = require('../settings/settings.model');
const guestCart = require('../../utils/guestCart');

const razorpay = new Razorpay({
  key_id: env.razorpay.keyId,
  key_secret: env.razorpay.keySecret,
});
// Shipping threshold/cost are admin-configurable (Setting.getCommerceSettings());
// they are fetched fresh on every request rather than cached as module constants.

// ============ CHECKOUT PAGE ============
const getCheckoutPage = asyncHandler(async (req, res) => {
  const commerce = await Setting.getCommerceSettings();
  const SHIPPING_FREE_THRESHOLD = commerce.freeShippingThreshold;
  const SHIPPING_CHARGE = commerce.shippingCost;

  const cart = await Cart.findOne({ user: req.session?.userId })
    .populate({
      path: 'items.product',
      select: 'name images basePrice discountedPrice stockStatus stock colorVariants sizeVariants variants variantType isActive',
    })
    .lean();

  if (!cart || cart.items.length === 0) {
    req.flash('error', 'Your cart is empty');
    return res.redirect('/cart');
  }

  // Validate stock for each cart item
  for (const item of cart.items) {
    if (!item.product || !item.product.isActive) {
      req.flash('error', `${item.product?.name || 'A product'} is no longer available`);
      return res.redirect('/cart');
    }

    let availableStock = 0;
    if (item.variant?.variantId) {
      const skuVariant = item.product.variants?.find(
        (v) => v._id.toString() === item.variant.variantId.toString()
      );
      availableStock = skuVariant?.stock || 0;
    } else {
      availableStock = item.product.stock || 0;
    }

    if (availableStock < item.quantity) {
      req.flash('error', `Insufficient stock for ${item.product.name}`);
      return res.redirect('/cart');
    }
  }

  const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingCharge = subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const couponDiscount = cart.couponDiscount || 0;
  const total = subtotal + shippingCharge - couponDiscount;

  const user = await User.findById(req.session?.userId);

  res.render('user/checkout', {
    title: 'Checkout',
    cart,
    subtotal,
    shippingCharge,
    couponDiscount,
    total,
    addresses: user.addresses || [],
    walletBalance: user.walletBalance || 0,
    razorpayKeyId: env.razorpay.keyId,
    currentUser: user,
  });
});

// ============ SHARED: deduct stock & clear cart (called after confirmed payment) ============
async function finalizeOrder(order, cart, user) {
  // Deduct stock
  for (const item of order.items) {
    const product = await Product.findById(item.product);
    if (product) {
      if (item.variant?.variantId) {
        const skuVariant = product.variants.id(item.variant.variantId);
        if (skuVariant) {
          skuVariant.stock = Math.max(0, skuVariant.stock - item.quantity);
        }
      } else {
        product.stock = Math.max(0, product.stock - item.quantity);
      }
      product.salesCount = (product.salesCount || 0) + item.quantity;
      await product.save();
    }
  }

  // Clear cart
  if (cart) {
    cart.items = [];
    cart.couponCode = undefined;
    cart.couponDiscount = 0;
    cart.appliedCoupon = undefined;
    await cart.save();
  }
}

// ============ WALLET DEDUCTION HELPER ============
// Safely deducts wallet amount — prevents negative balance and double-deduction.
// Returns the actual amount deducted (may be 0 if balance insufficient).
async function deductWallet(user, amount, description, orderId) {
  // Re-fetch user to get latest balance (prevents race conditions)
  const freshUser = await User.findById(user._id);
  if (!freshUser || freshUser.walletBalance <= 0) return 0;

  const toDeduct = Math.min(freshUser.walletBalance, amount);
  if (toDeduct <= 0) return 0;

  // Atomic: prevent balance going below 0
  const newBalance = parseFloat((freshUser.walletBalance - toDeduct).toFixed(2));
  if (newBalance < 0) return 0;

  freshUser.walletBalance = newBalance;
  freshUser.walletTransactions.push({
    type: 'debit',
    amount: toDeduct,
    description,
    orderId,
    balanceAfter: newBalance,
  });
  await freshUser.save();

  // Keep the in-memory user object in sync
  user.walletBalance = freshUser.walletBalance;
  user.walletTransactions = freshUser.walletTransactions;

  return toDeduct;
}

// ============ PLACE ORDER ============
const placeOrder = asyncHandler(async (req, res) => {
  const { addressId, paymentMethod, useWallet, walletAmount, newAddress } = req.body;

  const commerce = await Setting.getCommerceSettings();
  const SHIPPING_FREE_THRESHOLD = commerce.freeShippingThreshold;
  const SHIPPING_CHARGE = commerce.shippingCost;

  const user = await User.findById(req.session?.userId);
  const cart = await Cart.findOne({ user: user._id }).populate({
    path: 'items.product',
    select: 'name images basePrice discountedPrice stock colorVariants sizeVariants variants variantType stockStatus isActive',
  });

  if (!cart || cart.items.length === 0) throw ApiError.badRequest('Cart is empty');

  // STOCK VALIDATION ON ORDER PLACEMENT
  for (const item of cart.items) {
    if (!item.product || !item.product.isActive) {
      throw ApiError.badRequest(`${item.product?.name || 'An item in your cart'} is no longer available`);
    }

    let availableStock = 0;
    if (item.variant?.variantId) {
      const skuVariant = item.product.variants?.find(
        (v) => v._id.toString() === item.variant.variantId.toString()
      );
      availableStock = skuVariant?.stock || 0;
    } else {
      availableStock = item.product.stock || 0;
    }

    if (availableStock < item.quantity) {
      throw ApiError.badRequest(
        `Insufficient stock for ${item.product.name}. Only ${availableStock} left, but you have ${item.quantity} in your cart.`
      );
    }
  }

  // ---- Resolve shipping address ----
  let shippingAddress;
  if (addressId && addressId !== 'new') {
    shippingAddress = user.addresses.id(addressId);
    if (!shippingAddress) throw ApiError.badRequest('Address not found');
  } else if (newAddress) {
    const addr = JSON.parse(newAddress);
    user.addresses.push(addr);
    await user.save();
    shippingAddress = user.addresses[user.addresses.length - 1];
  } else {
    throw ApiError.badRequest('Please provide a shipping address');
  }

  // ---- Calculate totals ----
  const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingCharge = subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const couponDiscount = cart.couponDiscount || 0;
  let totalAmount = subtotal + shippingCharge - couponDiscount;

  // ---- Wallet deduction pre-calculation (validation only, not deducted yet) ----
  let walletAmountUsed = 0;
  const wantsWallet = useWallet === 'true';

  if (wantsWallet && user.walletBalance > 0) {
    // How much wallet to apply: min(balance, order total, requested amount)
    const requested = parseFloat(walletAmount) || user.walletBalance;
    walletAmountUsed = parseFloat(
      Math.min(user.walletBalance, totalAmount, requested).toFixed(2)
    );
    totalAmount = parseFloat((totalAmount - walletAmountUsed).toFixed(2));
  }

  // ---- Wallet-only payment: full balance check ----
  if (paymentMethod === 'wallet') {
    // Wallet-only means the ENTIRE remaining total (after any wallet contribution) must be 0
    // i.e. walletAmountUsed must cover the full order total
    const fullOrderTotal = subtotal + shippingCharge - couponDiscount;
    if (user.walletBalance < fullOrderTotal) {
      throw ApiError.badRequest(
        `Insufficient wallet balance. Your balance is ₹${user.walletBalance.toFixed(2)} but order total is ₹${fullOrderTotal.toFixed(2)}.`
      );
    }
    // Force wallet to cover full amount
    walletAmountUsed = parseFloat(fullOrderTotal.toFixed(2));
    totalAmount = 0;
  }

  // ---- Build order items ----
  const orderItems = cart.items.map((item) => {
    let productImage = item.product.images?.[0]?.url || item.product.thumbnail;
    if (item.variant?.colorId) {
      const colorVariant = item.product.colorVariants?.find(
        (c) => c._id.toString() === item.variant.colorId.toString()
      );
      if (colorVariant?.images?.[0]?.url) productImage = colorVariant.images[0].url;
    } else if (!productImage && (item.product.variantType === 'color' || item.product.variantType === 'color_size')) {
      const firstActiveColor = (item.product.colorVariants || []).find(cv => cv.isActive && cv.images?.length);
      if (firstActiveColor) productImage = firstActiveColor.images[0].url;
    }

    return {
      product: item.product._id,
      productName: item.product.name,
      productImage,
      variant: item.variant
        ? {
            variantId:    item.variant.variantId,
            colorId:      item.variant.colorId,
            sizeId:       item.variant.sizeId,
            color:        item.variant.color,
            colorHex:     item.variant.colorHex,
            size:         item.variant.size,
            sku:          item.variant.sku,
            variantImage: item.variant.variantImage,
          }
        : null,
      quantity: item.quantity,
      price: item.price,
      originalPrice: item.product.basePrice,
    };
  });

  // ---- Create order record ----
  // NOTE for Razorpay: order is created here but cart is NOT cleared and stock is NOT deducted yet.
  // That only happens in verifyPayment (on successful payment).
  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    user: user._id,
    items: orderItems,
    shippingAddress: {
      fullName:     shippingAddress.fullName,
      phone:        shippingAddress.phone,
      addressLine1: shippingAddress.addressLine1,
      addressLine2: shippingAddress.addressLine2,
      city:         shippingAddress.city,
      state:        shippingAddress.state,
      pincode:      shippingAddress.pincode,
      country:      shippingAddress.country,
    },
    subtotal,
    discountAmount: 0,
    couponDiscount,
    shippingCharge,
    walletAmountUsed,
    totalAmount,
    couponCode:    cart.couponCode,
    appliedCoupon: cart.appliedCoupon,
    paymentMethod,
    paymentStatus: 'pending',
    orderStatus:   'pending',
    trackingHistory: [{ status: 'pending', message: 'Order initiated' }],
  });

  // ---- COD: finalize immediately ----
  if (paymentMethod === 'cod') {
    // Deduct wallet if used (safe deduction)
    if (walletAmountUsed > 0) {
      const actualDeducted = await deductWallet(
        user,
        walletAmountUsed,
        `Wallet payment for order #${order.orderNumber}`,
        order._id
      );
      // Update order record if actual deduction differs (balance changed)
      if (actualDeducted !== walletAmountUsed) {
        order.walletAmountUsed = actualDeducted;
        order.totalAmount = parseFloat(
          (subtotal + shippingCharge - couponDiscount - actualDeducted).toFixed(2)
        );
      }
    }
    // Update coupon usage
    if (cart.appliedCoupon) {
      await Coupon.findByIdAndUpdate(cart.appliedCoupon, {
        $inc: { usedCount: 1 },
        $push: { usedBy: { user: user._id, orderId: order._id } },
      });
    }
    // Finalize: deduct stock + clear cart
    await finalizeOrder(order, cart, user);

    order.paymentStatus = 'pending';
    order.orderStatus   = 'confirmed';
    order.trackingHistory.push({ status: 'confirmed', message: 'Order confirmed - Cash on Delivery' });
    await order.save();

    // Notify customer (email + in-app + push) + admin socket
    await notify.orderPlaced(user, order);

    return res.json({ success: true, redirectUrl: `/orders/success/${order._id}` });
  }

  // ---- Wallet only: full payment from wallet ----
  if (paymentMethod === 'wallet') {
    // Double-check balance before deducting (race condition safety)
    const freshUser = await User.findById(user._id);
    const fullOrderTotal = subtotal + shippingCharge - couponDiscount;
    if (freshUser.walletBalance < fullOrderTotal) {
      // Clean up the order we just created
      await Order.findByIdAndDelete(order._id);
      throw ApiError.badRequest(
        `Insufficient wallet balance. Your balance is ₹${freshUser.walletBalance.toFixed(2)} but order total is ₹${fullOrderTotal.toFixed(2)}.`
      );
    }

    const actualDeducted = await deductWallet(
      freshUser,
      fullOrderTotal,
      `Full wallet payment for order #${order.orderNumber}`,
      order._id
    );

    if (cart.appliedCoupon) {
      await Coupon.findByIdAndUpdate(cart.appliedCoupon, {
        $inc: { usedCount: 1 },
        $push: { usedBy: { user: user._id, orderId: order._id } },
      });
    }
    await finalizeOrder(order, cart, freshUser);

    order.walletAmountUsed = actualDeducted;
    order.totalAmount      = 0;
    order.paymentStatus    = 'paid';
    order.paidAt           = new Date();
    order.orderStatus      = 'confirmed';
    order.trackingHistory.push({ status: 'confirmed', message: 'Order confirmed - Paid via Wallet' });
    await order.save();
    return res.json({ success: true, redirectUrl: `/orders/success/${order._id}` });
  }

  // ---- Razorpay: create payment order, return to frontend ----
  // Cart and stock are NOT touched here. They will be handled in verifyPayment.
  if (paymentMethod === 'razorpay') {
    // totalAmount here is the amount after any wallet contribution
    const razorpayAmount = Math.max(1, Math.round(totalAmount * 100)); // at least 1 paisa
    const razorpayOrder = await razorpay.orders.create({
      amount: razorpayAmount,
      currency: 'INR',
      receipt: order._id.toString(),
      notes: { orderId: order._id.toString(), userId: user._id.toString() },
    });

    order.razorpayOrderId       = razorpayOrder.id;
    order.razorpayPaymentStatus = 'created';
    await order.save();

    return res.json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: env.razorpay.keyId,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      orderId: order._id,
    });
  }

  throw ApiError.badRequest('Invalid payment method');
});

// ============ VERIFY RAZORPAY PAYMENT ============
const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

  const order = await Order.findOne({ _id: orderId, user: req.session?.userId });
  if (!order) throw ApiError.notFound('Order not found');

  // Don't double-process
  if (order.paymentStatus === 'paid') {
    return res.json({ success: true, redirectUrl: `/orders/success/${order._id}` });
  }

  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    order.paymentStatus         = 'failed';
    order.razorpayPaymentStatus = 'failed';
    order.trackingHistory.push({ status: 'pending', message: 'Payment verification failed - signature mismatch' });
    await order.save();
    return res.json({ success: false, message: 'Payment verification failed. Please retry.', orderId: order._id });
  }

  // Payment is genuine — now finalize: deduct stock, clear cart, update coupon
  const user = await User.findById(order.user);
  const cart = await Cart.findOne({ user: order.user });

  // Deduct wallet if used (safe deduction — only on first successful verification)
  if (order.walletAmountUsed > 0) {
    await deductWallet(
      user,
      order.walletAmountUsed,
      `Wallet contribution for order #${order.orderNumber}`,
      order._id
    );
  }

  // Update coupon usage
  if (order.appliedCoupon) {
    await Coupon.findByIdAndUpdate(order.appliedCoupon, {
      $inc: { usedCount: 1 },
      $push: { usedBy: { user: order.user, orderId: order._id } },
    });
  }

  // Deduct stock and clear cart
  await finalizeOrder(order, cart, user);

  order.paymentStatus         = 'paid';
  order.paidAt                = new Date();
  order.orderStatus           = 'confirmed';
  order.razorpayPaymentId     = razorpayPaymentId;
  order.razorpayOrderId       = razorpayOrderId;
  order.razorpaySignature     = razorpaySignature;
  order.razorpayPaymentStatus = 'captured';
  order.trackingHistory.push({ status: 'confirmed', message: 'Payment confirmed via Razorpay' });
  await order.save();

  // Notify customer (email + in-app + push) and admin socket
  const userForNotif = await User.findById(order.user);
  if (userForNotif) await notify.orderPlaced(userForNotif, order);

  res.json({ success: true, redirectUrl: `/orders/success/${order._id}` });
});

// ============ FAIL PAYMENT (called from frontend on dismiss / payment.failed event) ============
const failPayment = asyncHandler(async (req, res) => {
  const { orderId, reason } = req.body;
  if (!orderId) return res.json({ success: false });

  const order = await Order.findOne({ _id: orderId, user: req.session?.userId });
  if (!order) return res.json({ success: false });

  // Only mark failed if still pending (not already paid)
  if (order.paymentStatus === 'pending') {
    order.paymentStatus         = 'failed';
    order.razorpayPaymentStatus = 'failed';
    order.trackingHistory.push({ status: 'pending', message: reason || 'Payment was not completed' });
    await order.save();
  }

  res.json({ success: true, orderId: order._id });
});

// ============ RETRY PAYMENT ============
const retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.session?.userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentStatus !== 'failed') throw ApiError.badRequest('Payment retry not available for this order');

  // Create a fresh Razorpay order for the same amount
  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(order.totalAmount * 100),
    currency: 'INR',
    receipt: order._id.toString(),
    notes: { orderId: order._id.toString(), userId: order.user.toString() },
  });

  order.razorpayOrderId       = razorpayOrder.id;
  order.razorpayPaymentId     = undefined;
  order.razorpaySignature     = undefined;
  order.razorpayPaymentStatus = 'created';
  order.paymentStatus         = 'pending';
  order.trackingHistory.push({ status: 'pending', message: 'Payment retry initiated' });
  await order.save();

  res.json({
    success: true,
    razorpayOrderId: razorpayOrder.id,
    razorpayKeyId: env.razorpay.keyId,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency || 'INR',
    orderId: order._id,
  });
});

// ============ RAZORPAY WEBHOOK ============
const razorpayWebhook = asyncHandler(async (req, res) => {
  const webhookSecret = env.razorpay.webhookSecret;
  if (webhookSecret) {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expectedSignature) return res.status(400).send('Invalid signature');
  }

  const event = req.body;
  switch (event.event) {
    case 'payment.captured': {
      const payment = event.payload.payment.entity;
      const orderId = payment.notes?.orderId;
      if (orderId) {
        const order = await Order.findById(orderId);
        if (order && order.paymentStatus !== 'paid') {
          const cart = await Cart.findOne({ user: order.user });
          const user = await User.findById(order.user);

          // Wallet deduction (safe — if not already done)
          if (order.walletAmountUsed > 0) {
            await deductWallet(
              user,
              order.walletAmountUsed,
              `Wallet contribution for order #${order.orderNumber}`,
              order._id
            );
          }
          if (order.appliedCoupon) {
            await Coupon.findByIdAndUpdate(order.appliedCoupon, {
              $inc: { usedCount: 1 },
              $push: { usedBy: { user: order.user, orderId: order._id } },
            });
          }
          await finalizeOrder(order, cart, user);

          order.paymentStatus         = 'paid';
          order.paidAt                = new Date();
          order.orderStatus           = 'confirmed';
          order.razorpayPaymentId     = payment.id;
          order.razorpayPaymentStatus = 'captured';
          order.trackingHistory.push({ status: 'confirmed', message: 'Payment confirmed via Razorpay webhook' });
          await order.save();

          // Notify customer via webhook path too
          if (user) await notify.orderPlaced(user, order);
        }
      }
      break;
    }
    case 'payment.failed': {
      const failedPayment = event.payload.payment.entity;
      const failedOrderId = failedPayment.notes?.orderId;
      if (failedOrderId) {
        const order = await Order.findById(failedOrderId);
        if (order && order.paymentStatus === 'pending') {
          order.paymentStatus         = 'failed';
          order.razorpayPaymentStatus = 'failed';
          order.trackingHistory.push({ status: 'pending', message: 'Payment failed via Razorpay webhook' });
          await order.save();
        }
      }
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
});

// ============ ORDER SUCCESS PAGE ============
const getOrderSuccess = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.orderId, user: req.session?.userId })
    .populate('items.product', 'name images')
    .lean();
  if (!order) throw ApiError.notFound('Order not found');
  res.render('user/order-success', { title: 'Order Placed Successfully!', order });
});

// ============ ORDER LIST ============
const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, status } = req.query;
  const user = await User.findById(req.session?.userId);
  if (!user) throw ApiError.unauthorized('Please log in to view your orders');

  const filter = { user: req.session?.userId };
  if (status) filter.orderStatus = status;

  const skip = (parseInt(page) - 1) * 10;
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(10).lean(),
    Order.countDocuments(filter),
  ]);

  res.render('user/orders', {
    title: 'My Orders',
    orders,
    pagination: { page: parseInt(page), totalPages: Math.ceil(total / 10), total },
    filterStatus: status,
    currentUser: user,
  });
});

// ============ ORDER DETAIL ============
const getOrderDetail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session?.userId);
  if (!user) throw ApiError.unauthorized('Please log in to view your orders');

  const order = await Order.findOne({ _id: req.params.id, user: req.session?.userId })
    .populate('items.product', 'name images slug')
    .lean();
  if (!order) throw ApiError.notFound('Order not found');
  res.render('user/order-detail', { title: `Order #${order.orderNumber}`, order, currentUser: user });
});

// ============ CANCEL ORDER ============
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason, itemId } = req.body;
  const order = await Order.findOne({ _id: req.params.id, user: req.session?.userId });
  if (!order) throw ApiError.notFound('Order not found');

  const commerce = await Setting.getCommerceSettings();
  const SHIPPING_FREE_THRESHOLD = commerce.freeShippingThreshold;
  const SHIPPING_CHARGE = commerce.shippingCost;

  // ── BLOCK: COD orders already paid cannot be cancelled ──
  if (order.paymentMethod === 'cod' && order.paymentStatus === 'paid') {
    throw ApiError.badRequest('This order has already been paid and cannot be cancelled');
  }

  const cancellableStatuses = ['pending', 'confirmed'];
  if (!cancellableStatuses.includes(order.orderStatus) && !itemId) {
    throw ApiError.badRequest('Order cannot be cancelled at this stage');
  }

  async function restoreItemStock(item) {
    const product = await Product.findById(item.product);
    if (!product) return;
    if (item.variant?.variantId) {
      const skuVariant = product.variants.id(item.variant.variantId);
      if (skuVariant) skuVariant.stock += item.quantity;
    } else {
      product.stock += item.quantity;
    }
    product.salesCount = Math.max(0, (product.salesCount || 0) - item.quantity);
    await product.save();
  }

  async function recalculateTotals(ord) {
    const activeItems = ord.items.filter((i) => i.itemStatus === 'active');
    const newSubtotal = activeItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const newShipping = newSubtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_CHARGE;

    let newCouponDiscount = 0;
    if (ord.appliedCoupon && newSubtotal > 0) {
      const coupon = await Coupon.findById(ord.appliedCoupon);
      if (coupon) newCouponDiscount = coupon.calculateDiscount(newSubtotal);
    } else if (ord.couponDiscount > 0 && newSubtotal > 0) {
      const proportion = newSubtotal / (ord.subtotal || newSubtotal);
      newCouponDiscount = parseFloat((ord.couponDiscount * proportion).toFixed(2));
    }
    if (newSubtotal === 0) newCouponDiscount = 0;

    // Gross order value (before any payment deduction)
    const newGross = parseFloat((newSubtotal + newShipping - newCouponDiscount).toFixed(2));

    if (ord.paymentMethod === 'cod' && (ord.walletAmountUsed || 0) > 0) {
      // ── COD + wallet mental model ──
      // The COD amount is a FIXED commitment — the customer came prepared with that cash.
      // It never decreases due to item cancellations; only the wallet portion adjusts.
      //
      // Formula:
      //   originalCodDue  = what was stored as totalAmount at order time (the cash they owe)
      //   newWalletNeeded = newGross - originalCodDue  (wallet covers the gap above COD)
      //
      // Clamp newWalletNeeded to [0, originalWallet]:
      //   • Can't go negative — if newGross < originalCodDue, wallet = 0, COD covers remainder
      //   • Can't exceed originalWallet — we only ever refund wallet, never re-deduct more
      //
      // Edge case: newGross < originalCodDue (cheap items remain, less than the COD commitment)
      //   → newWalletNeeded = 0, newCodDue = newGross  (customer only pays what's left, not more)

      const originalCodDue = ord.totalAmount || 0;      // fixed COD commitment
      const originalWallet = ord.walletAmountUsed || 0;

      let newWalletNeeded = parseFloat((newGross - originalCodDue).toFixed(2));
      let newCodDue;

      if (newWalletNeeded < 0) {
        // Remaining order is cheaper than the COD commitment — cap COD at newGross
        newWalletNeeded = 0;
        newCodDue = newGross;
      } else if (newWalletNeeded > originalWallet) {
        // Guard: should never happen during cancellation, but clamp for safety
        newWalletNeeded = originalWallet;
        newCodDue = parseFloat((newGross - newWalletNeeded).toFixed(2));
      } else {
        newCodDue = parseFloat((newGross - newWalletNeeded).toFixed(2));
      }

      // Final safety clamp — nothing can go below zero
      newWalletNeeded = Math.max(0, parseFloat(newWalletNeeded.toFixed(2)));
      newCodDue = Math.max(0, parseFloat(newCodDue.toFixed(2)));

      ord.subtotal         = newSubtotal;
      ord.shippingCharge   = newShipping;
      ord.couponDiscount   = newCouponDiscount;
      ord.walletAmountUsed = newWalletNeeded;  // updated so further cancellations use the right base
      ord.totalAmount      = newCodDue;        // what the customer still owes in cash at the door
    } else {
      // Razorpay / wallet-only: totalAmount = gross minus wallet (0 for wallet-only)
      const newTotal = parseFloat(
        Math.max(0, newGross - (ord.walletAmountUsed || 0)).toFixed(2)
      );
      ord.subtotal       = newSubtotal;
      ord.shippingCharge = newShipping;
      ord.couponDiscount = newCouponDiscount;
      ord.totalAmount    = newTotal;
    }
  }

  const isCodOrder = order.paymentMethod === 'cod';
  const isPaidNonCod = order.paymentStatus === 'paid' && !isCodOrder;

  let itemsToRestoreStock = [];
  let refundAmount = 0;

  if (itemId) {
    const item = order.items.id(itemId);
    if (!item || item.itemStatus !== 'active') {
      throw ApiError.badRequest('Item cannot be cancelled');
    }

    const itemTotal = parseFloat((item.price * item.quantity).toFixed(2));

    // ✅ Capture BEFORE mutating anything
    const originalOrderTotal = parseFloat(
      (order.subtotal + order.shippingCharge - order.couponDiscount).toFixed(2)
    );
    const originalWallet = order.walletAmountUsed || 0;

    item.itemStatus   = 'cancelled';
    item.cancelReason = reason;
    item.cancelledAt  = new Date();
    itemsToRestoreStock.push(item);

    // ✅ Mutate totals AFTER reading originals
    await recalculateTotals(order);

    // Calculate refund based on how walletAmountUsed changed
    if (isPaidNonCod) {
      // Razorpay (paid): full item value back to wallet
      refundAmount = itemTotal;
    } else if (isCodOrder && originalWallet > 0) {
      // COD+wallet: refund = how much wallet was freed up by this cancellation
      // recalculateTotals already updated order.walletAmountUsed to the new (lower) value
      const newWallet = order.walletAmountUsed || 0;
      refundAmount = parseFloat((originalWallet - newWallet).toFixed(2));
    }

    const allCancelled = order.items.every((i) => i.itemStatus === 'cancelled');
    if (allCancelled) {
      order.orderStatus  = 'cancelled';
      order.cancelReason = 'All items cancelled';
      order.cancelledAt  = new Date();
      order.trackingHistory.push({ status: 'cancelled', message: 'All items cancelled by customer' });
    }
  } else {
    // ── Full order cancellation ──
    // Capture totals BEFORE zeroing out
    const originalSubtotal     = order.subtotal || 0;
    const originalShipping     = order.shippingCharge || 0;
    const originalCoupon       = order.couponDiscount || 0;
    const originalWallet       = order.walletAmountUsed || 0;
    const originalTotal        = order.totalAmount || 0; // razorpay/cod collected amount

    order.orderStatus  = 'cancelled';
    order.cancelReason = reason;
    order.cancelledAt  = new Date();
    order.cancelledBy  = req.session?.userId;
    order.items.forEach((i) => {
      if (i.itemStatus === 'active') {
        i.itemStatus   = 'cancelled';
        i.cancelReason = reason;
        i.cancelledAt  = new Date();
        itemsToRestoreStock.push(i);
      }
    });
    order.trackingHistory.push({ status: 'cancelled', message: `Order cancelled: ${reason}` });

    // Calculate refund amount
    if (isPaidNonCod) {
      // Refund everything: wallet portion + razorpay portion (both back to wallet)
      refundAmount = parseFloat((originalWallet + originalTotal).toFixed(2));
    } else if (isCodOrder && originalWallet > 0) {
      // COD: only wallet portion is refundable (cash not yet collected, or blocked above if paid)
      refundAmount = originalWallet;
    }

    // Zero everything out
    order.subtotal       = 0;
    order.shippingCharge = 0;
    order.couponDiscount = 0;
    order.totalAmount    = 0;
  }

  // ── Restore stock ──
  for (const item of itemsToRestoreStock) {
    await restoreItemStock(item);
  }

  // ── Issue refund to wallet ──
  if (refundAmount > 0) {
    const user = await User.findById(order.user);
    await user.addWalletTransaction(
      'credit',
      refundAmount,
      `Refund for ${itemId ? 'item cancellation' : 'order cancellation'} #${order.orderNumber}`,
      order._id
    );
    order.paymentStatus = itemId ? order.paymentStatus : 'refunded';
    order.refundAmount  = parseFloat(((order.refundAmount || 0) + refundAmount).toFixed(2));
    order.refundedAt    = new Date();
  }

  await order.save();

  const cancelledUser = await User.findById(order.user);
  if (cancelledUser) {
    await notify.orderCancelled(cancelledUser, order, order.refundAmount || 0);
    if (order.refundAmount > 0) {
      await notify.walletCredit(cancelledUser, order.refundAmount, `Refund for order #${order.orderNumber}`);
    }
  }

  return res.status(200).json({
    success: true,
    message: itemId ? 'Item cancelled successfully' : 'Order cancelled successfully',
    redirectUrl: `/orders/${order._id}`,
  });
});

// ============ DOWNLOAD INVOICE ============
const downloadInvoice = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.session?.userId })
    .populate('user', 'name email')
    .lean();
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentStatus !== 'paid' && order.paymentMethod !== 'cod') {
    throw ApiError.badRequest('Invoice not available for unpaid orders');
  }
  generateInvoice(order, res);
});

// ============ BUY NOW ============
// Logged-in users: replaces their cart with just this item and goes straight to
// checkout (fast single-item purchase flow, unchanged from before).
// Guests: rather than interrupting them with a login wall, the item is added to
// their session-backed guest cart (kept alongside anything else already there)
// and they're sent to /cart so they can keep browsing/adding more. They only hit
// the login page once they click "Proceed to Checkout" — at which point their
// full guest cart is merged into their account (see auth.controller.js).
const buyNow = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, colorId, sizeId } = req.body;

  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw ApiError.notFound('Product not found');

  const vt = product.variantType;
  let price = product.discountedPrice || product.basePrice;
  let variantData = null;

  if (vt !== 'none') {
    if ((vt === 'color' || vt === 'color_size') && !colorId) throw ApiError.badRequest('Please select a color');
    if ((vt === 'size'  || vt === 'color_size') && !sizeId)  throw ApiError.badRequest('Please select a size');

    const colorVariant = colorId ? product.colorVariants.id(colorId) : null;
    const sizeVariant  = sizeId  ? product.sizeVariants.id(sizeId)   : null;

    const skuVariant = product.findVariant(colorId || null, sizeId || null);
    if (!skuVariant) throw ApiError.badRequest('Selected combination not available');

    price = skuVariant.price;
    variantData = {
      variantId:    skuVariant._id,
      colorId:      colorVariant?._id   || null,
      sizeId:       sizeVariant?._id    || null,
      color:        colorVariant?.color || null,
      colorHex:     colorVariant?.colorHex || null,
      size:         sizeVariant?.size   || null,
      sku:          skuVariant.sku      || null,
      variantImage: colorVariant?.images?.[0]?.url || null,
    };
  }

  if (!req.session?.userId) {
    await guestCart.addItemToGuestCart(req, { productId, variantData, quantity, price });
    return res.json({ success: true, redirectUrl: '/cart', guest: true });
  }

  let cart = await Cart.findOne({ user: req.session.userId });
  if (!cart) cart = new Cart({ user: req.session.userId, items: [] });

  cart.items = [{ product: productId, variant: variantData, quantity: parseInt(quantity), price }];
  cart.couponCode     = undefined;
  cart.couponDiscount = 0;
  cart.appliedCoupon  = undefined;
  await cart.save();

  res.json({ success: true, redirectUrl: '/checkout' });
});

module.exports = {
  getCheckoutPage,
  placeOrder,
  verifyPayment,
  failPayment,
  razorpayWebhook,
  getOrderSuccess,
  getOrders,
  getOrderDetail,
  cancelOrder,
  retryPayment,
  downloadInvoice,
  buyNow,
};