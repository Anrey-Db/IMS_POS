const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { dailySales, monthlySales, inventoryStatus, stockReport } = require('../controllers/reportController');

router.get('/daily-sales', protect, dailySales);
router.get('/monthly-sales', protect, monthlySales);
router.get('/inventory-status', protect, inventoryStatus);
router.get('/stock-report', protect, stockReport);

module.exports = router;
