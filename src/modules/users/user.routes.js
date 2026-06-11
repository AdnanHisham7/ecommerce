const express = require('express');
const router = express.Router();
const productCtrl = require('../products/product.controller');
const cartCtrl = require('../cart/cart.controller');
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

module.exports = router;
