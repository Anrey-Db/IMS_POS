const Transaction = require('../models/Transaction');
const Product = require('../models/Product');

exports.getTransactions = async (req, res) => {
  try {
    const { productId, type, page = 1, limit = 10 } = req.query;

    const query = {};
    if (productId) query.productId = productId;
    if (type) query.type = type;

    const skip = (page - 1) * limit;

    const transactions = await Transaction.find(query)
      .populate('productId', 'name sku')
      .populate('userId', 'username email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ date: -1 });

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions',
      error: error.message
    });
  }
};

exports.getTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('productId')
      .populate('userId', 'username email');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.status(200).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction',
      error: error.message
    });
  }
};

exports.createTransaction = async (req, res) => {
  try {
    const { productId, type, quantity, notes } = req.body;

    // Find product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Update product quantity
    if (type === 'in') {
      product.quantity += quantity;
    } else if (type === 'out') {
      if (product.quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock'
        });
      }
      product.quantity -= quantity;
    }

    await product.save();

    // Create transaction
    const transaction = await Transaction.create({
      productId,
      type,
      quantity,
      notes,
      userId: req.user._id
    });

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('productId', 'name sku')
      .populate('userId', 'username email');

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: populatedTransaction
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating transaction',
      error: error.message
    });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Reverse the transaction effect on product quantity
    const product = await Product.findById(transaction.productId);
    if (product) {
      if (transaction.type === 'in') {
        product.quantity -= transaction.quantity;
      } else {
        product.quantity += transaction.quantity;
      }
      await product.save();
    }

    await Transaction.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully',
      data: {}
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting transaction',
      error: error.message
    });
  }
};