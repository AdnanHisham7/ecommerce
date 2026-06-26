const User = require('./user.model');
const Order = require('../orders/order.model');
const Wishlist = require('../wishlist/wishlist.model');
const Product = require('../products/product.model');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { cloudinary } = require('../../config/cloudinary');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const env = require('../../config/env');
const Setting = require('../settings/settings.model');

// ============ DASHBOARD ============

const getDashboard = asyncHandler(async (req, res) => {
  const [recentOrders, wishlist, user] = await Promise.all([
    Order.find({ user: req.session.userId }).sort({ createdAt: -1 }).limit(5).lean(),
    Wishlist.findOne({ user: req.session.userId }),
    User.findById(req.session.userId).lean(),
  ]);

  // Check if user exists
  if (!user) {
    req.session.destroy(); // Clean up invalid session
    return res.redirect('/auth/login');
  }

  const totalOrders = await Order.countDocuments({ user: req.session.userId });
  
  // Fix for totalSpent: aggregate can return an empty array
  const totalSpentResult = await Order.aggregate([
    { $match: { user: req.session.userId, paymentStatus: 'paid' } },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);

  res.render('user/dashboard', {
    title: 'My Dashboard',
    user,
    recentOrders,
    stats: {
      totalOrders,
      wishlistCount: wishlist?.products?.length || 0,
      walletBalance: user.walletBalance || 0,
      totalSpent: totalSpentResult[0]?.total || 0,
    },
  });
});

// ============ PROFILE ============


const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  res.render('user/profile', { title: 'My Profile', currentUser:user });
});


const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, dateOfBirth, gender } = req.body;

  const user = await User.findById(req.session.userId);

  if (!user) {
    req.flash("error", "User not found");
    return res.redirect("/profile");
  }

  const updates = { name, phone, dateOfBirth, gender };

  if (req.file) {
    // Delete old avatar
    if (user.avatarPublicId) {
      await cloudinary.uploader
        .destroy(user.avatarPublicId)
        .catch(() => {});
    }

    updates.avatar = req.file.path;
    updates.avatarPublicId = req.file.filename;
  }

  await User.findByIdAndUpdate(req.session.userId, updates);

  req.flash("success", "Profile updated successfully");
  res.redirect("/profile");
});


const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  
  if (newPassword !== confirmPassword) {
    req.flash('error', 'New passwords do not match');
    return res.redirect('/profile');
  }

  const user = await User.findById(req.session.userId).select('+password');
  if (!user.password) throw ApiError.badRequest('No password set (use social login)');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    req.flash('error', 'Current password is incorrect');
    return res.redirect('/profile');
  }

  user.password = newPassword;
  await user.save();
  req.flash('success', 'Password changed successfully');
  res.redirect('/profile');
});

// ============ ADDRESSES ============


const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  res.render('user/addresses', { title: 'My Addresses', addresses: user.addresses || [] });
});


const addAddress = asyncHandler(async (req, res) => {
  const { fullName, phone, addressLine1, addressLine2, city, state, pincode, country, addressType, isDefault } = req.body;

  const user = await User.findById(req.session.userId);
  if (isDefault === 'true') {
    user.addresses.forEach((a) => (a.isDefault = false));
  }
  user.addresses.push({ fullName, phone, addressLine1, addressLine2, city, state, pincode, country, addressType, isDefault: isDefault === 'true' });
  await user.save();

  if (req.xhr || req.headers['content-type']?.includes('application/json')) {
    return res.json({ success: true, message: 'Address added' });
  }
  req.flash('success', 'Address added successfully');
  res.redirect('/profile/addresses');
});


const updateAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;
  const user = await User.findById(req.session.userId);
  const address = user.addresses.id(addressId);
  if (!address) throw ApiError.notFound('Address not found');

  const { fullName, phone, addressLine1, addressLine2, city, state, pincode, country, addressType, isDefault } = req.body;
  
  if (isDefault === 'true') {
    user.addresses.forEach((a) => (a.isDefault = false));
  }

  Object.assign(address, { fullName, phone, addressLine1, addressLine2, city, state, pincode, country, addressType, isDefault: isDefault === 'true' });
  await user.save();

  req.flash('success', 'Address updated');
  res.redirect('/profile/addresses');
});


