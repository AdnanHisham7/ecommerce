const express = require('express');
const router = express.Router();
const ctrl = require('./admin.controller');
const { adminAuthenticate, requirePermission } = require('../../middlewares/auth.middleware');
const noCache = require('../../middlewares/noCache.middleware');
const { adminLimiter } = require('../../middlewares/rateLimit.middleware');
const { productUpload, avatarUpload } = require('../../config/cloudinary');

// ---- Admin Auth (no middleware) ----
router.get('/login', ctrl.getAdminLogin);
router.post('/login', adminLimiter, ctrl.adminLogin);
router.get('/logout', ctrl.adminLogout);

// All routes below require admin session
router.use(adminAuthenticate);

// ---- Dashboard (all staff can see) ----
router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/dashboard', noCache, ctrl.getDashboard);

// ---- Products ----
router.get('/products', noCache, requirePermission('manage_products'), ctrl.getProducts);
router.get('/products/add', noCache, requirePermission('manage_products'), ctrl.getAddProduct);
router.post('/products/add', productUpload.array('images', 8), noCache, requirePermission('manage_products'), ctrl.addProduct);
router.get('/products/:id/edit', noCache, requirePermission('manage_products'), ctrl.getEditProduct);
router.post('/products/:id/edit', productUpload.array('images', 8), noCache, requirePermission('manage_products'), ctrl.updateProduct);
router.post('/products/:id/delete', noCache, requirePermission('manage_products'), ctrl.deleteProduct);
router.post('/products/delete-image', noCache, requirePermission('manage_products'), ctrl.deleteProductImage);
router.post('/products/:id/reorder-images', noCache, requirePermission('manage_products'), ctrl.reorderProductImages);

// ---- Variant Type ----
router.put('/products/:id/variant-type', noCache, requirePermission('manage_products'), ctrl.updateVariantType);

// ---- Color Variants ----
router.post('/products/:id/colors', productUpload.array('images', 6), noCache, requirePermission('manage_products'), ctrl.addColorVariant);
router.put('/products/:id/colors/:colorId', productUpload.array('images', 6), noCache, requirePermission('manage_products'), ctrl.updateColorVariant);
router.delete('/products/:id/colors/:colorId', noCache, requirePermission('manage_products'), ctrl.deleteColorVariant);
router.post('/products/:id/colors/delete-image', noCache, requirePermission('manage_products'), ctrl.deleteColorVariantImage);
router.post('/products/:id/colors/reorder-images', noCache, requirePermission('manage_products'), ctrl.reorderColorImages);

// ---- Size Variants ----
router.post('/products/:id/sizes', noCache, requirePermission('manage_products'), ctrl.addSizeVariant);
router.put('/products/:id/sizes/:sizeId', noCache, requirePermission('manage_products'), ctrl.updateSizeVariant);
router.delete('/products/:id/sizes/:sizeId', noCache, requirePermission('manage_products'), ctrl.deleteSizeVariant);

// ---- SKU Variants ----
router.post('/products/:id/variants', noCache, requirePermission('manage_products'), ctrl.upsertVariant);
router.put('/products/:id/variants/:variantId', noCache, requirePermission('manage_products'), ctrl.updateVariant);
router.delete('/products/:id/variants/:variantId', noCache, requirePermission('manage_products'), ctrl.deleteVariant);

// ---- Categories ----
router.get('/categories', noCache, requirePermission('manage_categories'), ctrl.getCategories);
router.post('/categories/add', avatarUpload.single('image'), noCache, requirePermission('manage_categories'), ctrl.addCategory);
router.post('/categories/:id/edit', avatarUpload.single('image'), noCache, requirePermission('manage_categories'), ctrl.updateCategory);
router.post('/categories/:id/delete', noCache, requirePermission('manage_categories'), ctrl.deleteCategory);

// ---- Users ----
router.get('/users', noCache, requirePermission('manage_users'), ctrl.getUsers);
router.get('/users/:id', noCache, requirePermission('manage_users'), ctrl.getUserDetail);
router.post('/users/:id/toggle-block', noCache, requirePermission('manage_users'), ctrl.toggleUserBlock);

// ---- Orders ----
router.get('/orders', noCache, requirePermission('manage_orders'), ctrl.getOrders);
router.get('/orders/:id', noCache, requirePermission('manage_orders'), ctrl.getOrderDetail);
router.post('/orders/:id/status', noCache, requirePermission('manage_orders'), ctrl.updateOrderStatus);
router.post('/orders/:id/mark-paid', noCache, requirePermission('manage_orders'), ctrl.markCodOrderPaid);
router.post('/orders/print-package-slips', noCache, requirePermission('manage_orders'), ctrl.getPrintPackageSlips);

// ---- Coupons ----
router.get('/coupons', noCache, requirePermission('manage_coupons'), ctrl.getCoupons);
router.post('/coupons/add', noCache, requirePermission('manage_coupons'), ctrl.addCoupon);
router.post('/coupons/:id/toggle', noCache, requirePermission('manage_coupons'), ctrl.toggleCoupon);
router.post('/coupons/:id/delete', noCache, requirePermission('manage_coupons'), ctrl.deleteCoupon);

module.exports = router;
