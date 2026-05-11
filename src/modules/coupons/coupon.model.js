const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: String,
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscountAmount: Number,
    usageLimit: { type: Number, default: null }, // null = unlimited
    usagePerUser: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    usedBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        usedAt: { type: Date, default: Date.now },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
      },
    ],
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },

    // Binding: restricts which cart items the coupon's discount applies to.
    // 'all'      → applies to the whole cart (default, backward-compatible)
    // 'category' → only items whose product.category is in applicableCategories
    // 'product'  → only items whose product is in applicableProducts
    // 'brand'    → only items whose product.brand is in applicableBrands
    applyTo: { type: String, enum: ['all', 'category', 'product', 'brand'], default: 'all' },
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    applicableBrands: [{ type: String, trim: true }],
    userSpecific: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isFirstOrderOnly: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, endDate: 1 });

couponSchema.methods.isValid = function (userId, orderAmount) {
  const now = new Date();
  if (!this.isActive) return { valid: false, message: 'Coupon is not active' };
  if (now < this.startDate) return { valid: false, message: 'Coupon is not yet active' };
  if (now > this.endDate) return { valid: false, message: 'Coupon has expired' };
  if (this.usageLimit && this.usedCount >= this.usageLimit)
    return { valid: false, message: 'Coupon usage limit reached' };
  if (orderAmount < this.minOrderAmount)
    return { valid: false, message: `Minimum order amount is ₹${this.minOrderAmount}` };
  // Per-user usage limit can only be checked for logged-in users. Guests are allowed
  // to preview a coupon; the check is re-run once they're authenticated (cart page
  // always requires login before checkout, so this is re-validated before payment).
  if (userId) {
    const userUsage = this.usedBy.filter((u) => u.user.toString() === userId.toString()).length;
    if (userUsage >= this.usagePerUser)
      return { valid: false, message: 'You have already used this coupon' };
  }
  return { valid: true };
};

couponSchema.methods.calculateDiscount = function (orderAmount) {
  let discount =
    this.discountType === 'percentage'
      ? (orderAmount * this.discountValue) / 100
      : this.discountValue;
  if (this.maxDiscountAmount) discount = Math.min(discount, this.maxDiscountAmount);
  return Math.round(discount);
};

/**
 * Given cart items (each with a populated `product` containing at least
 * `_id`, `category`, and `brand`), returns only the items this coupon's
 * discount is allowed to apply to, based on `applyTo` binding.
 * For applyTo === 'all' every item is eligible.
 */
couponSchema.methods.getEligibleItems = function (items) {
  if (!items || !items.length) return [];
  if (this.applyTo === 'all' || !this.applyTo) return items;

  if (this.applyTo === 'category') {
    const allowed = (this.applicableCategories || []).map((c) => c.toString());
    return items.filter((i) => {
      const catId = i.product?.category?._id || i.product?.category;
      return catId && allowed.includes(catId.toString());
    });
  }

  if (this.applyTo === 'product') {
    const allowed = (this.applicableProducts || []).map((p) => p.toString());
    return items.filter((i) => {
      const prodId = i.product?._id || i.product;
      return prodId && allowed.includes(prodId.toString());
    });
  }

  if (this.applyTo === 'brand') {
    const allowed = (this.applicableBrands || []).map((b) => b.trim().toLowerCase());
    return items.filter((i) => {
      const brandName = (i.product?.brand || '').trim().toLowerCase();
      return brandName && allowed.includes(brandName);
    });
  }

  return items;
};

const Coupon = mongoose.model('Coupon', couponSchema);
module.exports = Coupon;