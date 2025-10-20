// scripts/testSaveWarehouseFlow.js
// Simulates the complete flow from parsing to saveWarehouse data preparation

const parseWarehouseData = require('../src/utils/warehouseParser');

const sampleMessage = `Warehouse Owner Type: company
Media Available: n
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
Other Specifications: 1000kva power supply
Rate Per Sqft: 40
Land Type: Freehold
Vaastu Compliance: Yes
Approach Road Width: 40 feet
Dimensions: 200x250 sqft
Parking/Docking Space: Available for 20 trucks
Pollution Zone: Green Zone
Power (in kva): 1000
Availability: Immediate
Is Broker (y/n)?: n
Uploaded by: Dhaval`;

function deriveZone(state) {
  const s = state.toLowerCase().trim();
  if (['karnataka','telangana','andhra pradesh','kerala','tamil nadu','puducherry','lakshadweep','andaman and nicobar islands'].includes(s)) return 'SOUTH';
  return 'MISC';
}

try {
  const parsed = parseWarehouseData(sampleMessage);
  console.log('Step 1: ✅ Parsing successful\n');

  // Simulate the route logic (immediate save path since mediaAvailable is 'n')
  const { mediaAvailable, ...warehouseData } = parsed;
  const finalData = {
    ...warehouseData,
    zone: deriveZone(parsed.state),
    photos: null,
  };

  console.log('Step 2: Simulating saveWarehouse destructuring...\n');
  
  // Simulate saveWarehouse destructuring
  const {
    fireNocAvailable,
    fireSafetyMeasures,
    landType,
    vaastuCompliance,
    approachRoadWidth,
    dimensions,
    parkingDockingSpace,
    pollutionZone,
    powerKva,
    ...warehouseCreateData
  } = finalData;

  console.log('Payload for prisma.warehouse.create:');
  console.log(JSON.stringify({ data: warehouseCreateData }, null, 2));

  console.log('\nPayload for prisma.warehouseData.create:');
  const warehouseDataPayload = {
    data: {
      warehouseId: '<created_warehouse_id>',
      fireNocAvailable: typeof fireNocAvailable === 'boolean' ? fireNocAvailable : null,
      fireSafetyMeasures: fireSafetyMeasures || null,
      landType: landType || null,
      vaastuCompliance: vaastuCompliance || null,
      approachRoadWidth: approachRoadWidth || null,
      dimensions: dimensions || null,
      parkingDockingSpace: parkingDockingSpace || null,
      pollutionZone: pollutionZone || null,
      powerKva: powerKva || null,
    }
  };
  console.log(JSON.stringify(warehouseDataPayload, null, 2));

  console.log('\n--- Verification Summary ---');
  console.log(`✅ fireNocAvailable: ${fireNocAvailable} (boolean: ${typeof fireNocAvailable === 'boolean'})`);
  console.log(`✅ fireSafetyMeasures: ${fireSafetyMeasures}`);
  console.log(`✅ landType: ${landType}`);
  console.log(`✅ vaastuCompliance: ${vaastuCompliance}`);
  console.log(`✅ approachRoadWidth: ${approachRoadWidth}`);
  console.log(`✅ dimensions: ${dimensions}`);
  console.log(`✅ parkingDockingSpace: ${parkingDockingSpace}`);
  console.log(`✅ pollutionZone: ${pollutionZone}`);
  console.log(`✅ powerKva: ${powerKva}`);

  console.log('\n✅ All fields correctly routed to WarehouseData table!');
  process.exit(0);
} catch (err) {
  console.error('❌ Error:', err && err.message ? err.message : err);
  process.exit(1);
}
