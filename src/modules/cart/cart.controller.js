const Cart = require('./cart.model');
const User = require('../users/user.model');
const Product = require('../products/product.model');
const Coupon = require('../coupons/coupon.model');
const Setting = require('../settings/settings.model');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const guestCart = require('../../utils/guestCart');

// ============ COUPON ELIGIBILITY (shared by guest + logged-in) ============
function evaluateCoupon(coupon, items, userId) {
  const eligibleItems = coupon.getEligibleItems(items);
  if (!eligibleItems.length) {
    return { success: false, message: 'This coupon is not applicable to any item in your cart' };
  }

  const eligibleSubtotal = eligibleItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const validity = coupon.isValid(userId, eligibleSubtotal);
  if (!validity.valid) return { success: false, message: validity.message };

  const discount = coupon.calculateDiscount(eligibleSubtotal);
  return { success: true, discount };
}

/**
 * Re-checks a currently-applied coupon against the cart's current contents.
 * Cart contents can change after a coupon is applied (quantity edits, item
 * removal), which — now that coupons can be bound to a specific product/
 * category/brand — could otherwise leave a stale discount applied to items
 * it was never meant to cover. Returns true if the coupon had to be cleared.
 */
async function reevaluateUserCoupon(cart) {
  if (!cart.appliedCoupon) return false;

  if (!cart.items.length) {
    cart.couponCode = undefined;
    cart.couponDiscount = 0;
    cart.appliedCoupon = undefined;
    await cart.save();
    return true;
  }

  const coupon = await Coupon.findById(cart.appliedCoupon);
  const freshCart = await Cart.findById(cart._id).populate('items.product');
  const result = coupon && freshCart ? evaluateCoupon(coupon, freshCart.items, cart.user) : { success: false };

  if (!result.success) {
    cart.couponCode = undefined;
    cart.couponDiscount = 0;
    cart.appliedCoupon = undefined;
    await cart.save();
    return true;
  }

  if (result.discount !== cart.couponDiscount) {
    cart.couponDiscount = result.discount;
    await cart.save();
  }
  return false;
}

async function reevaluateGuestCoupon(req) {
  const gCart = guestCart.getGuestCart(req);
  if (!gCart.appliedCoupon) return false;

  if (!gCart.items.length) {
    gCart.couponCode = null;
    gCart.couponDiscount = 0;
    gCart.appliedCoupon = null;
    return true;
  }

  const coupon = await Coupon.findById(gCart.appliedCoupon);
  const viewCart = await guestCart.populateGuestCartForView(req);
  const result = coupon ? evaluateCoupon(coupon, viewCart.items, null) : { success: false };

  if (!result.success) {
    gCart.couponCode = null;
    gCart.couponDiscount = 0;
    gCart.appliedCoupon = null;
    return true;
  }

  gCart.couponDiscount = result.discount;
  return false;
}

// ============ GET CART ============
const getCart = asyncHandler(async (req, res) => {
  const commerce = await Setting.getCommerceSettings();
  const SHIPPING_FREE_THRESHOLD = commerce.freeShippingThreshold;
  const SHIPPING_CHARGE = commerce.shippingCost;

  let cart, user = null;

  if (req.session?.userId) {
    user = await User.findById(req.session.userId);
    if (!user) throw ApiError.unauthorized('Please log in to view your cart');

    cart = await Cart.findOne({ user: req.session.userId })
      .populate({
        path: 'items.product',
        select: 'name slug images basePrice discountedPrice stockStatus colorVariants sizeVariants variants variantType brand',
      })
      .lean();
  } else {
    cart = await guestCart.populateGuestCartForView(req);
  }

  const items = cart?.items || [];
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingCharge = subtotal >= SHIPPING_FREE_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_CHARGE;
  const total = subtotal - (cart?.couponDiscount || 0) + shippingCharge;

  res.render('user/cart', {
    title: 'Shopping Cart',
    cart: cart || { items: [], couponDiscount: 0 },
    subtotal,
    shippingCharge,
    total,
    freeShippingThreshold: SHIPPING_FREE_THRESHOLD,
    amountToFreeShipping: Math.max(0, SHIPPING_FREE_THRESHOLD - subtotal),
    currentUser: user,
    isGuest: !user,
  });
});

