const mongoose = require('mongoose');

// ─────────────────────────────────────────────
//  Sub-schemas: colorVariants & sizeVariants
//  (kept as-is per requirements)
// ─────────────────────────────────────────────
const colorVariantSchema = new mongoose.Schema({
  color: { type: String, required: true, trim: true },
  colorHex: { type: String, trim: true },
  images: [{ url: { type: String, required: true }, publicId: String }],
  isActive: { type: Boolean, default: true },
});

const sizeVariantSchema = new mongoose.Schema({
  size: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true },
});

// ─────────────────────────────────────────────
//  NEW: SKU-based variant schema
//  Each document = one sellable SKU
//
//  variantType = "none"        → no variants (colorId: null, sizeId: null)
//  variantType = "color"       → colorId set, sizeId: null
//  variantType = "size"        → sizeId set, colorId: null
//  variantType = "color_size"  → both colorId & sizeId set
// ─────────────────────────────────────────────
const variantSchema = new mongoose.Schema({
  colorId:       { type: mongoose.Schema.Types.ObjectId, default: null },
  sizeId:        { type: mongoose.Schema.Types.ObjectId, default: null },
  sku:           { type: String, trim: true },
  price:         { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  stock:         { type: Number, default: 0, min: 0 },
  isActive:      { type: Boolean, default: true },
});

const specificationSchema = new mongoose.Schema({
  key: String,
  value: String,
});

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: String,
    comment: { type: String, required: true },
    images: [{ url: String, publicId: String }],
    isVerifiedPurchase: { type: Boolean, default: false },
    helpful: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isApproved: { type: Boolean, default: true },
    adminReply: String,
    adminRepliedAt: Date,
  },
  { timestamps: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true },
    shortDescription: String,
    brand: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },

    // Pricing — only required when variantType = "none"
    // For color / size / color_size, price lives on each SKU variant
    basePrice: {
      type: Number,
      required: function () { return this.variantType === 'none'; },
      default: function () { return this.variantType === 'none' ? undefined : 0; },
    },
    compareAtPrice: Number,

    // Images — required for "none" and "size" variant types
    // For "color" and "color_size", images are stored per color variant
    images: [{ url: { type: String, required: true }, publicId: String, alt: String }],
    thumbnail: String,

    // ── Variant System ──────────────────────────────────────────────
    colorVariants: [colorVariantSchema],
    sizeVariants:  [sizeVariantSchema],

    // Determines which variant dimensions are used
    variantType: {
      type: String,
      enum: ['none', 'color', 'size', 'color_size'],
      default: 'none',
    },

    // SKU-level inventory entries (replaces colorSizeMatrix)
    variants: [variantSchema],
    // ────────────────────────────────────────────────────────────────

    // Stock used only when variantType = "none"
    stock: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    stockStatus: {
      type: String,
      enum: ['in_stock', 'low_stock', 'out_of_stock'],
      default: 'in_stock',
    },

    specifications: [specificationSchema],
    tags: [String],

    isActive:    { type: Boolean, default: true },
    isFeatured:  { type: Boolean, default: false },
    isNewArrival:{ type: Boolean, default: false },
    isBestSeller:{ type: Boolean, default: false },

    reviews:     [reviewSchema],
    avgRating:   { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },

    viewCount:     { type: Number, default: 0 },
    salesCount:    { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },

    activeOffer:    { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
    discountPercent:{ type: Number, default: 0 },
    discountedPrice: Number,

    frequentlyBoughtWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    relatedProducts:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    seo: {
      metaTitle: String,
      metaDescription: String,
      keywords: [String],
    },

    weight: Number,
    dimensions: { length: Number, width: Number, height: Number },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ──────────────────────────────────
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: 'text', description: 'text', brand: 'text', tags: 'text' });
productSchema.index({ basePrice: 1 });
productSchema.index({ avgRating: -1 });
productSchema.index({ salesCount: -1 });
productSchema.index({ createdAt: -1 });

