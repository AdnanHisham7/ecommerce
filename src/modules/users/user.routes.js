const express = require('express');
const router = express.Router();
const productCtrl = require('../products/product.controller');
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

module.exports = router;
