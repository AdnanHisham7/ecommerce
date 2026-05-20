const { verifyAccessToken, verifyRefreshToken, generateTokenPair, setTokenCookies } = require('../utils/jwt');
const User = require('../modules/users/user.model');
const Setting = require('../modules/settings/settings.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * Authenticate user via session or JWT tokens
 */
const authenticate = asyncHandler(async (req, res, next) => {
  let userId = null;

  // 1. Try session first (primary for web)
  if (req.session?.userId) {
    userId = req.session.userId;
  }
  // 2. Try access token cookie
  else if (req.cookies?.accessToken) {
    const decoded = verifyAccessToken(req.cookies.accessToken);
    if (decoded) {
      userId = decoded.userId;
    }
    // 3. Try refresh token if access expired
    else if (req.cookies?.refreshToken) {
      const refreshDecoded = verifyRefreshToken(req.cookies.refreshToken);
      if (refreshDecoded) {
        const newTokens = generateTokenPair({ userId: refreshDecoded.userId, role: refreshDecoded.role });
        setTokenCookies(res, newTokens);
        userId = refreshDecoded.userId;
      }
    }
  }
  // 4. Try Bearer token header (API use)
  else if (req.headers.authorization?.startsWith('Bearer ')) {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = verifyAccessToken(token);
    if (decoded) userId = decoded.userId;
  }

  if (!userId) {
    return next(ApiError.unauthorized('Please log in to continue'));
  }

  const user = await User.findById(userId).select('-password -twoFactorSecret');
  if (!user) return next(ApiError.unauthorized('User not found'));
  if (user.isBlocked) return next(ApiError.forbidden('Your account has been blocked. Contact support.'));

  req.user = user;
  res.locals.currentUser = user;
  next();
});

/**
 * Optional authentication - doesn't fail if not authenticated
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let userId = null;

  if (req.session?.userId) {
    userId = req.session.userId;
  } else if (req.cookies?.accessToken) {
    const decoded = verifyAccessToken(req.cookies.accessToken);
    if (decoded) userId = decoded.userId;
  }

  if (userId) {
    const user = await User.findById(userId).select('-password -twoFactorSecret');
    if (user && !user.isBlocked) {
      req.user = user;
      res.locals.currentUser = user;
    }
  }
  next();
});

/**
 * Require specific role(s)
 */
const requireRole = (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };

/**
 * Admin authentication via session
 */
const adminAuthenticate = asyncHandler(async (req, res, next) => {
  const adminId = req.session?.adminId || req.session?.userId;
  
  if (!adminId) {
    req.flash?.('error', 'Please login to access admin panel');
    return res.redirect('/admin/login');
  }

  const user = await User.findById(adminId).select('-password -twoFactorSecret');
  if (!user || !['admin', 'staff'].includes(user.role)) {
    req.session.destroy?.();
    req.flash?.('error', 'Access denied');
    return res.redirect('/admin/login');
  }

  if (user.isBlocked) {
    req.session.destroy?.();
    return res.redirect('/admin/login');
  }

  req.user = user;
  res.locals.currentUser = user;
  next();
});

/**
 * Require user to be logged in (redirects to login page)
 */
const requireAuth = (req, res, next) => {
  if (req.session?.userId) return next();
  
  // For AJAX/API calls, return 401 JSON
  if (req.xhr || req.headers.accept?.includes('application/json') || req.headers['content-type']?.includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Please login to continue', redirect: '/auth/login' });
  }
  
  const returnTo = req.originalUrl;
  req.session.returnTo = returnTo;
  req.flash?.('error', 'Please login to continue');
  res.redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
};

/**
 * Redirect if already authenticated
 */
const redirectIfAuth = (req, res, next) => {
  if (req.session?.userId) {
    return res.redirect('/');
  }
  next();
};

/**
 * Check specific admin permission.
 * Admin always passes. Staff must have the exact permission string.
 * For page (HTML) requests, redirects to dashboard with an error flash.
 * For API/JSON requests, returns 403 JSON.
 */
const requirePermission = (permission) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === 'admin') return next(); // admin has all permissions
    if (req.user.permissions?.includes(permission)) return next();

    const isJson = req.xhr ||
      req.headers.accept?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json') ||
      req.method !== 'GET';

    if (isJson) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You need the '${permission.replace(/_/g, ' ')}' permission.`,
      });
    }

    req.flash?.('error', `Access denied. You do not have the '${permission.replace(/_/g, ' ')}' permission.`);
    return res.redirect('/admin/dashboard');
  };

/**
 * Maintenance mode guard — blocks all non-admin users when maintenanceMode is ON.
 * Place this AFTER injectLocals so featureFlags is already on res.locals.
 */
const maintenanceGuard = asyncHandler(async (req, res, next) => {
  // Always allow admin routes
  if (req.path.startsWith('/admin')) return next();

  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (!flags.maintenanceMode) return next();

  // Allow admin/staff to pass through even on maintenance
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId).select('role').lean();
    if (user && ['admin', 'staff'].includes(user.role)) return next();
  }

  // JSON requests
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(503).json({ success: false, message: 'Site is under maintenance. Please try again later.' });
  }

  return res.status(503).render('errors/maintenance', {
    title: 'Maintenance Mode',
    layout: false,
  });
});

/**
 * New-registrations guard — blocks the register page/POST when disabled.
 */
const registrationGuard = asyncHandler(async (req, res, next) => {
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (flags.newRegistrations) return next();

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ success: false, message: 'New registrations are currently disabled.' });
  }

  req.flash?.('error', 'New registrations are currently disabled. Please try again later.');
  return res.redirect('/auth/login');
});

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  adminAuthenticate,
  requireAuth,
  redirectIfAuth,
  requirePermission,
  maintenanceGuard,
  registrationGuard,
};