// ── Virtuals ─────────────────────────────────
productSchema.virtual('effectivePrice').get(function () {
  if (this.discountedPrice && this.discountedPrice < this.basePrice) return this.discountedPrice;
  return this.basePrice;
});

/**
 * Returns the best thumbnail URL for this product.
 * - For color/color_size products with no base images: use first image of first active color variant.
 * - Otherwise use first product image or stored thumbnail.
 */
productSchema.virtual('effectiveThumbnail').get(function () {
  const needsColorImg = this.variantType === 'color' || this.variantType === 'color_size';
  if (needsColorImg && (!this.images || this.images.length === 0)) {
    const firstActive = (this.colorVariants || []).find(cv => cv.isActive && cv.images?.length);
    if (firstActive) return firstActive.images[0].url;
  }
  return this.images?.[0]?.url || this.thumbnail || null;
});

productSchema.virtual('discountPercentage').get(function () {
  if (this.compareAtPrice && this.compareAtPrice > this.basePrice) {
    return Math.round(((this.compareAtPrice - this.basePrice) / this.compareAtPrice) * 100);
  }
  return this.discountPercent || 0;
});

productSchema.virtual('totalStock').get(function () {
  if (this.variantType !== 'none' && this.variants && this.variants.length > 0) {
    return this.variants.reduce((sum, v) => sum + (v.isActive ? v.stock : 0), 0);
  }
  return this.stock;
});

productSchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  const total = this.totalStock;
  if (total === 0)                           this.stockStatus = 'out_of_stock';
  else if (total <= this.lowStockThreshold)  this.stockStatus = 'low_stock';
  else                                       this.stockStatus = 'in_stock';

  // For variant products, also update thumbnail from first color variant if no base images
  if ((this.variantType === 'color' || this.variantType === 'color_size') && (!this.images || this.images.length === 0)) {
    const firstActive = (this.colorVariants || []).find(cv => cv.isActive && cv.images?.length);
    if (firstActive && !this.thumbnail) this.thumbnail = firstActive.images[0].url;
  } else if (this.images?.length && !this.thumbnail) {
    this.thumbnail = this.images[0].url;
  }

  if (this.reviews.length > 0) {
    const approved = this.reviews.filter((r) => r.isApproved);
    this.avgRating = approved.length > 0
      ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length
      : 0;
    this.reviewCount = approved.length;
  }
  next();
});

// ── Instance helpers ──────────────────────────

/**
 * Find a single variant by colorId and/or sizeId depending on variantType.
 * Pass null for dimensions that don't apply.
 */
productSchema.methods.findVariant = function (colorId, sizeId) {
  return this.variants.find((v) => {
    const colorMatch = colorId ? v.colorId?.toString() === colorId.toString() : v.colorId == null;
    const sizeMatch  = sizeId  ? v.sizeId?.toString()  === sizeId.toString()  : v.sizeId  == null;
    return colorMatch && sizeMatch && v.isActive;
  }) || null;
};

/**
 * Get active sizes for a given colorId (color_size type only).
 */
productSchema.methods.getSizesForColor = function (colorId) {
  return this.variants
    .filter((v) => v.colorId?.toString() === colorId.toString() && v.isActive)
    .map((v) => {
      const sizeVariant = this.sizeVariants.id(v.sizeId);
      return { ...sizeVariant?.toObject(), price: v.price, stock: v.stock, variantId: v._id };
    })
    .filter((s) => s._id);
};

/**
 * Get active colors for a given sizeId (color_size type only).
 */
productSchema.methods.getColorsForSize = function (sizeId) {
  return this.variants
    .filter((v) => v.sizeId?.toString() === sizeId.toString() && v.isActive)
    .map((v) => {
      const colorVariant = this.colorVariants.id(v.colorId);
      return { ...colorVariant?.toObject(), price: v.price, stock: v.stock, variantId: v._id };
    })
    .filter((c) => c._id);
};

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
