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
  getAdminLogin,
  adminLogin,
  adminLogout,
};
