// scripts/checkFireNocMapping.js
// This script parses a sample message and prints the objects that would be
// sent to Prisma's create calls in saveWarehouse, without performing any DB ops.

const parseWarehouseData = require('../src/utils/warehouseParser');

const sample = `Warehouse Owner Type: company
Media Available: y
Warehouse Type: PEB
Address: KIADB Aerospace Industrial Park, Devanahalli
city: Bangalore
State: Karnataka
Postal code: 562149
Google location: https://maps.app.goo.gl/efLmwJJPWSauK74K6
Contact Person: Santosh
Contact number: 9845226666
Total Space: 50180 sqft
Number of Docks: 2-4
Clear height: 50ft
fireNocAvailable: Y
Fire Safety Measures: Hydrants, Fire Detectors and Alarms
Compliances: Industrial Land Sanction
Other Specifications: 1000kva power supply, Rainwater harvesting setup, STP available
Rate Per Sqft: 40
Availability: Immediate
Is Broker (y/n)?: n
Uploaded by: Dhaval`;

function deriveZone(state) {
  if (!state) return 'MISC';
  const s = state.toLowerCase().trim();
  if (['karnataka','telangana','andhra pradesh','kerala','tamil nadu','puducherry','lakshadweep','andaman and nicobar islands'].includes(s)) return 'SOUTH';
  return 'MISC';
}

try {
  const parsed = parseWarehouseData(sample);

  // Simulate the branch in src/routes/whatsapp.js where mediaAvailable is not 'y'
  const { mediaAvailable, ...warehouseData } = parsed;

  const finalData = {
    ...warehouseData,
    zone: deriveZone(parsed.state),
    photos: null,
  };

  // This is what prisma.warehouse.create would receive
  const warehouseCreatePayload = { data: finalData };

  // This simulates saveWarehouse's destructure and what prisma.warehouseData.create would receive
  const { fireNocAvailable, fireSafetyMeasures, landType } = finalData;
  const warehouseDataCreatePayload = {
    data: {
      warehouseId: '<created_warehouse_id>',
      fireNocAvailable: typeof fireNocAvailable === 'boolean' ? fireNocAvailable : null,
      fireSafetyMeasures: fireSafetyMeasures || null,
      landType: landType || null,
    }
  };

  console.log('Parsed output:');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('\nPayload that would be sent to prisma.warehouse.create (warehouse):');
  console.log(JSON.stringify(warehouseCreatePayload, null, 2));
  console.log('\nPayload that would be sent to prisma.warehouseData.create (warehouseData):');
  console.log(JSON.stringify(warehouseDataCreatePayload, null, 2));

  process.exit(0);
} catch (err) {
  console.error('Error:', err && err.message ? err.message : err);
  process.exit(1);
}
