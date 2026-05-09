const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const addressSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  addressLine1: { type: String, required: true, trim: true },
  addressLine2: { type: String, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  pincode: { type: String, required: true },
  country: { type: String, default: 'India' },
  isDefault: { type: Boolean, default: false },
  addressType: { type: String, enum: ['home', 'office', 'other'], default: 'home' },
});

const deviceSchema = new mongoose.Schema({
  deviceId: String,
  userAgent: String,
  ip: String,
  lastLogin: { type: Date, default: Date.now },
  trusted: { type: Boolean, default: false },
});

const walletTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  referenceId: String,
  balanceAfter: Number,
  createdAt: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    phone: { type: String, trim: true },
    avatar: { type: String, default: '' },
    avatarPublicId: String,
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    googleId: { type: String, sparse: true },
    role: { type: String, enum: ['user', 'admin', 'staff'], default: 'user' },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockReason: String,
    blockedAt: Date,

    // OTP
    otp: String,
    otpExpiry: Date,
    otpAttempts: { type: Number, default: 0 },

    // Password reset
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpiry: { type: Date, select: false },

    // 2FA
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },

    // Security
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    devices: [deviceSchema],
    lastLoginAt: Date,
    lastLoginIP: String,

    // Addresses
    addresses: [addressSchema],

    // Wallet
    walletBalance: { type: Number, default: 0 },
    walletTransactions: [walletTransactionSchema],

    // Referral
    referralCode: { type: String, unique: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referralCount: { type: Number, default: 0 },
    referralEarnings: { type: Number, default: 0 },

    // Signup cashback (one-time, admin-toggleable reward for newly registered users)
    signupCashbackCredited: { type: Boolean, default: false },

    // Preferences
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      emailNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: true },
      language: { type: String, default: 'en' },
    },

    // Activity tracking
    savedSearches: [{ query: String, savedAt: { type: Date, default: Date.now } }],
    recentlyViewed: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        viewedAt: { type: Date, default: Date.now },
      },
    ],
    pushSubscription: mongoose.Schema.Types.Mixed,

    // Staff specific
    permissions: [{
      type: String,
      enum: [
        'manage_products',
        'manage_orders',
        'manage_users',
        'manage_coupons',
        'manage_offers',
        'manage_banners',
        'view_analytics',
        'manage_categories',
        'manage_staff',
        'manage_settings',
      ],
    }],
    managedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },

    // Profile
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },

    // Notifications
    notifications: [
      {
        type: {
          type: String,
          enum: ['order', 'offer', 'referral', 'system', 'payment'],
        },
        message: String,
        link: String,
        isRead: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
userSchema.index({ role: 1, isBlocked: 1 });

// Pre-save hooks
userSchema.pre('save', async function (next) {
  if (!this.referralCode) {
    this.referralCode = `FS${this.name.substring(0, 3).toUpperCase()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  }
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

// Account lock virtual
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Methods
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  return this.updateOne(updates);
};

userSchema.methods.addWalletTransaction = async function (type, amount, description, orderId = null) {
  const amt = parseFloat(amount) || 0;
  if (amt <= 0) return this; // No-op for zero or negative amounts

  let balanceAfter;
  if (type === 'credit') {
    balanceAfter = parseFloat((this.walletBalance + amt).toFixed(2));
  } else {
    // Guard: never allow wallet to go below 0
    if (this.walletBalance < amt) {
      throw new Error('Insufficient wallet balance. Available: ' + this.walletBalance + ', Required: ' + amt);
    }
    balanceAfter = parseFloat((this.walletBalance - amt).toFixed(2));
  }

  this.walletBalance = balanceAfter;
  this.walletTransactions.push({ type, amount: amt, description, orderId, balanceAfter });
  return this.save();
};

userSchema.methods.addToRecentlyViewed = async function (productId) {
  this.recentlyViewed = this.recentlyViewed.filter(
    (item) => item.product.toString() !== productId.toString()
  );
  this.recentlyViewed.unshift({ product: productId });
  if (this.recentlyViewed.length > 20) this.recentlyViewed.pop();
  return this.save();
};

userSchema.methods.markNotificationsRead = async function () {
  this.notifications.forEach((n) => (n.isRead = true));
  return this.save();
};

const User = mongoose.model('User', userSchema);
module.exports = User;