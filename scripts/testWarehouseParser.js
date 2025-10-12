// scripts/testWarehouseParser.js

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

try {
  const result = parseWarehouseData(sample);
  console.log('Parsed result:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error('Parser threw an error:');
  console.error(err && err.message ? err.message : err);
  process.exit(2);
}
