const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const otplib = require('otplib');
const User = require('../users/user.model');
const Setting = require('../settings/settings.model');
const { sendEmail, emailTemplates } = require('../../utils/email');
const { generateTokenPair, setTokenCookies, clearTokenCookies, verifyRefreshToken } = require('../../utils/jwt');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const AuditLog = require('../analytics/audit.model');
const { mergeGuestCartIntoUserCart } = require('../../utils/guestCart');
const notify = require('../../utils/notificationService');

// Helper to generate OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Helper to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress || req.ip;
};

// ============ REGISTER ============
const getRegisterPage = asyncHandler(async (req, res) => {
  // Block access if new registrations are disabled
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (!flags.newRegistrations) {
    req.flash('error', 'New registrations are currently disabled. Please try again later.');
    return res.redirect('/auth/login');
  }
  res.render('auth/register', { title: 'Create Account', referralCode: req.query.ref || '' });
});

const register = asyncHandler(async (req, res) => {
  // Block registration POST if flag disabled
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (!flags.newRegistrations) {
    req.flash('error', 'New registrations are currently disabled.');
    return res.redirect('/auth/login');
  }

  const { name, email, password, phone, referralCode } = req.body;

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    req.flash('error', 'Email already registered. Please login.');
    return res.redirect('/auth/register');
  }

  // Generate OTP
  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Store temp user data in session
  req.session.pendingUser = { name, email: email.toLowerCase(), password, phone, otp, otpExpiry, referralCode };

  // Send OTP
  await sendEmail({ to: email, ...emailTemplates.otp(name, otp) });

  req.flash('info', 'OTP sent to your email. Please verify.');
  res.redirect('/auth/verify-otp');
});

// ============ OTP VERIFICATION ============
const getVerifyOtpPage = asyncHandler(async (req, res) => {
  if (!req.session.pendingUser) return res.redirect('/auth/register');
  res.render('auth/verify-otp', { title: 'Verify OTP', email: req.session.pendingUser.email });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  const pending = req.session.pendingUser;

  if (!pending) {
    req.flash('error', 'Session expired. Please register again.');
    return res.redirect('/auth/register');
  }

  if (new Date() > new Date(pending.otpExpiry)) {
    req.flash('error', 'OTP expired. Please request a new one.');
    return res.redirect('/auth/verify-otp');
  }

  if (pending.otp !== otp.trim()) {
    req.flash('error', 'Invalid OTP. Please try again.');
    return res.redirect('/auth/verify-otp');
  }

  // Create user
  let referredByUser = null;

  // Only process referral if the referral program is still enabled
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (pending.referralCode && flags.referralProgram) {
    referredByUser = await User.findOne({ referralCode: pending.referralCode });
  }

  const user = await User.create({
    name: pending.name,
    email: pending.email,
    password: pending.password,
    phone: pending.phone,
    isEmailVerified: true,
    referredBy: referredByUser?._id,
  });

  // Handle referral bonus (only when program is enabled)
  if (referredByUser && flags.referralProgram) {
    await referredByUser.addWalletTransaction('credit', 100, `Referral bonus - ${user.name} joined`, null);
    referredByUser.referralCount += 1;
    referredByUser.referralEarnings += 100;
    await referredByUser.save();
    await sendEmail({ to: referredByUser.email, ...emailTemplates.referralBonus(referredByUser.name, 100, referredByUser.referralCode) });
  }

  // Send welcome email
  await sendEmail({ to: user.email, ...emailTemplates.welcomeEmail(user.name) });

  delete req.session.pendingUser;

  // Log in the user
  req.session.userId = user._id.toString();
  req.session.userRole = user.role;

  const tokens = generateTokenPair({ userId: user._id, role: user.role });
  setTokenCookies(res, tokens);

  // Merge any items the user added to their cart while browsing as a guest
  await mergeGuestCartIntoUserCart(req, user._id);

  // Signup cashback — only credited when the admin has enabled the feature flag
  if (flags.signupCashbackEnabled && !user.signupCashbackCredited) {
    const commerce = await Setting.getCommerceSettings();
    const cashbackAmount = commerce.signupCashbackAmount;
    if (cashbackAmount > 0) {
      await user.addWalletTransaction('credit', cashbackAmount, 'Welcome cashback for new registration', null);
      user.signupCashbackCredited = true;
      await user.save();
      await notify.walletCredit(user, cashbackAmount, 'Welcome cashback for joining ' + (require('../../config/brand').name));
    }
  }

  const returnTo = req.session.returnTo || '/';
  delete req.session.returnTo;

  req.flash('success', 'Welcome to FootballStore! Account created successfully.');
  res.redirect(returnTo);
});

