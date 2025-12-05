const express = require('express');
const router = express.Router();
const {
  getTransactions,
  getTransaction,
  createTransaction,
  deleteTransaction
} = require('../controllers/transactionController');
const { protect } = require('../middleware/auth');

router.route('/')
  .get(protect, getTransactions)
  .post(protect, createTransaction);

// Sale route: create a multi-item sale and deduct inventory
router.route('/sale').post(protect, require('../controllers/transactionController').createSale);

router.route('/:id')
  .get(protect, getTransaction)
  .delete(protect, deleteTransaction);

module.exports = router;