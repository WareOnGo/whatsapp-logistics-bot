// services/warehouseService.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getNextWarehouseId() {
  const lastWarehouse = await prisma.warehouse.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!lastWarehouse || !lastWarehouse.id.startsWith('WH')) {
    return 'WH001';
  }
  
  const lastIdNumber = parseInt(lastWarehouse.id.substring(2));
  const nextIdNumber = lastIdNumber + 1;
  return `WH${String(nextIdNumber).padStart(3, '0')}`;
}

function deriveZone(state) {
  const s = state.toLowerCase();
  switch (s) {
    case 'delhi':
    case 'punjab':
    case 'haryana':
      return 'NORTH';
    case 'maharashtra':
    case 'gujarat':
      return 'WEST';
    case 'tamil nadu':
    case 'karnataka':
      return 'SOUTH';
    case 'west bengal':
    case 'odisha':
      return 'EAST';
    case 'madhya pradesh':
      return 'CENTRAL';
    default:
      throw new Error(`Could not determine zone for state: ${state}`);
  }
}

async function saveWarehouse(data) {
  return await prisma.warehouse.create({
    data: data
  });
}

module.exports = {
  getNextWarehouseId,
  deriveZone,
  saveWarehouse
};