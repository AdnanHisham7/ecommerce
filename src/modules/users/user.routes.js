const express = require('express');
const router = express.Router();
const productCtrl = require('../products/product.controller');
const cartCtrl = require('../cart/cart.controller');
const orderCtrl = require('../orders/order.controller');
const userCtrl = require('../users/user.controller');
const { requireAuth, optionalAuth, authenticate } = require('../../middlewares/auth.middleware');
const noCache = require('../../middlewares/noCache.middleware');
const { searchLimiter } = require('../../middlewares/rateLimit.middleware');
const { avatarUpload } = require('../../config/cloudinary');

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

// ---- User Dashboard & Profile ----
router.get('/dashboard', authenticate, userCtrl.getDashboard);
router.get('/profile', requireAuth, userCtrl.getProfile);
router.post('/profile/update', requireAuth, avatarUpload.single('avatar'), userCtrl.updateProfile);
router.post('/profile/change-password', requireAuth, userCtrl.changePassword);

// ---- Addresses ----
router.get('/profile/addresses', requireAuth, userCtrl.getAddresses);
router.post('/profile/addresses/add', requireAuth, userCtrl.addAddress);
router.post('/profile/addresses/:addressId/update', requireAuth, userCtrl.updateAddress);
router.delete('/profile/addresses/:addressId', requireAuth, userCtrl.deleteAddress);

// ---- Wallet ----
router.get('/wallet', requireAuth, userCtrl.getWallet);

// ---- Preferences ----
router.post('/preferences', requireAuth, userCtrl.updatePreferences);

// ---- 2FA ----
router.post('/profile/2fa/setup', requireAuth, userCtrl.setup2FA);
router.post('/profile/2fa/enable', requireAuth, userCtrl.enable2FA);
router.post('/profile/2fa/disable', requireAuth, userCtrl.disable2FA);

// ---- Referral ----
router.get('/referral', requireAuth, userCtrl.getReferral);

// ---- Theme toggle ----
router.post('/theme', (req, res) => {
  req.session.theme = req.body.theme;
  if (req.user) {
    const User = require('../users/user.model');
    User.findByIdAndUpdate(req.user._id, { 'preferences.theme': req.body.theme }).catch(() => {});
  }
  res.json({ success: true });
});

module.exports = router;
