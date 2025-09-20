const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const parseWarehouseData = require('../utils/warehouseParser');

const prisma = new PrismaClient();

// --- Business Logic Functions ---

/**
 * Generates the next warehouse ID (e.g., 'WH001', 'WH002').
 * NOTE: In a high-concurrency system, this could create race conditions.
 * A more robust solution might use a database sequence or transaction.
 */
async function getNextWarehouseId() {
  const lastWarehouse = await prisma.warehouse.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!lastWarehouse || !lastWarehouse.id.startsWith('WH')) {
    return 'WH001';
  }

  try {
    const lastIdNumber = parseInt(lastWarehouse.id.substring(2));
    const nextIdNumber = lastIdNumber + 1;
    // Pads the number with leading zeros to a length of 3 (e.g., 1 -> 001, 12 -> 012)
    const nextId = `WH${String(nextIdNumber).padStart(3, '0')}`;
    return nextId;
  } catch (error) {
    // Fallback if parsing fails for any reason
    return `WH${Date.now()}`;
  }
}

/**
 * Derives the zone based on the state.
 * You should expand this with your specific business rules.
 */
function deriveZone(state) {
  const s = state.toLowerCase();
  switch (s) {
    case 'delhi':
    case 'punjab':
    case 'haryana':
    case 'uttar pradesh':
      return 'NORTH';
    case 'maharashtra':
    case 'gujarat':
    case 'goa':
      return 'WEST';
    case 'tamil nadu':
    case 'karnataka':
    case 'kerala':
    case 'andhra pradesh':
      return 'SOUTH';
    case 'west bengal':
    case 'odisha':
    case 'bihar':
      return 'EAST';
    case 'madhya pradesh':
    case 'chhattisgarh':
      return 'CENTRAL';
    default:
      return 'MISCELLANEOUS'; // Default zone for unrecognized states
  }
}


// --- API Route ---

router.post('/', async (req, res) => {
  const message = req.body.Body || req.body.message;

  if (!message) {
    return res.status(400).json({ status: 'error', message: 'No message body found.' });
  }

  try {
    // 1. Parse the incoming message into a raw data object
    let parsedData = parseWarehouseData(message);

    // 2. Generate the database-specific fields
    const newId = await getNextWarehouseId();
    const zone = deriveZone(parsedData.state);

    // 3. Combine parsed data with generated data
    const finalData = {
      ...parsedData,
      id: newId,
      zone: zone,
    };

    // 4. Create the record in the database
    const newWarehouse = await prisma.warehouse.create({
      data: finalData,
    });

    console.log(`✅ Warehouse created successfully with ID: ${newWarehouse.id}`);
    return res.status(201).json({ status: 'success', data: newWarehouse });

  } catch (err) {
    console.error('Error processing message:', err.message);
    return res.status(400).json({
      status: 'error',
      message: 'Failed to process warehouse data.',
      details: err.message
    });
  }
});

module.exports = router;