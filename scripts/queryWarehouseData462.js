// scripts/queryWarehouseData462.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async function main() {
  try {
    const rec = await prisma.warehouseData.findFirst({ where: { warehouseId: 462 } });
    console.log('warehouseData record for warehouseId=462:');
    console.log(JSON.stringify(rec, null, 2));
  } catch (err) {
    console.error('Error querying DB:', err && err.message ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
})();
