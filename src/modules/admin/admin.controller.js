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


const getProducts = asyncHandler(async (req, res) => {
  const { page = 1, search, category, status, stock } = req.query;
  const filter = {};
  if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { brand: { $regex: search, $options: 'i' } }];
  if (category) filter.category = category;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (stock === 'low') filter.stockStatus = 'low_stock';
  if (stock === 'out') filter.stockStatus = 'out_of_stock';

  const skip = (parseInt(page) - 1) * 15;
  const [products, total, categories] = await Promise.all([
    Product.find(filter).populate('category', 'name').sort({ createdAt: -1 }).skip(skip).limit(15).lean(),
    Product.countDocuments(filter),
    Category.find({ isActive: true }).lean(),
  ]);

  res.render('admin/products/index', {
    title: 'Products',
    products,
    categories,
    pagination: { page: parseInt(page), totalPages: Math.ceil(total / 15), total },
    filters: { search, category, status, stock },
  });
});


const getAddProduct = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).lean();
  res.render('admin/products/add', { title: 'Add Product', categories });
});


const addProduct = asyncHandler(async (req, res) => {
  const {
    name, description, shortDescription, brand, category, subcategory,
    basePrice, compareAtPrice, tags, specifications,
    isFeatured, isNewArrival, isBestSeller, stock, lowStockThreshold,
    variantType, seoTitle, seoDescription, seoKeywords, weight,
  } = req.body;

  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

  const resolvedVariantType = variantType || 'none';

  // Images: not needed for color/color_size (stored per color variant)
  const needsBaseImages = resolvedVariantType === 'none' || resolvedVariantType === 'size';
  const images = needsBaseImages ? (req.files?.map((f) => ({ url: f.path, publicId: f.filename })) || []) : [];

  let parsedSpecs = [];
  if (specifications) {
    try { parsedSpecs = JSON.parse(specifications); } catch { parsedSpecs = []; }
  }

  // Price & stock only meaningful for 'none' variant type at creation time
  const productData = {
    name, slug, description, shortDescription, brand, category, subcategory,
    tags: tags ? tags.split(',').map((t) => t.trim()) : [],
    specifications: parsedSpecs,
    isFeatured: isFeatured === 'true',
    isNewArrival: isNewArrival === 'true',
    isBestSeller: isBestSeller === 'true',
    lowStockThreshold: parseInt(lowStockThreshold) || 5,
    variantType: resolvedVariantType,
    images,
    thumbnail: images[0]?.url,
    weight: weight ? parseFloat(weight) : undefined,
    seo: { metaTitle: seoTitle, metaDescription: seoDescription, keywords: seoKeywords?.split(',') },
    createdBy: req.user._id,
  };

  if (resolvedVariantType === 'none') {
    productData.basePrice = parseFloat(basePrice) || 0;
    productData.compareAtPrice = compareAtPrice ? parseFloat(compareAtPrice) : undefined;
    productData.stock = parseInt(stock) || 0;
  } else {
    // For variant products, set a placeholder basePrice of 0 (will be set via SKU variants)
    productData.basePrice = 0;
    productData.stock = 0;
  }

  const product = await Product.create(productData);

  await AuditLog.create({ user: req.user._id, action: 'product_create', resource: 'Product', resourceId: product._id, ip: req.ip });
  req.flash('success', 'Product added successfully');
  res.redirect(`/admin/products/${product._id}/edit`);
});


const getEditProduct = asyncHandler(async (req, res) => {
  const [product, categories] = await Promise.all([
    Product.findById(req.params.id).lean(),
    Category.find({ isActive: true }).lean(),
  ]);
  if (!product) throw ApiError.notFound('Product not found');
  res.render('admin/products/edit', { title: 'Edit Product', product, categories });
});


