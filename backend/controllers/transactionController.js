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
      .populate('supplierId', 'name')
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
      .populate('userId', 'username email')
      .populate('supplierId', 'name');

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
    const { productId, supplierId, type, quantity, notes } = req.body;

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
      supplierId,
      type,
      quantity,
      notes,
      userId: req.user._id
    });

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('productId', 'name sku')
      .populate('userId', 'username email')
      .populate('supplierId', 'name');

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

// Create a sale consisting of multiple items. Deducts stock and creates
// transaction records of type 'out' for each sold item.
exports.createSale = async (req, res) => {
  try {
    const { items = [], paymentMethod, total, tax, grandTotal } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided for sale' });
    }

    // First: validate all products and stock availability
    const productsToUpdate = [];
    for (const it of items) {
      const product = await Product.findById(it.productId);
      if (!product) {
        return res.status(404).json({ success: false, message: `Product not found: ${it.productId}` });
      }
      if ((product.quantity || 0) < (it.quantity || 0)) {
        return res.status(400).json({ success: false, message: `Insufficient stock for product ${product.name}` });
      }
      productsToUpdate.push({ product, qty: it.quantity });
    }

    // Second: deduct stock for all products
    for (const p of productsToUpdate) {
      p.product.quantity -= p.qty;
      await p.product.save();
    }

    // Third: create Transaction records for each sold item
    const created = [];
    for (const it of items) {
      const tr = await Transaction.create({
        productId: it.productId,
        type: 'out',
        quantity: it.quantity,
        notes: `Sale - ${paymentMethod || 'unknown'}`,
        userId: req.user._id
      });
      created.push(tr);
    }

    // Populate created transactions for response
    const populated = await Transaction.find({ _id: { $in: created.map(c => c._id) } })
      .populate('productId', 'name sku')
      .populate('userId', 'username email')
      .sort({ date: -1 });

    res.status(201).json({
      success: true,
      message: 'Sale processed successfully',
      data: {
        transactions: populated,
        summary: { paymentMethod, total, tax, grandTotal }
      }
    });
  } catch (error) {
    console.error('createSale error', error);
    res.status(500).json({ success: false, message: 'Error processing sale', error: error.message });
  }
};