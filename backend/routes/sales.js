const express = require('express');
const router = express.Router();

// Sales routes removed — keep placeholder to avoid errors if referenced.
router.use((req, res) => {
  res.status(410).json({ success: false, message: 'Sales routes removed' });
});

module.exports = router;
