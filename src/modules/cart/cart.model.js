const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variant: {
    // References the _id of the product.variants[] SKU entry
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Denormalized display fields (kept for rendering without re-fetching product)
    colorId:    { type: mongoose.Schema.Types.ObjectId, default: null },
    sizeId:     { type: mongoose.Schema.Types.ObjectId, default: null },
    color:      { type: String, default: null },
    colorHex:   { type: String, default: null },
    size:       { type: String, default: null },
    sku:        { type: String, default: null },
    variantImage: { type: String, default: null },
  },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  price: { type: Number, required: true }, // price at time of adding
  addedAt: { type: Date, default: Date.now },
});

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [cartItemSchema],
    couponCode: String,
    couponDiscount: { type: Number, default: 0 },
    appliedCoupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

cartSchema.virtual('totalItems').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

cartSchema.virtual('total').get(function () {
  return Math.max(0, this.subtotal - this.couponDiscount);
});

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;
