const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true },
    maxDiscountAmount: Number,
    applicableTo: { type: String, enum: ['product', 'category', 'brand'], required: true },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    brands: [String],
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

offerSchema.index({ isActive: 1, endDate: 1 });

offerSchema.methods.calculateDiscount = function (price) {
  let discount =
    this.discountType === 'percentage' ? (price * this.discountValue) / 100 : this.discountValue;
  if (this.maxDiscountAmount) discount = Math.min(discount, this.maxDiscountAmount);
  return Math.round(discount);
};

const Offer = mongoose.model('Offer', offerSchema);
module.exports = Offer;
