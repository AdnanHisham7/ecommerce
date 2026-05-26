const { v4: uuidv4 } = require('uuid');
const Product = require('../modules/products/product.model');
const Cart = require('../modules/cart/cart.model');

const EMPTY_CART = () => ({
  items: [],
  couponCode: null,
  couponDiscount: 0,
  appliedCoupon: null,
});

/**
 * Returns the guest cart stored in the session (creating an empty one if absent).
 * Always returns the SAME object reference stored on req.session so mutating it
 * and calling touchSession() persists the change.
 */
function getGuestCart(req) {
  if (!req.session.guestCart) {
    req.session.guestCart = EMPTY_CART();
  }
  return req.session.guestCart;
}

function clearGuestCart(req) {
  req.session.guestCart = EMPTY_CART();
}

function variantKey(variant) {
  return variant && variant.variantId ? variant.variantId.toString() : 'none';
}

/**
 * Resolves the available stock for a given product + optional SKU variant.
 */
function resolveStock(product, variantId) {
  if (variantId) {
    const sku = product.variants?.find((v) => v._id.toString() === variantId.toString());
    return sku && sku.isActive ? sku.stock : 0;
  }
  return product.stock || 0;
}

/**
 * Adds (or merges quantity into) an item in the guest cart.
 * Mirrors the validation performed by the logged-in cart controller.
 */
async function addItemToGuestCart(req, { productId, variantData, quantity, price, replace = false }) {
  const cart = getGuestCart(req);
  const qty = parseInt(quantity, 10) || 1;

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    const err = new Error('Product not found');
    err.statusCode = 404;
    throw err;
  }

  const variantId = variantData?.variantId || null;
  const maxQty = resolveStock(product, variantId);
  if (maxQty <= 0) {
    const err = new Error('Insufficient stock');
    err.statusCode = 400;
    throw err;
  }

  if (replace) {
    cart.items = [{
      _id: uuidv4(),
      product: productId.toString(),
      variant: variantData || null,
      quantity: Math.min(qty, maxQty),
      price,
      addedAt: new Date(),
    }];
    cart.couponCode = null;
    cart.couponDiscount = 0;
    cart.appliedCoupon = null;
    return cart;
  }

  const existingIdx = cart.items.findIndex(
    (i) => i.product === productId.toString() && variantKey(i.variant) === variantKey(variantData)
  );

  if (existingIdx > -1) {
    const newQty = cart.items[existingIdx].quantity + qty;
    cart.items[existingIdx].quantity = Math.min(newQty, maxQty || 10);
  } else {
    cart.items.push({
      _id: uuidv4(),
      product: productId.toString(),
      variant: variantData || null,
      quantity: Math.min(qty, maxQty),
      price,
      addedAt: new Date(),
    });
  }

  return cart;
}

async function updateGuestCartItem(req, itemId, newQty) {
  const cart = getGuestCart(req);
  const item = cart.items.find((i) => i._id === itemId);
  if (!item) {
    const err = new Error('Cart item not found');
    err.statusCode = 404;
    throw err;
  }

  const product = await Product.findById(item.product);
  if (!product) {
    const err = new Error('Product no longer available');
    err.statusCode = 404;
    throw err;
  }
  const maxQty = resolveStock(product, item.variant?.variantId);

  if (newQty > maxQty) {
    return { success: false, message: `Only ${maxQty} units available` };
  }

  if (newQty <= 0) {
    cart.items = cart.items.filter((i) => i._id !== itemId);
  } else {
    item.quantity = newQty;
  }

  return { success: true, item: newQty > 0 ? item : null };
}

function removeGuestCartItem(req, itemId) {
  const cart = getGuestCart(req);
  cart.items = cart.items.filter((i) => i._id !== itemId);
  return cart;
}

/**
 * Builds a render-ready cart object (mirrors the shape of a populated Mongoose
 * Cart document) from the session's guest cart, so the same `user/cart.ejs`
 * and checkout summary logic can be reused for guests.
 */
async function populateGuestCartForView(req) {
  const cart = getGuestCart(req);
  if (!cart.items.length) {
    return { items: [], couponCode: null, couponDiscount: 0, appliedCoupon: null };
  }

  const productIds = [...new Set(cart.items.map((i) => i.product))];
  const products = await Product.find({ _id: { $in: productIds } })
    .select('name slug images thumbnail basePrice discountedPrice compareAtPrice discountPercent stockStatus stock colorVariants sizeVariants variants variantType brand category isActive')
    .lean();
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const items = cart.items
    .filter((i) => productMap.has(i.product))
    .map((i) => ({
      _id: i._id,
      product: productMap.get(i.product),
      variant: i.variant || null,
      quantity: i.quantity,
      price: i.price,
      addedAt: i.addedAt,
    }));

  return {
    items,
    couponCode: cart.couponCode || null,
    couponDiscount: cart.couponDiscount || 0,
    appliedCoupon: cart.appliedCoupon || null,
  };
}

function guestCartCount(req) {
  const cart = req.session?.guestCart;
  if (!cart || !cart.items) return 0;
  return cart.items.reduce((s, i) => s + i.quantity, 0);
}

/**
 * Merges the session guest cart into the logged-in user's persistent Cart
 * document. Called right after a successful login / registration / 2FA /
 * Google sign-in. Silently skips items that are no longer available or
 * out of stock rather than failing the login flow.
 */
async function mergeGuestCartIntoUserCart(req, userId) {
  const guest = req.session?.guestCart;
  if (!guest || !guest.items || !guest.items.length) {
    clearGuestCart(req);
    return;
  }

  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });

  for (const gi of guest.items) {
    const product = await Product.findById(gi.product);
    if (!product || !product.isActive) continue;

    const variantId = gi.variant?.variantId || null;
    const maxQty = resolveStock(product, variantId);
    if (maxQty <= 0) continue;

    const idx = cart.items.findIndex((ci) => {
      if (ci.product.toString() !== gi.product.toString()) return false;
      const civ = ci.variant?.variantId ? ci.variant.variantId.toString() : 'none';
      const giv = variantId ? variantId.toString() : 'none';
      return civ === giv;
    });

    if (idx > -1) {
      cart.items[idx].quantity = Math.min(cart.items[idx].quantity + gi.quantity, maxQty);
    } else {
      cart.items.push({
        product: gi.product,
        variant: gi.variant || null,
        quantity: Math.min(gi.quantity, maxQty),
        price: gi.price,
      });
    }
  }

  cart.lastUpdated = new Date();
  await cart.save();
  clearGuestCart(req);
}

module.exports = {
  getGuestCart,
  clearGuestCart,
  addItemToGuestCart,
  updateGuestCartItem,
  removeGuestCartItem,
  populateGuestCartForView,
  guestCartCount,
  mergeGuestCartIntoUserCart,
};