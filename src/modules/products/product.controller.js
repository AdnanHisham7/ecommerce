const Product = require('./product.model');
const Category = require('../categories/category.model');
const Wishlist = require('../wishlist/wishlist.model');
const User = require('../users/user.model');
const Setting = require('../settings/settings.model');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');

// ============ SHOP / LISTING ============
const getShopPage = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 12, category, brand, minPrice, maxPrice,
    sort = 'newest', search, rating, offer, inStock
  } = req.query;

  const filter = { isActive: true };

  const user = await User.findById(req.session?.userId);

  if (category) {
    const cat = await Category.findOne({ slug: category });
    if (cat) filter.category = cat._id;
  }
  if (brand) filter.brand = { $regex: brand, $options: 'i' };
  if (minPrice || maxPrice) {
    filter.basePrice = {};
    if (minPrice) filter.basePrice.$gte = parseFloat(minPrice);
    if (maxPrice) filter.basePrice.$lte = parseFloat(maxPrice);
  }
  if (rating) filter.avgRating = { $gte: parseFloat(rating) };
  if (offer === 'true') filter.discountPercent = { $gt: 0 };
  if (inStock === 'true') filter.stockStatus = 'in_stock';
  if (search) filter.$text = { $search: search };

  const sortOptions = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { basePrice: 1 },
    price_desc: { basePrice: -1 },
    rating: { avgRating: -1 },
    popular: { salesCount: -1 },
    name_asc: { name: 1 },
    name_desc: { name: -1 },
  };

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [products, total] = await Promise.all([
    Product.find(filter).select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || sortOptions.newest)
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Product.countDocuments(filter),
  ]);

  // Get wishlist for user
  let wishlistProductIds = [];
  if (user) {
    const wishlist = await Wishlist.findOne({ user: req.session.userId });
    wishlistProductIds = wishlist?.products.map((p) => p.product.toString()) || [];
  }

  const categories = await Category.find({ isActive: true, parent: null }).sort('sortOrder').lean();
  const brands = await Product.distinct('brand', { isActive: true });

  const totalPages = Math.ceil(total / parseInt(limit));

  res.render('user/shop', {
    title: 'AD21 - Shop',
    products,
    wishlistProductIds,
    categories,
    brands: brands.filter(Boolean),
    pagination: { page: parseInt(page), totalPages, total, limit: parseInt(limit) },
    filters: { category, brand, minPrice, maxPrice, sort, search, rating, offer, inStock },
  });
});

// ============ PRODUCT DETAIL ============
const getProductDetail = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const user  = await User.findById(req.session?.userId);

  const product = await Product.findOne({ slug, isActive: true })
    .populate('category', 'name slug')
    .populate('reviews.user', 'name avatar')
    .populate('relatedProducts', 'name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
    .populate('frequentlyBoughtWith', 'name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
    .lean();

  if (!product) throw ApiError.notFound('Product not found');

  // Increment view count
  await Product.findByIdAndUpdate(product._id, { $inc: { viewCount: 1 } });

  // Add to recently viewed
  if (user) {
    user.addToRecentlyViewed(product._id).catch(() => {});
  }

  // Wishlist check
  let isInWishlist = false;
  if (user) {
    const wishlist = await Wishlist.findOne({ user: user._id });
    isInWishlist = wishlist?.products.some((p) => p.product.toString() === product._id.toString()) || false;
  }

  // Related products from same category if not set
  let relatedProducts = product.relatedProducts || [];
  if (relatedProducts.length < 4) {
    const additional = await Product.find({
      category: product.category?._id,
      _id: { $ne: product._id },
      isActive: true,
    })
      .select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
      .limit(8)
      .lean();
    relatedProducts = [...relatedProducts, ...additional].slice(0, 8);
  }

  res.render('user/product-detail', {
    title: `${product.name} - Football Store`,
    product,
    relatedProducts,
    isInWishlist,
    seo: product.seo || {},
  });
});

