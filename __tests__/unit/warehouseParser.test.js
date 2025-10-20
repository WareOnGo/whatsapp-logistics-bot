// __tests__/unit/warehouseParser.test.js
// Unit tests for the warehouse parser

const parseWarehouseData = require('../../src/utils/warehouseParser');

describe('Warehouse Parser', () => {
  describe('Basic Field Parsing', () => {
    test('should parse all required fields correctly', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: KIADB Aerospace Industrial Park
City: Bangalore
State: Karnataka
Postal Code: 562149
Contact Person: Santosh
Contact Number: 9845226666
Total Space: 50180 sqft
Fire NOC Available: Y
Fire Safety Measures: Hydrants
Compliances: Industrial Land Sanction
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Santosh`;

      const result = parseWarehouseData(message);

      expect(result.warehouseOwnerType).toBe('company');
      expect(result.warehouseType).toBe('PEB');
      expect(result.address).toBe('KIADB Aerospace Industrial Park');
      expect(result.city).toBe('Bangalore');
      expect(result.state).toBe('Karnataka');
      expect(result.postalCode).toBe('562149');
      expect(result.contactPerson).toBe('Santosh');
      expect(result.contactNumber).toBe('9845226666');
      expect(result.totalSpaceSqft).toEqual([50180]);
      expect(result.fireNocAvailable).toBe(true);
      expect(result.fireSafetyMeasures).toBe('Hydrants');
      expect(result.compliances).toBe('Industrial Land Sanction');
      expect(result.ratePerSqft).toBe('40');
      expect(result.isBroker).toBe('n');
      expect(result.uploadedBy).toBe('Santosh');
    });

    test('should parse new optional fields correctly', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test Address
City: Bangalore
State: Karnataka
Postal Code: 562149
Contact Person: Test
Contact Number: 9845226666
Total Space: 50000 sqft
Fire NOC Available: Y
Fire Safety Measures: Hydrants
Compliances: Test
Rate Per Sqft: 40
Vaastu Compliance: Yes, South facing
Approach Road Width: 40 feet
Dimensions: 200x250 ft
Parking/Docking Space: 10 trucks
Pollution Zone: Green Zone
Power (in kva): 1000
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);

      expect(result.vaastuCompliance).toBe('Yes, South facing');
      expect(result.approachRoadWidth).toBe('40 feet');
      expect(result.dimensions).toBe('200x250 ft');
      expect(result.parkingDockingSpace).toBe('10 trucks');
      expect(result.pollutionZone).toBe('Green Zone');
      expect(result.powerKva).toBe('1000');
    });
  });

  describe('Fire NOC Boolean Conversion', () => {
    test('should convert "y" to true', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test
City: Test
State: Karnataka
Postal Code: 123456
Contact Person: Test
Contact Number: 9876543210
Total Space: 10000 sqft
Fire NOC Available: y
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);
      expect(result.fireNocAvailable).toBe(true);
    });

    test('should convert "yes" to true', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test
City: Test
State: Karnataka
Postal Code: 123456
Contact Person: Test
Contact Number: 9876543210
Total Space: 10000 sqft
Fire NOC Available: yes
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);
      expect(result.fireNocAvailable).toBe(true);
    });

    test('should convert "n" to false', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test
City: Test
State: Karnataka
Postal Code: 123456
Contact Person: Test
Contact Number: 9876543210
Total Space: 10000 sqft
Fire NOC Available: n
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);
      expect(result.fireNocAvailable).toBe(false);
    });
  });

  describe('Total Space Parsing', () => {
    test('should parse single space value into array', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test
City: Test
State: Karnataka
Postal Code: 123456
Contact Person: Test
Contact Number: 9876543210
Total Space: 50000 sqft
Fire NOC Available: y
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);
      expect(result.totalSpaceSqft).toEqual([50000]);
    });

    test('should parse comma-separated space values', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test
City: Test
State: Karnataka
Postal Code: 123456
Contact Person: Test
Contact Number: 9876543210
Total Space: 25000, 30000, 45000 sqft
Fire NOC Available: y
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);
      expect(result.totalSpaceSqft).toEqual([25000, 30000, 45000]);
    });
  });

  describe('Fuzzy Matching', () => {
    test('should match misspelled field names', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Addres: Test Address
Citty: Bangalore
Staate: Karnataka
Postal code: 562149
Contact Persn: Test
Contact Numbr: 9845226666
Total Spac: 50000 sqft
Fire NOC Availble: Y
Fire Safety Measres: Hydrants
Compliancs: Test
Rate Per Sqf: 40
Is Broker?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);

      // Fuzzy matching should still parse these
      expect(result.address).toBeDefined();
      expect(result.city).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.contactPerson).toBeDefined();
      expect(result.totalSpaceSqft).toBeDefined();
    });
  });

  describe('Missing Required Fields', () => {
    test('should throw error when required fields are missing', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
City: Bangalore`;

      expect(() => parseWarehouseData(message)).toThrow();
    });
  });

  describe('Optional Fields', () => {
    test('should not fail when optional fields are missing', () => {
      const message = `Warehouse Owner Type: company
Media Available: n
Warehouse Type: PEB
Address: Test Address
City: Bangalore
State: Karnataka
Postal Code: 562149
Contact Person: Test
Contact Number: 9845226666
Total Space: 50000 sqft
Fire NOC Available: Y
Fire Safety Measures: Hydrants
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`;

      const result = parseWarehouseData(message);

      // Optional new fields should be undefined
      expect(result.vaastuCompliance).toBeUndefined();
      expect(result.approachRoadWidth).toBeUndefined();
      expect(result.dimensions).toBeUndefined();
      expect(result.parkingDockingSpace).toBeUndefined();
      expect(result.pollutionZone).toBeUndefined();
      expect(result.powerKva).toBeUndefined();
    });
  });
});