const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  user.addresses.pull(req.params.addressId);
  await user.save();
  res.json({ success: true, message: 'Address deleted' });
});

// ============ WISHLIST ============


const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session?.userId);
  if (!user) throw ApiError.unauthorized('Please log in to view your orders');

  const wishlist = await Wishlist.findOne({ user: req.session.userId })
    .populate({
      path: 'products.product',
      select: 'name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription',
    })
    .lean();

  res.render('user/wishlist', {
    title: 'My Wishlist',
    wishlist: wishlist || { products: [] },
    currentUser: user,
  });
});


const toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  let wishlist = await Wishlist.findOne({ user: req.session.userId });
  if (!wishlist) wishlist = new Wishlist({ user: req.session.userId, products: [] });

  const idx = wishlist.products.findIndex((p) => p.product.toString() === productId);
  let action;

  if (idx > -1) {
    wishlist.products.splice(idx, 1);
    action = 'removed';
    await Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: -1 } });
  } else {
    wishlist.products.push({ product: productId });
    action = 'added';
    await Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: 1 } });
  }

  await wishlist.save();
  res.json({ success: true, action, message: action === 'added' ? 'Added to wishlist' : 'Removed from wishlist' });
});

// ============ WALLET ============


const getWallet = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId).lean();
  const transactions = user.walletTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.render('user/wallet', {
    title: 'My Wallet',
    walletBalance: user.walletBalance || 0,
    transactions,
    currentUser: user,
  });
});

// ============ NOTIFICATIONS ============


const updatePreferences = asyncHandler(async (req, res) => {
  const { theme, emailNotifications, pushNotifications, orderUpdates, promotions } = req.body;
  await User.findByIdAndUpdate(req.session.userId, {
    'preferences.theme': theme,
    'preferences.emailNotifications': emailNotifications === 'true',
    'preferences.pushNotifications': pushNotifications === 'true',
    'preferences.orderUpdates': orderUpdates === 'true',
    'preferences.promotions': promotions === 'true',
  });
  req.session.theme = theme;
  res.json({ success: true, message: 'Preferences updated' });
});

// ============ 2FA SETUP ============


const setup2FA = asyncHandler(async (req, res) => {
  const secret = speakeasy.generateSecret({ name: `${env.app.name} (${req.user.email})`, length: 20 });
  req.session.twoFASetupSecret = secret.base32;
  const qrCode = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ success: true, qrCode, secret: secret.base32 });
});


const enable2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const secret = req.session.twoFASetupSecret;
  if (!secret) throw ApiError.badRequest('2FA setup session expired');

  const isValid = speakeasy.totp.verify({ secret, encoding: 'base32', token });
  if (!isValid) throw ApiError.badRequest('Invalid verification code');

  await User.findByIdAndUpdate(req.session.userId, {
    twoFactorSecret: secret,
    twoFactorEnabled: true,
  });
  delete req.session.twoFASetupSecret;
  res.json({ success: true, message: '2FA enabled successfully' });
});


const disable2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.findById(req.session.userId).select('+twoFactorSecret');
  const isValid = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token });
  if (!isValid) throw ApiError.badRequest('Invalid code');

  await User.findByIdAndUpdate(req.session.userId, { twoFactorEnabled: false, twoFactorSecret: null });
  res.json({ success: true, message: '2FA disabled' });
});

// ============ REFERRAL ============


const getReferral = asyncHandler(async (req, res) => {
  // Guard: redirect away if referral program is disabled
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (!flags.referralProgram) {
    req.flash('info', 'The referral program is currently unavailable.');
    return res.redirect('/');
  }

  const user = await User.findById(req.session.userId).lean();
  const referredUsers = await User.find({ referredBy: user._id }).select('name createdAt').lean();
  res.render('user/referral', {
    title: 'Referral Program',
    referralCode: user.referralCode,
    referralLink: `${env.app.url}/auth/register?ref=${user.referralCode}`,
    referralCount: user.referralCount || 0,
    referralEarnings: user.referralEarnings || 0,
    referredUsers,
    currentUser: user,
  });
});


module.exports = {
  getDashboard,
  getProfile,
  updateProfile,
  changePassword,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getWishlist,
  toggleWishlist,
  getWallet,
  updatePreferences,
  setup2FA,
  enable2FA,
  disable2FA,
  getReferral,
};