// ============ ADD TO CART ============
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, colorId, sizeId } = req.body;

  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw ApiError.notFound('Product not found');
  if (product.stockStatus === 'out_of_stock') throw ApiError.badRequest('Product is out of stock');

  const vt = product.variantType;
  let price = product.discountedPrice || product.basePrice;
  let variantData = null;

  if (vt !== 'none') {
    if ((vt === 'color' || vt === 'color_size') && !colorId) {
      throw ApiError.badRequest('Please select a color');
    }
    if ((vt === 'size' || vt === 'color_size') && !sizeId) {
      throw ApiError.badRequest('Please select a size');
    }

    const colorVariant = colorId ? product.colorVariants.id(colorId) : null;
    const sizeVariant  = sizeId  ? product.sizeVariants.id(sizeId)   : null;

    if (colorId && (!colorVariant || !colorVariant.isActive)) {
      throw ApiError.notFound('Color not available');
    }
    if (sizeId && (!sizeVariant || !sizeVariant.isActive)) {
      throw ApiError.notFound('Size not available');
    }

    const skuVariant = product.findVariant(colorId || null, sizeId || null);
    if (!skuVariant) throw ApiError.badRequest('This combination is not available');
    if (skuVariant.stock < parseInt(quantity)) throw ApiError.badRequest('Insufficient stock for selected option');

    price = skuVariant.price;
    const variantImage = colorVariant?.images?.[0]?.url || null;

    variantData = {
      variantId: skuVariant._id,
      colorId:   colorVariant?._id   || null,
      sizeId:    sizeVariant?._id    || null,
      color:     colorVariant?.color || null,
      colorHex:  colorVariant?.colorHex || null,
      size:      sizeVariant?.size   || null,
      sku:       skuVariant.sku      || null,
      variantImage,
    };
  } else {
    if (product.stock < parseInt(quantity)) throw ApiError.badRequest('Insufficient stock');
  }

  // ── Guest (not logged in): store in session cart ──
  if (!req.session?.userId) {
    const gCart = await guestCart.addItemToGuestCart(req, {
      productId, variantData, quantity, price,
    });
    return res.json({
      success: true,
      message: 'Added to cart!',
      cartCount: gCart.items.reduce((s, i) => s + i.quantity, 0),
    });
  }

  // ── Logged-in: persist to DB cart ──
  let cart = await Cart.findOne({ user: req.session.userId });
  if (!cart) cart = new Cart({ user: req.session.userId, items: [] });

  const existingIdx = cart.items.findIndex((item) => {
    if (item.product.toString() !== productId) return false;
    if (vt === 'none') return !item.variant?.variantId;
    if (vt === 'color')      return item.variant?.colorId?.toString() === colorId && !item.variant?.sizeId;
    if (vt === 'size')       return item.variant?.sizeId?.toString()  === sizeId  && !item.variant?.colorId;
    if (vt === 'color_size') return item.variant?.colorId?.toString() === colorId && item.variant?.sizeId?.toString() === sizeId;
    return false;
  });

  if (existingIdx > -1) {
    let maxQty = product.stock;
    if (variantData) {
      const sv = product.findVariant(colorId || null, sizeId || null);
      maxQty = sv ? sv.stock : 0;
    }
    const newQty = cart.items[existingIdx].quantity + parseInt(quantity);
    cart.items[existingIdx].quantity = Math.min(newQty, maxQty || 10);
  } else {
    cart.items.push({
      product: productId,
      variant: variantData,
      quantity: parseInt(quantity),
      price,
    });
  }

  cart.lastUpdated = new Date();
  await cart.save();

  res.json({
    success: true,
    message: 'Added to cart!',
    cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
  });
});