const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const {
    name, description, shortDescription, brand, category, basePrice, compareAtPrice,
    tags, isFeatured, isNewArrival, isBestSeller, stock, isActive,
    lowStockThreshold, variantType, seoTitle, seoDescription, seoKeywords,
    specifications, weight,
  } = req.body;

  const resolvedVT = variantType || product.variantType || 'none';

  const updates = {
    name, description, shortDescription, brand, category,
    isFeatured: isFeatured === 'true', isNewArrival: isNewArrival === 'true',
    isBestSeller: isBestSeller === 'true', isActive: isActive === 'true',
    lowStockThreshold: parseInt(lowStockThreshold) || 5,
    tags: tags ? tags.split(',').map((t) => t.trim()) : [],
    weight: weight ? parseFloat(weight) : undefined,
    seo: { metaTitle: seoTitle, metaDescription: seoDescription, keywords: seoKeywords?.split(',') },
    updatedBy: req.user._id,
  };

  // Only update variantType if explicitly provided
  if (variantType) updates.variantType = resolvedVT;

  // Price & stock: only update for 'none' variant type
  if (resolvedVT === 'none') {
    updates.basePrice = parseFloat(basePrice) || 0;
    updates.compareAtPrice = compareAtPrice ? parseFloat(compareAtPrice) : undefined;
    updates.stock = parseInt(stock) || 0;
  }

  if (specifications) {
    try { updates.specifications = JSON.parse(specifications); } catch {}
  }

  // Images: only update for 'none' and 'size' variant types
  const needsBaseImages = resolvedVT === 'none' || resolvedVT === 'size';
  if (req.files?.length && needsBaseImages) {
    const newImages = req.files.map((f) => ({ url: f.path, publicId: f.filename }));
    updates.images = [...product.images, ...newImages];
    if (!product.thumbnail) updates.thumbnail = newImages[0].url;
  }

  await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  await AuditLog.create({ user: req.user._id, action: 'product_update', resource: 'Product', resourceId: product._id, ip: req.ip });
  req.flash('success', 'Product updated successfully');
  res.redirect('/admin/products');
});


const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  req.flash('success', 'Product deactivated');
  res.redirect('/admin/products');
});


const deleteProductImage = asyncHandler(async (req, res) => {
  const { productId, publicId } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  await deleteImage(publicId);
  product.images = product.images.filter((img) => img.publicId !== publicId);
  if (product.thumbnail === publicId) product.thumbnail = product.images[0]?.url || '';
  await product.save();
  res.json({ success: true });
});


const reorderProductImages = asyncHandler(async (req, res) => {
  const { orderedPublicIds } = req.body; // array of publicIds in new order
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const imageMap = Object.fromEntries(product.images.map(img => [img.publicId, img]));
  const reordered = orderedPublicIds.map(pid => imageMap[pid]).filter(Boolean);
  // keep any images not in the list at the end (safety)
  const missing = product.images.filter(img => !orderedPublicIds.includes(img.publicId));
  product.images = [...reordered, ...missing];
  product.thumbnail = product.images[0]?.url || product.thumbnail;
  await product.save();
  res.json({ success: true });
});

// ==================== VARIANT TYPE ====================

/**
 * PUT /admin/products/:id/variant-type
 * Body: { variantType: "none" | "color" | "size" | "color_size" }
 */


const updateVariantType = asyncHandler(async (req, res) => {
  const { variantType } = req.body;
  const allowed = ['none', 'color', 'size', 'color_size'];
  if (!allowed.includes(variantType)) throw ApiError.badRequest('Invalid variantType');

  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  product.variantType = variantType;
  await product.save();
  res.json({ success: true, variantType });
});

// ==================== COLOR VARIANTS ====================


const addColorVariant = asyncHandler(async (req, res) => {
  const { color, colorHex } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!color) throw ApiError.badRequest('Color name is required');

  const exists = product.colorVariants.find(
    (c) => c.color.toLowerCase() === color.toLowerCase()
  );
  if (exists) throw ApiError.badRequest('This color already exists');

  const images = req.files?.map((f) => ({ url: f.path, publicId: f.filename })) || [];
  product.colorVariants.push({ color: color.trim(), colorHex: colorHex || '', images });
  await product.save();

  const newColor = product.colorVariants[product.colorVariants.length - 1];
  res.json({ success: true, message: 'Color added', colorVariant: newColor });
});


const updateColorVariant = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const colorVariant = product.colorVariants.id(req.params.colorId);
  if (!colorVariant) throw ApiError.notFound('Color variant not found');

  const { color, colorHex, isActive } = req.body;
  if (color) colorVariant.color = color.trim();
  if (colorHex !== undefined) colorVariant.colorHex = colorHex;
  if (isActive !== undefined) colorVariant.isActive = isActive !== 'false';

  if (req.files?.length) {
    const newImages = req.files.map((f) => ({ url: f.path, publicId: f.filename }));
    colorVariant.images.push(...newImages);
  }

  await product.save();
  res.json({ success: true, message: 'Color variant updated', colorVariant });
});


const deleteColorVariantImage = asyncHandler(async (req, res) => {
  const { colorId, publicId } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const colorVariant = product.colorVariants.id(colorId);
  if (!colorVariant) throw ApiError.notFound('Color variant not found');

  await deleteImage(publicId).catch(() => {});
  colorVariant.images = colorVariant.images.filter((img) => img.publicId !== publicId);
  await product.save();
  res.json({ success: true });
});


