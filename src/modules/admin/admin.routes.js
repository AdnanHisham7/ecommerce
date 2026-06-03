const express = require('express');
const router = express.Router();
const ctrl = require('./admin.controller');
const { adminAuthenticate, requirePermission } = require('../../middlewares/auth.middleware');
const noCache = require('../../middlewares/noCache.middleware');
const { adminLimiter } = require('../../middlewares/rateLimit.middleware');
const { avatarUpload } = require('../../config/cloudinary');

// ---- Admin Auth (no middleware) ----
router.get('/login', ctrl.getAdminLogin);
router.post('/login', adminLimiter, ctrl.adminLogin);
router.get('/logout', ctrl.adminLogout);

// All routes below require admin session
router.use(adminAuthenticate);

// ---- Dashboard (all staff can see) ----
router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/dashboard', noCache, ctrl.getDashboard);

// ---- Categories ----
router.get('/categories', noCache, requirePermission('manage_categories'), ctrl.getCategories);
router.post('/categories/add', avatarUpload.single('image'), noCache, requirePermission('manage_categories'), ctrl.addCategory);
router.post('/categories/:id/edit', avatarUpload.single('image'), noCache, requirePermission('manage_categories'), ctrl.updateCategory);
router.post('/categories/:id/delete', noCache, requirePermission('manage_categories'), ctrl.deleteCategory);

module.exports = router;
