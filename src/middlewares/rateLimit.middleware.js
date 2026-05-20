const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const createLimiter = (options) =>
  rateLimit({
    windowMs: options.windowMs || env.rateLimit.windowMs,
    max: options.max || env.rateLimit.max,
    message: options.message || 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      const isApi = req.path.startsWith('/api/') || req.xhr;
      if (isApi) {
        return res.status(429).json({ success: false, message: options.message });
      }
      req.flash?.('error', options.message);
      res.status(429).redirect('back');
    },
  });

// General API limiter
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: 'Too many API requests, please try again in 15 minutes.',
});

// Auth limiter (strict)
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// OTP limiter
const otpLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 3,
  message: 'Too many OTP requests. Please wait 1 minute.',
});

// Search limiter
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests.',
});

// Admin limiter
const adminLimiter = createLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: 'Too many admin login attempts. Please try again in 30 minutes.',
});

module.exports = { apiLimiter, authLimiter, otpLimiter, searchLimiter, adminLimiter };
