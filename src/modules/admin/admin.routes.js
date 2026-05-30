const express = require('express');
const router = express.Router();
const ctrl = require('./admin.controller');
const { adminAuthenticate } = require('../../middlewares/auth.middleware');
const noCache = require('../../middlewares/noCache.middleware');
const { adminLimiter } = require('../../middlewares/rateLimit.middleware');

// ---- Admin Auth (no middleware) ----
router.get('/login', ctrl.getAdminLogin);
router.post('/login', adminLimiter, ctrl.adminLogin);
router.get('/logout', ctrl.adminLogout);

// All routes below require admin session
router.use(adminAuthenticate);

// ---- Dashboard (all staff can see) ----
router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/dashboard', noCache, ctrl.getDashboard);

module.exports = router;
