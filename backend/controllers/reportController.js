const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');

// GET /api/reports/daily-sales?date=YYYY-MM-DD
exports.dailySales = async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required (YYYY-MM-DD)' });
    }

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const itemsFacet = [
      { $match: { type: 'out', date: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$productId',
          name: { $first: '$product.name' },
          price: { $first: '$product.price' },
          qty: { $sum: '$quantity' },
          subtotal: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.price', 0] }] } }
        }
      },
      { $project: { productId: '$_id', name: 1, price: 1, qty: 1, subtotal: 1, _id: 0 } }
    ];

    const totalsFacet = [
      { $match: { type: 'out', date: { $gte: start, $lt: end } } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.price', 0] }] } },
          transactions: { $sum: 1 },
          itemsSold: { $sum: '$quantity' }
        }
      }
    ];

    const itemsList = await Transaction.aggregate(itemsFacet);
    const totalsAgg = await Transaction.aggregate(totalsFacet);
    const totals = totalsAgg[0] || { totalSales: 0, transactions: 0, itemsSold: 0 };

    res.status(200).json({
      success: true,
      date: start.toISOString().slice(0, 10),
      totals,
      items: itemsList
    });
  } catch (error) {
    console.error('dailySales error', error);
    res.status(500).json({ success: false, message: 'Error generating daily sales report', error: error.message });
  }
};

// GET /api/reports/monthly-sales?month=1&year=2025
exports.monthlySales = async (req, res) => {
  try {
    let { month, year } = req.query;
    month = parseInt(month, 10);
    year = parseInt(year, 10);

    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'month (1-12) and year are required' });
    }

    const start = new Date(year, month - 1, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(year, month, 1);
    end.setHours(0, 0, 0, 0);

    const matchStage = { $match: { type: 'out', date: { $gte: start, $lt: end } } };

    const dailyGroup = [
      matchStage,
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          sales: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.price', 0] }] } },
          transactions: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          day: '$_id',
          sales: 1,
          transactions: 1
        }
      },
      { $sort: { day: 1 } }
    ];

    const daily = await Transaction.aggregate(dailyGroup);

    // Totals for the month
    const totalsAgg = await Transaction.aggregate([
      matchStage,
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.price', 0] }] } },
          transactions: { $sum: 1 }
        }
      }
    ]);

    const totals = totalsAgg[0] || { totalSales: 0, transactions: 0 };

    res.status(200).json({ success: true, month, year, totals, daily });
  } catch (error) {
    console.error('monthlySales error', error);
    res.status(500).json({ success: false, message: 'Error generating monthly sales report', error: error.message });
  }
};

// GET /api/reports/inventory-status
exports.inventoryStatus = async (req, res) => {
  try {
    // Optional search query
    const { search } = req.query;

    // Aggregate transactions grouped by product and type
    const agg = [
      {
        $group: {
          _id: { productId: '$productId', type: '$type' },
          qty: { $sum: '$quantity' }
        }
      },
      {
        $group: {
          _id: '$_id.productId',
          totals: {
            $push: { type: '$_id.type', qty: '$qty' }
          }
        }
      }
    ];

    const transByProduct = await Transaction.aggregate(agg);

    // Build a map productId -> { in: x, out: y }
    const map = {};
    transByProduct.forEach((p) => {
      const id = p._id?.toString();
      map[id] = { in: 0, out: 0 };
      p.totals.forEach(t => {
        if (t.type === 'in') map[id].in = t.qty;
        if (t.type === 'out') map[id].out = t.qty;
      });
    });

    // Fetch products, optionally search by name or sku
    const Product = require('../models/Product');
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } }
      ];
    }

    const products = await Product.find(query).select('name sku category quantity initialStock').lean();

    const rows = products.map(p => {
      const id = p._id.toString();
      const inQty = map[id]?.in || 0;
      const outQty = map[id]?.out || 0;

      // Compute initial approx and current
      const initialApprox = p.initialStock != null ? p.initialStock : (p.quantity - (inQty - outQty));
      const computedCurrent = (initialApprox || 0) + inQty - outQty;
      const current = p.initialStock != null ? computedCurrent : p.quantity;

      // Determine status based on 50% threshold:
      // - OUT: current <= 0
      // - LOW: current <= 50% of initial (stock is at or below half)
      // - OK: current > 50% of initial
      const threshold = (initialApprox || 0) * 0.5;
      let status = 'OK';
      if (current <= 0) {
        status = 'OUT';
      } else if (current <= threshold) {
        status = 'LOW';
      }

      return {
        _id: p._id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        stock: current,
        initialStock: initialApprox,
        status,
      };
    });

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('inventoryStatus error', error);
    res.status(500).json({ success: false, message: 'Error generating inventory status', error: error.message });
  }
};

// GET /api/reports/stock-report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
exports.stockReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const match = {};
    if (startDate || endDate) {
      match.date = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0,0,0,0);
        match.date.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23,59,59,999);
        match.date.$lte = e;
      }
    }

    // Aggregate transactions by product
    const transMatch = Object.keys(match).length ? { $match: match } : null;
    const pipeline = [];
    if (transMatch) pipeline.push(transMatch);
    pipeline.push(
      {
        $group: {
          _id: { productId: '$productId', type: '$type' },
          qty: { $sum: '$quantity' }
        }
      },
      {
        $group: {
          _id: '$_id.productId',
          totals: { $push: { type: '$_id.type', qty: '$qty' } }
        }
      }
    );

    const transByProduct = await Transaction.aggregate(pipeline);

    const map = {};
    transByProduct.forEach((p) => {
      const id = p._id?.toString();
      map[id] = { in: 0, out: 0 };
      p.totals.forEach(t => {
        if (t.type === 'in') map[id].in = t.qty;
        if (t.type === 'out') map[id].out = t.qty;
      });
    });

    const Product = require('../models/Product');
    const products = await Product.find().select('name sku category quantity initialStock').lean();

    const rows = products.map(p => {
      const id = p._id.toString();
      const inQty = map[id]?.in || 0;
      const outQty = map[id]?.out || 0;

      const initialApprox = p.initialStock != null ? p.initialStock : (p.quantity - (inQty - outQty));
      const current = (initialApprox || 0) + inQty - outQty;

      return {
        _id: p._id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        initial: initialApprox || 0,
        stockedIn: inQty,
        sold: outQty,
        current
      };
    });

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('stockReport error', error);
    res.status(500).json({ success: false, message: 'Error generating stock report', error: error.message });
  }
};