const reorderColorImages = asyncHandler(async (req, res) => {
  const { colorId, orderedPublicIds } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const cv = product.colorVariants.id(colorId);
  if (!cv) throw ApiError.notFound('Color variant not found');

  const imageMap = Object.fromEntries(cv.images.map(img => [img.publicId, img]));
  const reordered = orderedPublicIds.map(pid => imageMap[pid]).filter(Boolean);
  const missing = cv.images.filter(img => !orderedPublicIds.includes(img.publicId));
  cv.images = [...reordered, ...missing];
  await product.save();
  res.json({ success: true });
});


const deleteColorVariant = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const colorVariant = product.colorVariants.id(req.params.colorId);
  if (!colorVariant) throw ApiError.notFound('Color variant not found');

  // Delete cloudinary images
  for (const img of colorVariant.images) {
    await deleteImage(img.publicId).catch(() => {});
  }

  // Remove all SKU variants referencing this colorId
  product.variants = product.variants.filter(
    (v) => v.colorId?.toString() !== req.params.colorId
  );

  product.colorVariants.pull(req.params.colorId);
  await product.save();
  res.json({ success: true });
});

// ==================== SIZE VARIANTS ====================


const addSizeVariant = asyncHandler(async (req, res) => {
  const { size } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!size) throw ApiError.badRequest('Size is required');

  const exists = product.sizeVariants.find(
    (s) => s.size.toLowerCase() === size.toLowerCase()
  );
  if (exists) throw ApiError.badRequest('This size already exists');

  product.sizeVariants.push({ size: size.trim() });
  await product.save();

  const newSize = product.sizeVariants[product.sizeVariants.length - 1];
  res.json({ success: true, message: 'Size added', sizeVariant: newSize });
});


const updateSizeVariant = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const sizeVariant = product.sizeVariants.id(req.params.sizeId);
  if (!sizeVariant) throw ApiError.notFound('Size variant not found');

  const { size, isActive } = req.body;
  if (size) sizeVariant.size = size.trim();
  if (isActive !== undefined) sizeVariant.isActive = isActive !== 'false';

  await product.save();
  res.json({ success: true, message: 'Size variant updated', sizeVariant });
});


const deleteSizeVariant = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  // Remove all SKU variants referencing this sizeId
  product.variants = product.variants.filter(
    (v) => v.sizeId?.toString() !== req.params.sizeId
  );

  product.sizeVariants.pull(req.params.sizeId);
  await product.save();
  res.json({ success: true });
});

// ==================== SKU VARIANTS (replaces colorSizeMatrix) ====================

/**
 * POST /admin/products/:id/variants
 * Upsert a SKU variant.
 *
 * Body fields (all optional except price):
 *   colorId, sizeId, sku, price, compareAtPrice, stock
 *
 * Rules:
 *  - variantType="none"        → colorId & sizeId must be absent/null
 *  - variantType="color"       → colorId required, sizeId must be absent/null
 *  - variantType="size"        → sizeId required, colorId must be absent/null
 *  - variantType="color_size"  → both colorId and sizeId required
 */


const upsertVariant = asyncHandler(async (req, res) => {
  const { colorId, sizeId, sku, price, compareAtPrice, stock } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!price) throw ApiError.badRequest('Price is required');

  const vt = product.variantType;

  // Validate dimensions match variantType
  if (vt === 'color' && !colorId)            throw ApiError.badRequest('colorId is required for color variantType');
  if (vt === 'size'  && !sizeId)             throw ApiError.badRequest('sizeId is required for size variantType');
  if (vt === 'color_size' && (!colorId || !sizeId)) throw ApiError.badRequest('Both colorId and sizeId are required for color_size variantType');

  // Validate referenced colorVariant / sizeVariant exist
  if (colorId && !product.colorVariants.id(colorId)) throw ApiError.badRequest('Color not found on this product');
  if (sizeId  && !product.sizeVariants.id(sizeId))   throw ApiError.badRequest('Size not found on this product');

  // Find existing variant with same colorId + sizeId combination
  const existingVariant = product.variants.find((v) => {
    const cMatch = colorId ? v.colorId?.toString() === colorId : v.colorId == null;
    const sMatch = sizeId  ? v.sizeId?.toString()  === sizeId  : v.sizeId  == null;
    return cMatch && sMatch;
  });

  if (existingVariant) {
    existingVariant.price          = parseFloat(price);
    existingVariant.compareAtPrice = compareAtPrice ? parseFloat(compareAtPrice) : undefined;
    existingVariant.stock          = parseInt(stock) || 0;
    if (sku !== undefined) existingVariant.sku = sku;
    existingVariant.isActive       = true;
  } else {
    product.variants.push({
      colorId:       colorId || null,
      sizeId:        sizeId  || null,
      sku:           sku || '',
      price:         parseFloat(price),
      compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
      stock:         parseInt(stock) || 0,
    });
  }

  await product.save();
  res.json({ success: true, message: 'Variant saved', variants: product.variants });
});

