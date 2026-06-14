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


module.exports = {
  getWishlist,
  toggleWishlist,
};
