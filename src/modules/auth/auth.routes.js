const express = require('express');
const router = express.Router();
const passport = require('../../config/passport');
const authController = require('./auth.controller');
const { redirectIfAuth, registrationGuard } = require('../../middlewares/auth.middleware');
const { authLimiter, otpLimiter } = require('../../middlewares/rateLimit.middleware');

// Register — blocked when newRegistrations flag is OFF
router.get('/register', redirectIfAuth, registrationGuard, authController.getRegisterPage);
router.post('/register', redirectIfAuth, registrationGuard, authLimiter, authController.register);

// OTP (only reachable after register; registration guard not needed here — session controls access)
router.get('/verify-otp', authController.getVerifyOtpPage);
router.post('/verify-otp', otpLimiter, authController.verifyOtp);
router.post('/resend-otp', otpLimiter, authController.resendOtp);

// Login
router.get('/login', redirectIfAuth, authController.getLoginPage);
router.post('/login', redirectIfAuth, authLimiter, authController.login);

// 2FA
router.get('/2fa', authController.get2FAPage);
router.post('/2fa', authController.verify2FA);

// Logout
router.get('/logout', authController.logout);
router.post('/logout', authController.logout);

// Forgot password
router.get('/forgot-password', authController.getForgotPasswordPage);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.get('/reset-password/:token', authController.getResetPasswordPage);
router.post('/reset-password/:token', authController.resetPassword);

// Google OAuth — registration guard also applies to Google sign-in for new users
// (existing users can still log in; guard is handled in auth.controller.verifyOtp + googleCallback)
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login', failureFlash: true }),
  authController.googleCallback
);

// Refresh token
router.post('/refresh-token', authController.refreshToken);

module.exports = router;