/**
 * PUT /admin/products/:id/variants/:variantId
 * Update price, compareAtPrice, stock, sku, isActive of an existing SKU variant.
 */


const updateVariant = asyncHandler(async (req, res) => {
  const { price, compareAtPrice, stock, sku, isActive } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');

  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw ApiError.notFound('Variant not found');

  if (price !== undefined)          variant.price          = parseFloat(price);
  if (compareAtPrice !== undefined) variant.compareAtPrice = parseFloat(compareAtPrice);
  if (stock !== undefined)          variant.stock          = parseInt(stock);
  if (sku !== undefined)            variant.sku            = sku;
  if (isActive !== undefined)       variant.isActive       = isActive !== 'false';

  await product.save();
  res.json({ success: true, message: 'Variant updated', variant });
});

/**
 * DELETE /admin/products/:id/variants/:variantId
 */


const deleteVariant = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  product.variants.pull(req.params.variantId);
  await product.save();
  res.json({ success: true });
});

// ==================== CATEGORIES ====================


const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().populate('parent', 'name').sort('sortOrder').lean();
  res.render('admin/categories/index', { title: 'Categories', categories });
});


const addCategory = asyncHandler(async (req, res) => {
  const { name, description, parent, isFeatured, sortOrder, seoTitle, seoDescription } = req.body;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const image = req.file ? req.file.path : null;
  const imagePublicId = req.file ? req.file.filename : null;

  await Category.create({ name, slug, description, parent: parent || null, isFeatured: isFeatured === 'true', sortOrder: parseInt(sortOrder) || 0, image, imagePublicId, seo: { metaTitle: seoTitle, metaDescription: seoDescription }, createdBy: req.user._id });
  req.flash('success', 'Category created');
  res.redirect('/admin/categories');
});


const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, parent, isFeatured, sortOrder, isActive } = req.body;
  const updates = { name, description, parent: parent || null, isFeatured: isFeatured === 'true', sortOrder: parseInt(sortOrder) || 0, isActive: isActive === 'true' };
  if (name) updates.slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (req.file) { updates.image = req.file.path; updates.imagePublicId = req.file.filename; }
  await Category.findByIdAndUpdate(req.params.id, updates);
  req.flash('success', 'Category updated');
  res.redirect('/admin/categories');
});


const deleteCategory = asyncHandler(async (req, res) => {
  await Category.findByIdAndUpdate(req.params.id, { isActive: false });
  req.flash('success', 'Category deactivated');
  res.redirect('/admin/categories');
});

// ==================== USERS ====================


const getUsers = asyncHandler(async (req, res) => {
  const { page = 1, search, role, status } = req.query;
  const filter = {};
  if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
  if (role) filter.role = role;
  if (status === 'blocked') filter.isBlocked = true;
  if (status === 'active') filter.isBlocked = false;

  const skip = (parseInt(page) - 1) * 20;
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
    User.countDocuments(filter),
  ]);

  res.render('admin/users/index', {
    title: 'Users',
    users,
    pagination: { page: parseInt(page), totalPages: Math.ceil(total / 20), total },
    filters: { search, role, status },
  });
});


const getUserDetail = asyncHandler(async (req, res) => {
  const [user, orders] = await Promise.all([
    User.findById(req.params.id).lean(),
    Order.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  if (!user) throw ApiError.notFound('User not found');
  const totalSpent = orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.totalAmount, 0);
  res.render('admin/users/detail', { title: `User: ${user.name}`, user, orders, totalSpent });
});


const toggleUserBlock = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'admin') throw ApiError.forbidden('Cannot block admin');

  user.isBlocked = !user.isBlocked;
  user.blockReason = user.isBlocked ? reason : undefined;
  user.blockedAt = user.isBlocked ? new Date() : undefined;
  await user.save();

  await AuditLog.create({ user: req.user._id, action: user.isBlocked ? 'user_block' : 'user_unblock', resource: 'User', resourceId: user._id, ip: req.ip });

  // Notify user via in-app + push
  if (user.isBlocked) {
    await notify.accountBlocked(user);
  } else {
    await notify.accountUnblocked(user);
  }

  res.json({ success: true, isBlocked: user.isBlocked, message: `User ${user.isBlocked ? 'blocked' : 'unblocked'}` });
});

// ==================== ORDERS ====================


const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, status, paymentStatus, search, from, to } = req.query;
  const filter = {};
  if (status) filter.orderStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (search) filter.$or = [{ orderNumber: { $regex: search, $options: 'i' } }];
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (parseInt(page) - 1) * 20;
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
    Order.countDocuments(filter),
  ]);

  res.render('admin/orders/index', {
    title: 'Orders',
    orders,
    pagination: { page: parseInt(page), totalPages: Math.ceil(total / 20), total },
    filters: { status, paymentStatus, search, from, to },
  });
});


