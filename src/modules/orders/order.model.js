const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName:  { type: String, required: true },
  productImage: String,
  variant: {
    type: {
      // References the product.variants[] SKU entry _id
      variantId:    { type: mongoose.Schema.Types.ObjectId, default: null },
      // Denormalized for display without re-fetching product
      colorId:      { type: mongoose.Schema.Types.ObjectId, default: null },
      sizeId:       { type: mongoose.Schema.Types.ObjectId, default: null },
      color:        { type: String, default: null },
      colorHex:     { type: String, default: null },
      size:         { type: String, default: null },
      sku:          { type: String, default: null },
      variantImage: { type: String, default: null },
    },
    default: null,
  },
  quantity:      { type: Number, required: true },
  price:         { type: Number, required: true },
  originalPrice: Number,
  discountAmount:{ type: Number, default: 0 },
  itemStatus: {
    type: String,
    enum: ['active', 'cancelled', 'returned', 'return_requested'],
    default: 'active',
  },
  cancelReason:       String,
  cancelledAt:        Date,
  returnReason:       String,
  returnRequestedAt:  Date,
});

const trackingSchema = new mongoose.Schema({
  status:       String,
  message:      String,
  location:     String,
  trackingNumber: { type: String, default: null },
  trackingLink:   { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [orderItemSchema],

    shippingAddress: {
      fullName:     { type: String, required: true },
      phone:        { type: String, required: true },
      addressLine1: { type: String, required: true },
      addressLine2: String,
      city:         { type: String, required: true },
      state:        { type: String, required: true },
      pincode:      { type: String, required: true },
      country:      { type: String, default: 'India' },
    },

    subtotal:         { type: Number, required: true },
    discountAmount:   { type: Number, default: 0 },
    couponDiscount:   { type: Number, default: 0 },
    shippingCharge:   { type: Number, default: 0 },
    // taxAmount:        { type: Number, default: 0 },
    walletAmountUsed: { type: Number, default: 0 },
    totalAmount:      { type: Number, required: true },

    couponCode:    String,
    appliedCoupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },

    orderStatus: {
      type: String,
      enum: [
        'pending', 'confirmed', 'packed',
        'dispatched', 'delivered',
        'cancelled', 'returned', 'refunded',
      ],
      default: 'pending',
    },

    paymentMethod: {
      type: String,
      enum: ['razorpay', 'cod', 'wallet', 'mixed'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partial_refund'],
      default: 'pending',
    },
    razorpayOrderId:      { type: String },
    razorpayPaymentId:    { type: String },
    razorpaySignature:    { type: String },
    razorpayPaymentStatus:{ type: String },

    paidAt:       Date,
    // For COD: the amount actually collected at time of "mark as paid" (after deducting cancelled items)
    paidAmount:   { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    refundedAt:   Date,

    trackingHistory:   [trackingSchema],
    trackingNumber:    String,
    trackingLink:      String,
    estimatedDelivery: Date,
    deliveredAt:       Date,

    cancelReason:  String,
    cancelledAt:   Date,
    cancelledBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    notes:       String,
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;