const resendOtp = asyncHandler(async (req, res) => {
  const pending = req.session.pendingUser;
  if (!pending) return res.json({ success: false, message: 'Session expired' });

  const otp = generateOTP();
  pending.otp = otp;
  pending.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  req.session.pendingUser = pending;

  await sendEmail({ to: pending.email, ...emailTemplates.otp(pending.name, otp) });
  res.json({ success: true, message: 'OTP resent successfully' });
});

// ============ LOGIN ============
const getLoginPage = asyncHandler(async (req, res) => {
  res.render('auth/login', { title: 'Login', returnTo: req.query.returnTo || '/' });
});

const login = asyncHandler(async (req, res) => {
  const { email, password, returnTo } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    req.flash('error', 'Invalid email or password');
    return res.redirect('/auth/login');
  }

  if (user.isLocked) {
    req.flash('error', 'Account is temporarily locked due to too many failed attempts. Try again in 2 hours.');
    return res.redirect('/auth/login');
  }

  if (user.isBlocked) {
    req.flash('error', 'Your account has been blocked. Please contact support.');
    return res.redirect('/auth/login');
  }

  if (user.authProvider === 'google') {
    req.flash('error', 'This account uses Google sign-in. Please use Google to login.');
    return res.redirect('/auth/login');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await user.incrementLoginAttempts();
    req.flash('error', 'Invalid email or password');
    return res.redirect('/auth/login');
  }

  // Reset login attempts on success
  if (user.loginAttempts > 0) {
    await user.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
  }

  // Update last login
  user.lastLoginAt = new Date();
  user.lastLoginIP = getClientIP(req);
  await user.save();

  // Resolve where to send the user after login: explicit form field first,
  // falling back to whatever requireAuth stashed in the session (e.g. /checkout).
  const effectiveReturnTo = returnTo || req.session.returnTo || '/';

  // 2FA check
  if (user.twoFactorEnabled) {
    req.session.twoFAUserId = user._id.toString();
    req.session.twoFAReturnTo = effectiveReturnTo;
    return res.redirect('/auth/2fa');
  }

  // Login alert email (optional)
  if (user.preferences?.emailNotifications) {
    sendEmail({ to: user.email, ...emailTemplates.loginAlert(user.name, getClientIP(req), req.headers['user-agent']?.substring(0, 100)) }).catch(logger.error);
  }

  // Set session
  req.session.userId = user._id.toString();
  req.session.userRole = user.role;

  const tokens = generateTokenPair({ userId: user._id, role: user.role });
  setTokenCookies(res, tokens);

  // Merge any items the user added to their cart while browsing as a guest
  await mergeGuestCartIntoUserCart(req, user._id);

  await AuditLog.create({
    user: user._id,
    action: 'user_login',
    ip: getClientIP(req),
    userAgent: req.headers['user-agent'],
    status: 'success',
  });

  delete req.session.returnTo;
  req.flash('success', `Welcome back, ${user.name}!`);
  res.redirect(effectiveReturnTo);
});

// ============ 2FA ============
const get2FAPage = asyncHandler(async (req, res) => {
  if (!req.session.twoFAUserId) return res.redirect('/auth/login');
  res.render('auth/2fa', { title: 'Two-Factor Authentication' });
});