const getOrderDetail = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email phone')
    .populate('items.product', 'name images')
    .lean();
  if (!order) throw ApiError.notFound('Order not found');
  res.render('admin/orders/detail', { title: `Order #${order.orderNumber}`, order });
});


const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, trackingNumber, message, trackingLink } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  if (trackingLink && !/^https?:\/\//i.test(trackingLink.trim())) {
    throw ApiError.badRequest('Tracking link must be a valid URL starting with http:// or https://');
  }

  // Only the statuses requested by the business are supported end-to-end:
  // pending → confirmed → packed → dispatched → delivered → returned → refunded,
  // with cancellation possible from pending/confirmed.
  const validTransitions = {
    pending:    ['confirmed', 'cancelled'],
    confirmed:  ['packed', 'cancelled'],
    packed:     ['dispatched'],
    dispatched: ['delivered'],
    delivered:  ['returned'],
    cancelled:  [],
    returned:   ['refunded'],
    refunded:   [],
  };

  if (!validTransitions[order.orderStatus]?.includes(status)) {
    throw ApiError.badRequest(`Cannot transition from ${order.orderStatus} to ${status}`);
  }

  order.orderStatus = status;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (trackingLink) order.trackingLink = trackingLink.trim();
  if (status === 'delivered') {
    order.deliveredAt = new Date();
  }

  // Handle refund when an order moves to refunded (following a return)
  let refundAmount = 0;
  if (status === 'refunded') {
    if (order.paymentStatus === 'paid' && order.paymentMethod !== 'cod') {
      refundAmount = order.totalAmount;
      const customer = await User.findById(order.user);
      if (customer) {
        await customer.addWalletTransaction('credit', refundAmount, `Refund for order #${order.orderNumber}`, order._id);
      }
      order.paymentStatus = 'refunded';
      order.refundAmount = refundAmount;
      order.refundedAt = new Date();
    }
  }

  order.trackingHistory.push({
    status,
    message: message || `Order ${status}`,
    trackingNumber: trackingNumber || undefined,
    trackingLink: trackingLink ? trackingLink.trim() : undefined,
    updatedBy: req.user._id,
  });
  await order.save();

  const user = await User.findById(order.user);
  if (user) {
    if (status === 'refunded') {
      await notify.returnStatus(user, order, 'refunded', refundAmount);
      if (refundAmount > 0) {
        await notify.walletCredit(user, refundAmount, `Refund for order #${order.orderNumber}`);
      }
    } else {
      await notify.orderStatus(user, order, status);
    }
  }

  res.json({ success: true, message: `Order status updated to ${status}` });
});

// ==================== COUPONS ====================


const getCoupons = asyncHandler(async (req, res) => {
  const [coupons, categories, brands] = await Promise.all([
    Coupon.find().sort({ createdAt: -1 }).lean(),
    Category.find({ isActive: true }).select('name slug').sort('name').lean(),
    Product.distinct('brand', { isActive: true, brand: { $nin: [null, ''] } }),
  ]);
  const products = await Product.find({ isActive: true }).select('name brand').sort('name').limit(500).lean();
  res.render('admin/coupons/index', {
    title: 'Coupons',
    coupons,
    categories,
    products,
    brands: brands.filter(Boolean).sort(),
  });
});


const addCoupon = asyncHandler(async (req, res) => {
  const {
    code, description, discountType, discountValue, minOrderAmount,
    maxDiscountAmount, usageLimit, usagePerUser, startDate, endDate,
    isFirstOrderOnly, applyTo,
  } = req.body;

  // Normalize checkbox-group / single-value inputs into arrays
  const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const applicableCategories = applyTo === 'category' ? toArray(req.body.applicableCategories) : [];
  const applicableProducts   = applyTo === 'product'  ? toArray(req.body.applicableProducts)   : [];
  const applicableBrands     = applyTo === 'brand'    ? toArray(req.body.applicableBrands)      : [];

  if (applyTo === 'category' && !applicableCategories.length) {
    throw ApiError.badRequest('Please select at least one category for this coupon');
  }
  if (applyTo === 'product' && !applicableProducts.length) {
    throw ApiError.badRequest('Please select at least one product for this coupon');
  }
  if (applyTo === 'brand' && !applicableBrands.length) {
    throw ApiError.badRequest('Please select at least one brand for this coupon');
  }

  await Coupon.create({
    code: code.toUpperCase(), description, discountType,
    discountValue: parseFloat(discountValue),
    minOrderAmount: parseFloat(minOrderAmount) || 0,
    maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : undefined,
    usageLimit: usageLimit ? parseInt(usageLimit) : null,
    usagePerUser: parseInt(usagePerUser) || 1,
    startDate: startDate || new Date(),
    endDate: new Date(endDate),
    isFirstOrderOnly: isFirstOrderOnly === 'true',
    applyTo: applyTo || 'all',
    applicableCategories,
    applicableProducts,
    applicableBrands,
    createdBy: req.user._id,
  });

  // Broadcast new coupon push notification
  await notify.newCoupon(code.toUpperCase(), description || '');

  req.flash('success', 'Coupon created');
  res.redirect('/admin/coupons');
});


const toggleCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  coupon.isActive = !coupon.isActive;
  await coupon.save();
  res.json({ success: true, isActive: coupon.isActive });
});


const deleteCoupon = asyncHandler(async (req, res) => {
  await Coupon.findByIdAndDelete(req.params.id);
  req.flash('success', 'Coupon deleted');
  res.redirect('/admin/coupons');
});

// ==================== OFFERS ====================


const getOffers = asyncHandler(async (req, res) => {
  const [offers, categories, products] = await Promise.all([
    Offer.find().populate('products', 'name').populate('categories', 'name').sort({ createdAt: -1 }).lean(),
    Category.find({ isActive: true }).lean(),
    Product.find({ isActive: true }).select('name').lean(),
  ]);
  res.render('admin/offers/index', { title: 'Offers', offers, categories, products });
});


const addOffer = asyncHandler(async (req, res) => {
  const {
    name, description, discountType, discountValue, maxDiscountAmount,
    applicableTo, products, categories, brands, startDate, endDate, priority,
  } = req.body;

  const offer = await Offer.create({
    name, description, discountType, discountValue: parseFloat(discountValue),
    maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : undefined,
    applicableTo, priority: parseInt(priority) || 0,
    products: products ? (Array.isArray(products) ? products : [products]) : [],
    categories: categories ? (Array.isArray(categories) ? categories : [categories]) : [],
    brands: brands ? (Array.isArray(brands) ? brands : [brands]) : [],
    startDate: startDate || new Date(),
    endDate: new Date(endDate),
    createdBy: req.user._id,
  });

  await applyOffer(offer);

  // Broadcast push + socket to all users
  const discountText = offer.discountType === 'percentage'
    ? `${offer.discountValue}% off`
    : `₹${offer.discountValue} off`;
  await notify.newOffer(offer.name, discountText);

  req.flash('success', 'Offer created and applied');
  res.redirect('/admin/offers');
});

const applyOffer = async (offer) => {
  const now = new Date();
  if (!offer.isActive || offer.endDate < now) return;

  if (offer.applicableTo === 'product') {
    const products = await Product.find({ _id: { $in: offer.products } });
    for (const p of products) {
      const discount = offer.calculateDiscount(p.basePrice);
      p.activeOffer = offer._id;
      p.discountedPrice = p.basePrice - discount;
      p.discountPercent = offer.discountType === 'percentage' ? offer.discountValue : Math.round((discount / p.basePrice) * 100);
      await p.save();
    }
  } else if (offer.applicableTo === 'category') {
    const products = await Product.find({ category: { $in: offer.categories }, isActive: true });
    for (const p of products) {
      const discount = offer.calculateDiscount(p.basePrice);
      p.activeOffer = offer._id;
      p.discountedPrice = p.basePrice - discount;
      p.discountPercent = offer.discountType === 'percentage' ? offer.discountValue : Math.round((discount / p.basePrice) * 100);
      await p.save();
    }
  }
};


const toggleOffer = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  offer.isActive = !offer.isActive;
  await offer.save();

  if (!offer.isActive) {
    await Product.updateMany({ activeOffer: offer._id }, { $unset: { activeOffer: 1, discountedPrice: 1 }, discountPercent: 0 });
  } else {
    await applyOffer(offer);
  }

  res.json({ success: true, isActive: offer.isActive });
});


const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await Offer.findByIdAndDelete(req.params.id);
  if (offer) {
    await Product.updateMany({ activeOffer: offer._id }, { $unset: { activeOffer: 1, discountedPrice: 1 }, discountPercent: 0 });
  }
  req.flash('success', 'Offer deleted');
  res.redirect('/admin/offers');
});

// ==================== BANNERS ====================


const getBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find().sort('sortOrder').lean();
  res.render('admin/banners/index', { title: 'Banners', banners });
});


