const express = require('express');
const router = express.Router();
const parseWarehouseData = require('../utils/parser');
const Warehouse = require('../models/warehouseModel');

router.post('/', async (req, res) => {
  const { message } = req.body;

  try {
    const parsedData = parseWarehouseData(message);

    // Placeholder for saving to Supabase or DB
    const warehouse = new Warehouse(parsedData); // Pretending it's like an ORM
    console.log('Warehouse parsed:', warehouse);

    return res.json({ status: 'success', warehouse });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