const verify2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const userId = req.session.twoFAUserId;
  if (!userId) return res.redirect('/auth/login');

  const user = await User.findById(userId).select('+twoFactorSecret');
  if (!user) return res.redirect('/auth/login');

  const isValid = otplib.authenticator.verify({ token, secret: user.twoFactorSecret });
  if (!isValid) {
    req.flash('error', 'Invalid 2FA code');
    return res.redirect('/auth/2fa');
  }

  req.session.userId = user._id.toString();
  req.session.userRole = user.role;
  delete req.session.twoFAUserId;

  const returnTo = req.session.twoFAReturnTo || '/';
  delete req.session.twoFAReturnTo;
  delete req.session.returnTo;

  const tokens = generateTokenPair({ userId: user._id, role: user.role });
  setTokenCookies(res, tokens);

  await mergeGuestCartIntoUserCart(req, user._id);

  res.redirect(returnTo);
});

// ============ LOGOUT ============
const logout = asyncHandler(async (req, res) => {
  clearTokenCookies(res);
  req.session.destroy((err) => {
    if (err) logger.error('Session destroy error:', err);
    res.redirect('/auth/login');
  });
});

// ============ FORGOT PASSWORD ============
const getForgotPasswordPage = asyncHandler(async (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  // Always show success to prevent email enumeration
  if (!user) {
    req.flash('success', 'If the email exists, a reset link has been sent.');
    return res.redirect('/auth/forgot-password');
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth/reset-password/${resetToken}`;
  await sendEmail({ to: user.email, ...emailTemplates.passwordReset(user.name, resetUrl) });

  req.flash('success', 'Password reset link sent to your email.');
  res.redirect('/auth/forgot-password');
});

const getResetPasswordPage = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    req.flash('error', 'Invalid or expired reset token.');
    return res.redirect('/auth/forgot-password');
  }

  res.render('auth/reset-password', { title: 'Reset Password', token });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    req.flash('error', 'Passwords do not match');
    return res.redirect(`/auth/reset-password/${token}`);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpiry: { $gt: Date.now() },
  });

  if (!user) {
    req.flash('error', 'Invalid or expired reset token');
    return res.redirect('/auth/forgot-password');
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  req.flash('success', 'Password reset successfully. Please login with your new password.');
  res.redirect('/auth/login');
});

// ============ GOOGLE OAUTH ============
const googleCallback = asyncHandler(async (req, res) => {
  if (!req.user) {
    req.flash('error', 'Google authentication failed');
    return res.redirect('/auth/login');
  }

  req.session.userId = req.user._id.toString();
  req.session.userRole = req.user.role;

  const tokens = generateTokenPair({ userId: req.user._id, role: req.user.role });
  setTokenCookies(res, tokens);

  await mergeGuestCartIntoUserCart(req, req.user._id);

  if (req.user._wasNewlyCreated) {
    const flags = await Setting.getFeatureFlags();
    if (flags.signupCashbackEnabled && !req.user.signupCashbackCredited) {
      const commerce = await Setting.getCommerceSettings();
      const cashbackAmount = commerce.signupCashbackAmount;
      if (cashbackAmount > 0) {
        await req.user.addWalletTransaction('credit', cashbackAmount, 'Welcome cashback for new registration', null);
        req.user.signupCashbackCredited = true;
        await req.user.save();
        await notify.walletCredit(req.user, cashbackAmount, 'Welcome cashback for joining ' + require('../../config/brand').name);
      }
    }
  }

  const returnTo = req.session.returnTo || '/';
  delete req.session.returnTo;

  req.flash('success', `Welcome, ${req.user.name}!`);
  res.redirect(returnTo);
});

// ============ REFRESH TOKEN ============
const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ success: false, message: 'No refresh token' });

  const decoded = verifyRefreshToken(token);
  if (!decoded) return res.status(401).json({ success: false, message: 'Invalid refresh token' });

  const user = await User.findById(decoded.userId);
  if (!user || user.isBlocked) return res.status(401).json({ success: false, message: 'User not found or blocked' });

  const tokens = generateTokenPair({ userId: user._id, role: user.role });
  setTokenCookies(res, tokens);

  res.json({ success: true, message: 'Tokens refreshed' });
});

module.exports = {
  getRegisterPage, register,
  getVerifyOtpPage, verifyOtp, resendOtp,
  getLoginPage, login,
  get2FAPage, verify2FA,
  logout,
  getForgotPasswordPage, forgotPassword,
  getResetPasswordPage, resetPassword,
  googleCallback,
  refreshToken,
};