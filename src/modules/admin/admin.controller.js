const User = require('../users/user.model');
const Product = require('../products/product.model');
const Category = require('../categories/category.model');
const Order = require('../orders/order.model');
const Coupon = require('../coupons/coupon.model');
const Offer = require('../offers/offer.model');
const Banner = require('../banners/banner.model');
const AuditLog = require('../analytics/audit.model');
const Setting = require('../settings/settings.model');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { deleteImage } = require('../../config/cloudinary');
const { sendEmail } = require('../../utils/email');
const notify = require('../../utils/notificationService');
const moment = require('moment');
const { amountToIndianWords } = require('../../utils/numberToWords');

// ==================== DASHBOARD ====================

const getDashboard = asyncHandler(async (req, res) => {
  const today = moment().startOf('day').toDate();
  const thisMonth = moment().startOf('month').toDate();
  const lastMonth = moment().subtract(1, 'month').startOf('month').toDate();
  const lastMonthEnd = moment().subtract(1, 'month').endOf('month').toDate();

  const [
    totalRevenue, monthRevenue, lastMonthRevenue,
    totalOrders, todayOrders, pendingOrders,
    totalUsers, newUsersThisMonth,
    totalProducts, lowStockProducts,
    recentOrders, topProducts,
    revenueByDay, ordersByStatus,
  ] = await Promise.all([
    Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate([{ $match: { paymentStatus: 'paid', createdAt: { $gte: thisMonth } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate([{ $match: { paymentStatus: 'paid', createdAt: { $gte: lastMonth, $lte: lastMonthEnd } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: today } }),
    Order.countDocuments({ orderStatus: 'pending' }),
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: thisMonth } }),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ stockStatus: { $in: ['low_stock', 'out_of_stock'] }, isActive: true }),
    Order.find().sort({ createdAt: -1 }).limit(8).populate('user', 'name email').lean(),
    Product.find({ isActive: true }).sort({ salesCount: -1 }).limit(5).select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription').lean(),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: moment().subtract(7, 'days').toDate() } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
  ]);

  const revenueGrowth = lastMonthRevenue[0]?.total
    ? (((monthRevenue[0]?.total || 0) - lastMonthRevenue[0].total) / lastMonthRevenue[0].total) * 100
    : 0;

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats: {
      totalRevenue: totalRevenue[0]?.total || 0,
      monthRevenue: monthRevenue[0]?.total || 0,
      revenueGrowth: revenueGrowth.toFixed(1),
      totalOrders, todayOrders, pendingOrders,
      totalUsers, newUsersThisMonth,
      totalProducts, lowStockProducts,
    },
    recentOrders,
    topProducts,
    revenueByDay,
    ordersByStatus,
  });
});

// ==================== PRODUCTS ====================


const getAdminLogin = asyncHandler(async (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/auth/login', { title: 'Admin Login' });
});


const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase(), role: { $in: ['admin', 'staff'] } }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    req.flash('error', 'Invalid admin credentials');
    return res.redirect('/admin/login');
  }
  if (user.isBlocked) {
    req.flash('error', 'Account is blocked');
    return res.redirect('/admin/login');
  }

  req.session.userId = user._id.toString();
  req.session.adminId = user._id.toString();
  req.session.userRole = user.role;

  await AuditLog.create({ user: user._id, action: 'admin_login', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.redirect('/admin/dashboard');
});


const adminLogout = asyncHandler(async (req, res) => {
  await AuditLog.create({ user: req.user?._id, action: 'admin_logout', ip: req.ip }).catch(() => {});
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ==================== STOCK MANAGEMENT ====================


module.exports = {
  getDashboard,
  getAdminLogin,
  adminLogin,
  adminLogout,
};
