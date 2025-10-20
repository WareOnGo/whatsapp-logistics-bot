// scripts/testNewFields.js
// Test script to verify the new WarehouseData fields are parsed and handled correctly

const parseWarehouseData = require('../src/utils/warehouseParser');

const sampleWithNewFields = `Warehouse Owner Type: company
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
Other Specifications: 1000kva power supply, Rainwater harvesting setup, STP available
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

try {
  const result = parseWarehouseData(sampleWithNewFields);
  console.log('✅ Parsing successful!\n');
  console.log('Parsed result:');
  console.log(JSON.stringify(result, null, 2));
  
  // Verify new fields are present
  const newFields = ['vaastuCompliance', 'approachRoadWidth', 'dimensions', 'parkingDockingSpace', 'pollutionZone', 'powerKva'];
  console.log('\n--- Verification of new fields ---');
  newFields.forEach(field => {
    if (result[field]) {
      console.log(`✅ ${field}: ${result[field]}`);
    } else {
      console.log(`❌ ${field}: NOT FOUND`);
    }
  });
  
  process.exit(0);
} catch (err) {
  console.error('❌ Parser threw an error:');
  console.error(err && err.message ? err.message : err);
  process.exit(2);
}
