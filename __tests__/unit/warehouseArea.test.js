const parseWarehouseData = require('../../src/utils/warehouseParser');
jest.mock('../../src/lib/prisma', () => ({
  warehouse: { create: jest.fn(async ({ data }) => ({ id: 123, ...data })) },
  warehouseData: { create: jest.fn(async () => ({})) },
}));
const prisma = require('../../src/lib/prisma');
const { saveWarehouse } = require('../../src/services/warehouseService');

const required = `Warehouse Type: PEB
Address: Test warehouse
City: Bangalore
State: Karnataka
Postal Code: 560001
Contact Person: Test owner
Contact Number: 9999999999
Fire NOC Available: Y
Fire Safety Measures: Hydrants
Compliances: CLU
Rate Per Sqft: 25
Uploaded By: Test`;

test.each(['Total Space', 'Offered Space', 'Offered Area'])('%s is stored only in totalSpaceSqft', label => {
  const row = parseWarehouseData(`${required}\n${label}: 25000, 50000 sqft`);
  expect(row.totalSpaceSqft).toEqual([25000, 50000]);
  expect(row).not.toHaveProperty('offeredSpaceSqft');
});

test.each([
  'Total Space: 25000 sqft\nOffered Space: 99999 sqft',
  'Offered Space: 99999 sqft\nTotal Space: 25000 sqft',
])('preserves explicit Total Space when an old template contains both labels: %s', area => {
  expect(parseWarehouseData(`${required}\n${area}`).totalSpaceSqft).toEqual([25000]);
});

test('saving an older payload discards the legacy field', async () => {
  await saveWarehouse({ totalSpaceSqft: [25000, 50000], offeredSpaceSqft: '99999' });
  expect(prisma.warehouse.create).toHaveBeenCalledWith({ data: { totalSpaceSqft: [25000, 50000] } });
});