// ============ UPDATE CART ITEM ============
const updateCartItem = asyncHandler(async (req, res) => {
  const { itemId, quantity } = req.body;
  const newQty = parseInt(quantity);
  const commerce = await Setting.getCommerceSettings();

  if (!req.session?.userId) {
    const result = await guestCart.updateGuestCartItem(req, itemId, newQty);
    if (!result.success) return res.json(result);

    const cart = guestCart.getGuestCart(req);
    const couponCleared = await reevaluateGuestCoupon(req);
    const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const shippingCharge = subtotal >= commerce.freeShippingThreshold || subtotal === 0 ? 0 : commerce.shippingCost;
    const total = subtotal - (cart.couponDiscount || 0) + shippingCharge;
    const itemTotal = result.item ? result.item.price * result.item.quantity : 0;

    return res.json({
      success: true,
      itemTotal,
      subtotal,
      shippingCharge,
      total,
      couponDiscount: cart.couponDiscount || 0,
      couponCleared,
      cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
      message: result.item ? 'Quantity updated' : 'Item removed',
    });
  }

  const cart = await Cart.findOne({ user: req.session.userId }).populate(
    'items.product',
    'stock variants variantType isActive'
  );

  if (!cart) throw ApiError.notFound('Cart not found');

  const item = cart.items.id(itemId);
  if (!item) throw ApiError.notFound('Cart item not found');

  let availableStock = 0;
  if (item.variant?.variantId) {
    const skuVariant = item.product.variants?.id(item.variant.variantId);
    availableStock = skuVariant ? skuVariant.stock : 0;
  } else {
    availableStock = item.product.stock || 0;
  }

  if (newQty > availableStock) {
    return res.json({
      success: false,
      message: `Only ${availableStock} units available`,
    });
  }

  if (newQty <= 0) {
    cart.items.pull(itemId);
  } else {
    item.quantity = newQty;
  }

  await cart.save();
  const couponCleared = await reevaluateUserCoupon(cart);

  const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingCharge = subtotal >= commerce.freeShippingThreshold || subtotal === 0 ? 0 : commerce.shippingCost;
  const total = subtotal - (cart.couponDiscount || 0) + shippingCharge;
  const itemTotal = newQty > 0 ? item.price * newQty : 0;

  res.json({
    success: true,
    itemTotal,
    subtotal,
    shippingCharge,
    total,
    couponDiscount: cart.couponDiscount || 0,
    couponCleared,
    cartCount: cart.items.reduce((s, i) => s + i.quantity, 0),
    message: newQty <= 0 ? 'Item removed' : 'Quantity updated',
  });
});

// ============ REMOVE FROM CART ============
const removeFromCart = asyncHandler(async (req, res) => {
  const { itemId } = req.params;

  if (!req.session?.userId) {
    guestCart.removeGuestCartItem(req, itemId);
    const couponCleared = await reevaluateGuestCoupon(req);
    return res.json({ success: true, message: 'Item removed from cart', couponCleared });
  }

  const cart = await Cart.findOne({ user: req.session.userId });
  if (!cart) throw ApiError.notFound('Cart not found');
  cart.items.pull(itemId);
  await cart.save();
  const couponCleared = await reevaluateUserCoupon(cart);
  res.json({ success: true, message: 'Item removed from cart', couponCleared });
});

// ============ APPLY COUPON ============
const applyCoupon = asyncHandler(async (req, res) => {
  const { couponCode } = req.body;
  if (!couponCode) throw ApiError.badRequest('Please enter a coupon code');

  const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
  if (!coupon) return res.json({ success: false, message: 'Invalid coupon code' });

  if (!req.session?.userId) {
    const viewCart = await guestCart.populateGuestCartForView(req);
    if (!viewCart.items.length) throw ApiError.badRequest('Cart is empty');

    const result = evaluateCoupon(coupon, viewCart.items, null);
    if (!result.success) return res.json(result);

    const gCart = guestCart.getGuestCart(req);
    gCart.couponCode = coupon.code;
    gCart.couponDiscount = result.discount;
    gCart.appliedCoupon = coupon._id.toString();

    return res.json({
      success: true,
      message: `Coupon applied! You saved ₹${result.discount}`,
      discount: result.discount,
    });
  }

  const cart = await Cart.findOne({ user: req.session.userId }).populate('items.product');
  if (!cart || cart.items.length === 0) throw ApiError.badRequest('Cart is empty');

  const result = evaluateCoupon(coupon, cart.items, req.session.userId);
  if (!result.success) return res.json(result);

  cart.couponCode = coupon.code;
  cart.couponDiscount = result.discount;
  cart.appliedCoupon = coupon._id;
  await cart.save();

  res.json({
    success: true,
    message: `Coupon applied! You saved ₹${result.discount}`,
    discount: result.discount,
  });
});

// ============ REMOVE COUPON ============
const removeCoupon = asyncHandler(async (req, res) => {
  if (!req.session?.userId) {
    const gCart = guestCart.getGuestCart(req);
    gCart.couponCode = null;
    gCart.couponDiscount = 0;
    gCart.appliedCoupon = null;
    return res.json({ success: true, message: 'Coupon removed' });
  }

  const cart = await Cart.findOne({ user: req.session.userId });
  if (!cart) throw ApiError.notFound('Cart not found');
  cart.couponCode = undefined;
  cart.couponDiscount = 0;
  cart.appliedCoupon = undefined;
  await cart.save();
  res.json({ success: true, message: 'Coupon removed' });
});

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  applyCoupon,
  removeCoupon,
  evaluateCoupon,
};