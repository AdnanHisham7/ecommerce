const mongoose = require('mongoose');
const brand = require('../../config/brand');

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  type: { type: String, enum: ['string', 'number', 'boolean', 'object', 'array'], default: 'string' },
  description: String,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── Feature-flags helper ───────────────────────────────────────────────────────
const DEFAULT_FLAGS = {
  maintenanceMode: false,
  newRegistrations: true,
  referralProgram: true,
  reviewSystem: true,
  pushNotifications: true,
  signupCashbackEnabled: false,
};

settingSchema.statics.getFeatureFlags = async function () {
  const doc = await this.findOne({ key: 'featureFlags' });
  if (!doc) return { ...DEFAULT_FLAGS };
  return { ...DEFAULT_FLAGS, ...doc.value };
};

settingSchema.statics.setFeatureFlag = async function (flag, value, updatedBy) {
  if (!(flag in DEFAULT_FLAGS)) throw new Error(`Unknown feature flag: ${flag}`);
  const doc = await this.findOneAndUpdate(
    { key: 'featureFlags' },
    {
      $set: {
        [`value.${flag}`]: value,
        type: 'object',
        description: 'Feature flags for runtime feature toggling',
        updatedBy,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc.value;
};

// ── Commerce settings helper ──────────────────────────────────────────────────
// These fall back to brand.js values if not overridden in DB.
const DEFAULT_COMMERCE = {
  freeShippingThreshold: 999,   // ₹ — one-time seed default; admin-editable thereafter
  shippingCost: 80,             // ₹ — one-time seed default; admin-editable thereafter
  referralBonus: brand.commerce.referralBonus,
  walletCashbackPercent: brand.commerce.walletCashbackPercent,
  signupCashbackAmount: 50,
};

settingSchema.statics.getCommerceSettings = async function () {
  const doc = await this.findOne({ key: 'commerceSettings' });
  if (!doc) return { ...DEFAULT_COMMERCE };
  return { ...DEFAULT_COMMERCE, ...doc.value };
};

settingSchema.statics.updateCommerceSettings = async function (updates, updatedBy) {
  const allowed = ['freeShippingThreshold', 'shippingCost', 'signupCashbackAmount'];
  const $set = { type: 'object', description: 'Commerce settings (shipping, cashback)', updatedBy };
  for (const key of allowed) {
    if (updates[key] === undefined || updates[key] === null || updates[key] === '') continue;
    const num = parseFloat(updates[key]);
    if (Number.isNaN(num) || num < 0) throw new Error(`Invalid value for ${key}`);
    $set[`value.${key}`] = num;
  }
  const doc = await this.findOneAndUpdate(
    { key: 'commerceSettings' },
    { $set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { ...DEFAULT_COMMERCE, ...doc.value };
};

// ── Homepage layout helper ────────────────────────────────────────────────────
// Ordered list of section keys rendered on the home page (excludes navbar/footer,
// which are part of the shared layout and are not part of this list).
const DEFAULT_HOMEPAGE_SECTIONS = [
  'hero', 'usp', 'bestSellers', 'categories', 'newArrivals',
  'featured', 'reviews', 'brands', 'referral', 'recentlyViewed', 'finalCta',
];

settingSchema.statics.getHomepageLayout = async function () {
  const doc = await this.findOne({ key: 'homepageLayout' });
  const stored = Array.isArray(doc?.value) ? doc.value : [];
  // Keep only known sections, then append any new sections that aren't stored yet
  // (so newly-added sections in future releases still show up).
  const valid = stored.filter((s) => DEFAULT_HOMEPAGE_SECTIONS.includes(s));
  const missing = DEFAULT_HOMEPAGE_SECTIONS.filter((s) => !valid.includes(s));
  return [...valid, ...missing];
};

settingSchema.statics.setHomepageLayout = async function (order, updatedBy) {
  if (!Array.isArray(order) || !order.length) throw new Error('Invalid layout order');
  const valid = order.filter((s) => DEFAULT_HOMEPAGE_SECTIONS.includes(s));
  const missing = DEFAULT_HOMEPAGE_SECTIONS.filter((s) => !valid.includes(s));
  const finalOrder = [...valid, ...missing];
  await this.findOneAndUpdate(
    { key: 'homepageLayout' },
    {
      $set: {
        value: finalOrder,
        type: 'array',
        description: 'Order of homepage sections (admin-customisable)',
        updatedBy,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return finalOrder;
};

settingSchema.statics.HOMEPAGE_SECTIONS = DEFAULT_HOMEPAGE_SECTIONS;

module.exports = mongoose.model('Setting', settingSchema);