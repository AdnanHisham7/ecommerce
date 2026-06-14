const Cart = require('../modules/cart/cart.model');
const Wishlist = require('../modules/wishlist/wishlist.model');
const Category = require('../modules/categories/category.model');
const Setting = require('../modules/settings/settings.model');
const env = require('../config/env');
const brand = require('../config/brand');

/**
 * Inject commonly needed data into res.locals for all views.
 * Brand config is always available as `brand` in every template.
 */
const injectLocals = async (req, res, next) => {
  try {
    // ── Brand (always available in every template as `brand`) ──
    res.locals.brand = brand;

    // App info (kept for backward compat — now also in brand)
    res.locals.appName = env.app.name || brand.name;
    res.locals.appUrl = env.app.url;
    res.locals.razorpayKeyId = env.razorpay.keyId;
    res.locals.gaTrackingId = process.env.GA_TRACKING_ID || '';
    res.locals.oneSignalAppId = env.oneSignal?.appId || '';

    // Current user for views (admin and user layouts)
    res.locals.currentUser = req.user || null;

    // Flash messages
    res.locals.success = req.flash?.('success') || [];
    res.locals.error = req.flash?.('error') || [];
    res.locals.info = req.flash?.('info') || [];
    res.locals.warning = req.flash?.('warning') || [];

    // Current path for active nav links
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;

    // User preferences (theme)
    res.locals.theme = req.session?.theme || req.user?.preferences?.theme || 'system';

    // ── Feature flags (available in EVERY view as `featureFlags`) ──
    res.locals.featureFlags = await Setting.getFeatureFlags();

    // ── Commerce settings (shipping threshold/cost, cashback amount) ──
    res.locals.commerceSettings = await Setting.getCommerceSettings();

    // Categories for nav
    const categories = await Category.find({ isActive: true, parent: null })
      .select('name slug')
      .sort('sortOrder')
      .limit(10)
      .lean();
    res.locals.navCategories = categories;

    // Cart / wishlist counts.
    // NOTE: req.user is populated by route-level auth middleware (optionalAuth/
    // requireAuth), which runs AFTER this middleware for the current request.
    // We therefore key off req.session.userId directly, which is always
    // available this early, rather than req.user.
    if (req.session?.userId) {
      try {
        const [cart, wishlist, currentUserDoc] = await Promise.all([
          Cart.findOne({ user: req.session.userId }),
          Wishlist.findOne({ user: req.session.userId }),
          req.user ? null : require('../modules/users/user.model').findById(req.session.userId).select('notifications'),
        ]);
        res.locals.cartCount = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
        res.locals.wishlistCount = wishlist ? wishlist.products.length : 0;

        const notificationsSource = req.user?.notifications || currentUserDoc?.notifications || [];
        res.locals.unreadNotifications = notificationsSource.filter((n) => !n.isRead).length;
      } catch {
        res.locals.cartCount = 0;
        res.locals.wishlistCount = 0;
        res.locals.unreadNotifications = 0;
      }
    } else {
      const guestCart = require('../utils/guestCart');
      res.locals.cartCount = guestCart.guestCartCount(req);
      res.locals.wishlistCount = 0;
      res.locals.unreadNotifications = 0;
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = injectLocals;