// ============ SEARCH AUTOCOMPLETE ============
const searchAutocomplete = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session?.userId);

  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ results: [] });

  const products = await Product.find({
    $text: { $search: q },
    isActive: true,
  })
    .select('name slug images basePrice thumbnail')
    .limit(6)
    .lean();

  const categories = await Category.find({
    name: { $regex: q, $options: 'i' },
    isActive: true,
  })
    .select('name slug')
    .limit(3)
    .lean();

  // Save search for user
  if (user && q.length > 2) {
    user.savedSearches = user.savedSearches || [];
    const exists = user.savedSearches.find((s) => s.query === q);
    if (!exists) {
      user.savedSearches.unshift({ query: q });
      if (user.savedSearches.length > 10) user.savedSearches.pop();
      user.save().catch(() => {});
    }
  }

  res.json({ results: products, categories });
});

// ============ REVIEW SUBMIT ============
const submitReview = asyncHandler(async (req, res) => {
  // Guard: review system flag
  const flags = res.locals.featureFlags || await Setting.getFeatureFlags();
  if (!flags.reviewSystem) {
    req.flash('error', 'Reviews are currently disabled.');
    return res.redirect('back');
  }

  const { productId, rating, title, comment } = req.body;

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  // Check for existing review
  const existing = product.reviews.find((r) => r.user.toString() === req.session.userId.toString());
  if (existing) {
    existing.rating = parseInt(rating);
    existing.title = title;
    existing.comment = comment;
  } else {
    product.reviews.push({
      user: req.session.userId,
      rating: parseInt(rating),
      title,
      comment,
      isVerifiedPurchase: false, // TODO: check order history
    });
  }

  await product.save();
  req.flash('success', 'Review submitted successfully!');
  res.redirect(`/products/${product.slug}`);
});

// ============ HOME PAGE ============
const getHomePage = asyncHandler(async (req, res) => {
  const [featured, newArrivals, bestSellers, banners, categories, sectionOrder] = await Promise.all([
    Product.find({ isFeatured: true, isActive: true })
      .select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
      .limit(8).lean(),
    Product.find({ isNewArrival: true, isActive: true })
      .select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
      .sort({ createdAt: -1 }).limit(8).lean(),
    Product.find({ isActive: true })
      .select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription')
      .sort({ salesCount: -1 }).limit(8).lean(),
    require('../banners/banner.model').find({
      isActive: true,
      position: 'hero',
      $or: [
        { startDate: { $exists: false } },
        { startDate: null },
        { startDate: { $lte: new Date() } }
      ],
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: { $gte: new Date() } }
      ]
    }).sort('sortOrder').limit(5).lean(),
    Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).limit(8).lean(),
    Setting.getHomepageLayout(),
  ]);

  // Recently viewed for logged-in user
  let recentlyViewed = [];
  const user = await User.findById(req.session?.userId);
  if (user?.recentlyViewed?.length) {
    recentlyViewed = await Product.find({
      _id: { $in: user.recentlyViewed.slice(0, 6).map((r) => r.product) },
      isActive: true,
    }).select('name slug images thumbnail basePrice compareAtPrice discountPercent discountedPrice avgRating reviewCount stockStatus brand isFeatured isNewArrival variantType colorVariants variants description shortDescription').lean();
  }

  res.render('user/home', {
    title: 'AD21 - A Complete Football Store',
    featured,
    newArrivals,
    bestSellers,
    banners,
    categories,
    recentlyViewed,
    sectionOrder,
  });
});


// ── Get saved searches for logged-in user (shown in search dropdown) ──────────
const getSavedSearches = asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ searches: [] });
  const user = await User.findById(req.user._id).select('savedSearches').lean();
  const searches = (user?.savedSearches || []).slice(0, 8).map(s => s.query);
  res.json({ searches });
});

module.exports = {
  getShopPage,
  getProductDetail,
  searchAutocomplete,
  getSavedSearches,
  submitReview,
  getHomePage,
};