const addBanner = asyncHandler(async (req, res) => {
  const { title, subtitle, link, position, ctaText, startDate, endDate } = req.body;
  if (!req.file) throw ApiError.badRequest('Banner image is required');

  // Auto-assign next sort order (highest current + 1)
  const lastBanner = await Banner.findOne().sort('-sortOrder');
  const nextSortOrder = (lastBanner?.sortOrder ?? -1) + 1;

  await Banner.create({
    title, subtitle, link, position, ctaText,
    sortOrder: nextSortOrder,
    image: req.file.path, imagePublicId: req.file.filename,
    startDate: startDate || null, endDate: endDate || null,
    createdBy: req.user._id,
  });
  req.flash('success', 'Banner added');
  res.redirect('/admin/banners');
});


const updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw ApiError.notFound('Banner not found');

  const { title, subtitle, link, position, ctaText, sortOrder, startDate, endDate, isActive } = req.body;

  const updates = {
    title,
    subtitle,
    link,
    position,
    ctaText,
    sortOrder: parseInt(sortOrder) || 0,
    startDate: startDate || null,
    endDate: endDate || null,
    isActive: isActive === 'true',
    updatedBy: req.user._id,
  };

  if (req.file) {
    if (banner.imagePublicId) {
      await deleteImage(banner.imagePublicId).catch(() => {});
    }
    updates.image = req.file.path;
    updates.imagePublicId = req.file.filename;
  }

  await Banner.findByIdAndUpdate(req.params.id, updates, { runValidators: true });
  
  req.flash('success', 'Banner updated successfully');
  res.redirect('/admin/banners');
});


const toggleBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw ApiError.notFound('Banner not found');
  banner.isActive = !banner.isActive;
  await banner.save();
  res.json({ success: true, isActive: banner.isActive });
});


const reorderBanners = asyncHandler(async (req, res) => {
  const { order } = req.body; // Array of banner IDs in their new sequential order
  
  if (!Array.isArray(order)) {
    throw ApiError.badRequest('Invalid order format expected');
  }

  // Perform bulk updates sequentially based on the array index
  const updatePromises = order.map((id, index) => {
    return Banner.findByIdAndUpdate(id, { sortOrder: index });
  });

  await Promise.all(updatePromises);

  res.json({ success: true, message: 'Banners reordered successfully' });
});


const deleteBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (banner?.imagePublicId) await deleteImage(banner.imagePublicId).catch(() => {});
  req.flash('success', 'Banner deleted');
  res.redirect('/admin/banners');
});

// ==================== ANALYTICS ====================


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

// ==================== HOMEPAGE LAYOUT ====================
const SECTION_META = {
  hero:           { label: 'Hero Banner Carousel',   desc: 'Rotating banners set under Banners — hidden automatically if none are active' },
  usp:            { label: 'Trust / USP Bar',        desc: 'Free shipping, returns, brands, rating strip' },
  bestSellers:    { label: 'Best Sellers',           desc: 'Top-selling products' },
  categories:     { label: 'Shop by Category',       desc: 'Category grid' },
  newArrivals:    { label: 'New Arrivals',           desc: 'Recently added products' },
  featured:       { label: 'Featured Products',      desc: 'Hand-picked products (isFeatured)' },
  reviews:        { label: 'Customer Reviews',       desc: 'Testimonial strip' },
  brands:         { label: 'Brand Logos Strip',      desc: 'Stocked-brands showcase' },
  referral:       { label: 'Referral Program Banner',desc: 'Only shown when the Referral Program feature flag is ON' },
  recentlyViewed: { label: 'Recently Viewed',        desc: 'Shown only to logged-in users with browsing history' },
  finalCta:       { label: 'Final Call-to-Action',   desc: '"Ready to Gear Up" closing strip' },
};

const getHomepageLayoutPage = asyncHandler(async (req, res) => {
  const order = await Setting.getHomepageLayout();
  res.render('admin/homepage-layout', { title: 'Homepage Layout', order, sectionMeta: SECTION_META });
});


const getHomepageLayoutSettings = asyncHandler(async (req, res) => {
  const order = await Setting.getHomepageLayout();
  res.json({ success: true, order });
});


const updateHomepageLayout = asyncHandler(async (req, res) => {
  const { order } = req.body;
  try {
    const saved = await Setting.setHomepageLayout(order, req.user._id);
    await AuditLog.create({ user: req.user._id, action: 'homepage_layout_update', details: { order: saved }, ip: req.ip });
    res.json({ success: true, order: saved });
  } catch (err) {
    throw ApiError.badRequest(err.message || 'Invalid layout order');
  }
});

