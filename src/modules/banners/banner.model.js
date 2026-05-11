const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: String,
    image: { type: String, required: true },
    imagePublicId: String,
    link: String,
    position: {
      type: String,
      enum: ['hero', 'home_middle', 'sidebar', 'popup', 'category'],
      default: 'hero',
    },
    isActive: { type: Boolean, default: true },
    startDate: Date,
    endDate: Date,
    sortOrder: { type: Number, default: 0 },
    ctaText: { type: String, default: 'Shop Now' },
    backgroundColor: String,
    textColor: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bannerSchema.index({ position: 1, isActive: 1 });

const Banner = mongoose.model('Banner', bannerSchema);
module.exports = Banner;
