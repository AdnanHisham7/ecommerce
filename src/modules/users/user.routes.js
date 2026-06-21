const express = require('express');
const router = express.Router();
const productCtrl = require('../products/product.controller');
const cartCtrl = require('../cart/cart.controller');
const orderCtrl = require('../orders/order.controller');
const userCtrl = require('../users/user.controller');
const { requireAuth, optionalAuth } = require('../../middlewares/auth.middleware');
const noCache = require('../../middlewares/noCache.middleware');
const { searchLimiter } = require('../../middlewares/rateLimit.middleware');

router.use(noCache); // Apply noCache middleware to all user routes

// ---- Home & Shop ----
router.get('/', optionalAuth, productCtrl.getHomePage);
router.get('/shop', optionalAuth, productCtrl.getShopPage);
router.get('/products/:slug', optionalAuth, productCtrl.getProductDetail);
router.get('/search/autocomplete', searchLimiter, optionalAuth, productCtrl.searchAutocomplete);
router.get('/search/saved', optionalAuth, productCtrl.getSavedSearches);
router.post('/reviews', requireAuth, productCtrl.submitReview);

// ---- Cart (guests get a session-backed cart; optionalAuth lets both through) ----
router.get('/cart', optionalAuth, cartCtrl.getCart);
router.post('/cart/add', optionalAuth, cartCtrl.addToCart);
router.post('/cart/update', optionalAuth, cartCtrl.updateCartItem);
router.delete('/cart/item/:itemId', optionalAuth, cartCtrl.removeFromCart);
router.post('/cart/coupon/apply', optionalAuth, cartCtrl.applyCoupon);
router.post('/cart/coupon/remove', optionalAuth, cartCtrl.removeCoupon);

// ---- Checkout & Orders ----
// Checkout itself always requires login — requireAuth stores req.session.returnTo
// so the user lands back on /checkout right after logging in (guest cart is
// merged into their account at that point — see auth.controller.js).
router.get('/checkout', requireAuth, orderCtrl.getCheckoutPage);
router.post('/checkout/place-order', requireAuth, orderCtrl.placeOrder);
// Buy Now is allowed for guests: it adds the item to their session cart and
// sends them to /cart to keep browsing, rather than forcing an immediate login.
router.post('/buy-now', optionalAuth, orderCtrl.buyNow);
router.get('/orders/success/:orderId', requireAuth, orderCtrl.getOrderSuccess);
router.post('/checkout/verify-payment', requireAuth, orderCtrl.verifyPayment);
router.post('/checkout/fail-payment', requireAuth, orderCtrl.failPayment);
router.post('/orders/:id/retry-payment', requireAuth, orderCtrl.retryPayment);

// ---- Razorpay Webhook (raw body) ----
router.post('/webhook/razorpay', orderCtrl.razorpayWebhook);
router.get('/orders', requireAuth, orderCtrl.getOrders);
router.get('/orders/:id', requireAuth, orderCtrl.getOrderDetail);
router.post('/orders/:id/cancel', requireAuth, orderCtrl.cancelOrder);
router.get('/orders/:id/invoice', requireAuth, orderCtrl.downloadInvoice);

// ---- Wishlist ----
router.get('/wishlist', requireAuth, userCtrl.getWishlist);
router.post('/wishlist/toggle', requireAuth, userCtrl.toggleWishlist);

module.exports = router;