// ==================== PACKAGE SLIP SETTINGS ====================
const getPrintPackageSlips = asyncHandler(async (req, res) => {
  const { orderIds } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    throw ApiError.badRequest('No orders selected');
  }

  const orders = await Order.find({ _id: { $in: orderIds } }).lean();
  if (orders.length === 0) throw ApiError.notFound('Orders not found');

  // Precompute the COD-style "amount in words" once per order rather than
  // re-deriving it inside the EJS template.
  for (const order of orders) {
    order.totalAmountInWords = amountToIndianWords(order.totalAmount).toUpperCase();
  }

  let fromAddressSetting = await Setting.findOne({ key: 'packageSlipFromAddress' });
  let fromAddress = fromAddressSetting?.value || {
    company: 'FootballStore', name: 'Admin', addressLine1: '123 Main Street',
    addressLine2: '', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    country: 'India', phone: '+91 9876543210', email: 'support@footballstore.com',
    customerId: '',
  };

  const SLIPS_PER_PAGE = 4;
  const pages = [];
  for (let i = 0; i < orders.length; i += SLIPS_PER_PAGE) {
    pages.push(orders.slice(i, i + SLIPS_PER_PAGE));
  }

  res.render('admin/orders/print-slips', {
    title: 'Print Package Slips',
    pages,
    fromAddress,
    layout: false,
  });
});


// ==================== MARK COD ORDER AS PAID ====================


const markCodOrderPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.paymentMethod !== 'cod') {
    throw ApiError.badRequest('This action is only available for Cash on Delivery orders');
  }
  if (order.paymentStatus === 'paid') {
    throw ApiError.badRequest('Order is already marked as paid');
  }
  if (['cancelled', 'refunded'].includes(order.orderStatus)) {
    throw ApiError.badRequest('Cannot mark a cancelled or refunded order as paid');
  }

  const commerce = await Setting.getCommerceSettings();

  // ── Recalculate the amount due based ONLY on active (non-cancelled) items ──
  const activeItems = order.items.filter((i) => i.itemStatus === 'active');
  if (activeItems.length === 0) {
    throw ApiError.badRequest('All items in this order have been cancelled. Nothing to collect.');
  }

  const activeSubtotal = activeItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Re-evaluate shipping
  const activeShipping = activeSubtotal >= commerce.freeShippingThreshold ? 0 : commerce.shippingCost;

  // Re-calculate coupon discount against the active subtotal
  let activeCouponDiscount = 0;
  if (order.appliedCoupon) {
    const coupon = await Coupon.findById(order.appliedCoupon);
    if (coupon) {
      activeCouponDiscount = coupon.calculateDiscount(activeSubtotal);
    }
  } else if (order.couponDiscount > 0 && order.subtotal > 0) {
    // Fall back to proportional scaling
    const proportion = activeSubtotal / order.subtotal;
    activeCouponDiscount = parseFloat((order.couponDiscount * proportion).toFixed(2));
  }

  const effectiveTotal = parseFloat(
    Math.max(0, activeSubtotal + activeShipping - activeCouponDiscount - (order.walletAmountUsed || 0)).toFixed(2)
  );

  // Update order totals to reflect the effective (post-cancellation) amounts
  order.subtotal       = activeSubtotal;
  order.shippingCharge = activeShipping;
  order.couponDiscount = activeCouponDiscount;
  order.totalAmount    = effectiveTotal;
  order.paidAmount     = effectiveTotal; // record exact amount collected
  order.paymentStatus  = 'paid';
  order.paidAt         = new Date();
  order.trackingHistory.push({
    status: order.orderStatus,
    message: `Payment collected ₹${effectiveTotal.toFixed(2)} — marked as paid (COD)`,
    updatedBy: req.user._id,
  });
  await order.save();

  // Notify customer
  const user = await User.findById(order.user);
  if (user) {
    await notify.orderStatus(user, order, order.orderStatus);
  }

  res.json({ success: true, message: `Order marked as paid — ₹${effectiveTotal.toFixed(2)} collected` });
});


module.exports = {
  getDashboard,
  getProducts,
  getAddProduct,
  addProduct,
  getEditProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  reorderProductImages,
  updateVariantType,
  addColorVariant,
  updateColorVariant,
  deleteColorVariantImage,
  reorderColorImages,
  deleteColorVariant,
  addSizeVariant,
  updateSizeVariant,
  deleteSizeVariant,
  upsertVariant,
  updateVariant,
  deleteVariant,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getUsers,
  getUserDetail,
  toggleUserBlock,
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  getCoupons,
  addCoupon,
  toggleCoupon,
  deleteCoupon,
  getOffers,
  addOffer,
  toggleOffer,
  deleteOffer,
  getBanners,
  addBanner,
  updateBanner,
  toggleBanner,
  reorderBanners,
  deleteBanner,
  getAdminLogin,
  adminLogin,
  adminLogout,
  getHomepageLayoutPage,
  getHomepageLayoutSettings,
  updateHomepageLayout,
  getPrintPackageSlips,
  markCodOrderPaid,
};
