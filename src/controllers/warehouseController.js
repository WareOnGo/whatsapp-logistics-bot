const Warehouse = require('../models/Warehouse');
const { parseWarehouseMessage } = require('../utils/warehouseParser');

const receiveWarehouseData = async (req, res) => {
  const rawMessage = req.body.message;

  try {
    const parsed = parseWarehouseMessage(rawMessage);
    const warehouse = new Warehouse(
      parsed.name,
      parsed.location,
      parsed.capacity,
      parsed.contact
    );

    // TODO: Send `warehouse` to Supabase
    console.log('✅ Parsed Warehouse Object:', warehouse);

    res.status(200).json({
      status: 'success',
      parsed
    });
  } catch (err) {
    res.status(400).json({
      status: 'error',
      message: 'Failed to parse warehouse data',
      error: err.message
    });
  }
};

module.exports = { receiveWarehouseData };
