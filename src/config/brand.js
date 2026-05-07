/**
 * ═══════════════════════════════════════════════════════════
 *  BRAND CONFIGURATION — AD21 Store
 *  Single source of truth for all company/brand information.
 *  Change anything here and it propagates everywhere.
 * ═══════════════════════════════════════════════════════════
 */

const brand = {
  // ── Business identity ──────────────────────────────────────
  name: 'AD21 Store',
  tagline: 'A complete football store',
  description: 'Your one-stop destination for premium football gear. From jerseys to boots, we\'ve got everything a football enthusiast needs.',

  // ── Contact info ───────────────────────────────────────────
  email: 'ad21sportsstore@gmail.com',
  phone: '9656807412',
  phoneDisplay: '+91 96568 07412',

  // ── Social media ───────────────────────────────────────────
  social: {
    instagram: 'https://www.instagram.com/imthy_ad21?igsh=MTkwZHNvMzg0cmNheQ==',
    facebook: '',   // Add when available: 'https://facebook.com/...'
    twitter: '',    // Add when available: 'https://x.com/...'
    youtube: 'https://youtube.com/@ad21footballstore?si=4QH1FnJa9E0Thn_X',
    whatsapp: '919656807412', // Country code + number, no +
  },

  // ── Brand colors (CSS values) ──────────────────────────────
  // Primary accent: AD21 brand red
  colors: {
    accent: '#e53e3e',       // primary brand red
    accentHover: '#c53030',  // darker red on hover
    accent400: '#fc8181',    // lighter red tint
    primary: '#1a1a2e',      // dark navy (page bg / footer)
    scrollbarThumb: '#e53e3e',
  },

  // ── Logo / media ───────────────────────────────────────────
  logoUrl: '/images/logo.svg',
  logoAlt: 'AD21 Store Logo',

  // ── E-commerce thresholds ──────────────────────────────────
  // NOTE: freeShippingThreshold and shippingCost used to live here, but they
  // are now fully admin-configurable at runtime (Admin → Feature Flags →
  // Commerce Settings), persisted via the Setting model. See
  // Setting.getCommerceSettings()/updateCommerceSettings() in
  // src/modules/settings/settings.model.js — that file's own DEFAULT_COMMERCE
  // holds the one-time seed values now, so this file no longer needs to.
  commerce: {
    referralBonus: 100,           // ₹ wallet credit per successful referral
    walletCashbackPercent: 2,     // % cashback on wallet payments
  },

  // ── Legal / footer ─────────────────────────────────────────
  legal: {
    privacyPolicy: '#',
    termsOfService: '#',
    cookiePolicy: '#',
    returnPolicy: '#',
  },

  // ── Misc display text used across views ───────────────────
  firstOrderCoupon: 'FIRST10',
  firstOrderDiscount: '10%',
};

module.exports = brand;