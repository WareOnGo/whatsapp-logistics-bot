// __tests__/unit/warehouseService.test.js
// Unit tests for warehouse service functions

const { deriveZone } = require('../../src/services/warehouseService');

describe('Warehouse Service', () => {
  describe('deriveZone', () => {
    describe('NORTH Zone', () => {
      test('should return NORTH for Delhi', () => {
        expect(deriveZone('Delhi')).toBe('NORTH');
        expect(deriveZone('delhi')).toBe('NORTH');
        expect(deriveZone('DELHI')).toBe('NORTH');
      });

      test('should return NORTH for Punjab', () => {
        expect(deriveZone('Punjab')).toBe('NORTH');
      });

      test('should return NORTH for Haryana', () => {
        expect(deriveZone('Haryana')).toBe('NORTH');
      });

      test('should return NORTH for Uttar Pradesh', () => {
        expect(deriveZone('Uttar Pradesh')).toBe('NORTH');
      });

      test('should return NORTH for Rajasthan', () => {
        expect(deriveZone('Rajasthan')).toBe('NORTH');
      });

      test('should return NORTH for Himachal Pradesh', () => {
        expect(deriveZone('Himachal Pradesh')).toBe('NORTH');
      });

      test('should return NORTH for Uttarakhand', () => {
        expect(deriveZone('Uttarakhand')).toBe('NORTH');
      });

      test('should return NORTH for Jammu and Kashmir', () => {
        expect(deriveZone('Jammu and Kashmir')).toBe('NORTH');
      });

      test('should return NORTH for Ladakh', () => {
        expect(deriveZone('Ladakh')).toBe('NORTH');
      });

      test('should return NORTH for Chandigarh', () => {
        expect(deriveZone('Chandigarh')).toBe('NORTH');
      });
    });

    describe('SOUTH Zone', () => {
      test('should return SOUTH for Karnataka', () => {
        expect(deriveZone('Karnataka')).toBe('SOUTH');
        expect(deriveZone('karnataka')).toBe('SOUTH');
        expect(deriveZone('KARNATAKA')).toBe('SOUTH');
      });

      test('should return SOUTH for Tamil Nadu', () => {
        expect(deriveZone('Tamil Nadu')).toBe('SOUTH');
      });

      test('should return SOUTH for Kerala', () => {
        expect(deriveZone('Kerala')).toBe('SOUTH');
      });

      test('should return SOUTH for Telangana', () => {
        expect(deriveZone('Telangana')).toBe('SOUTH');
      });

      test('should return SOUTH for Andhra Pradesh', () => {
        expect(deriveZone('Andhra Pradesh')).toBe('SOUTH');
      });

      test('should return SOUTH for Puducherry', () => {
        expect(deriveZone('Puducherry')).toBe('SOUTH');
      });

      test('should return SOUTH for Lakshadweep', () => {
        expect(deriveZone('Lakshadweep')).toBe('SOUTH');
      });

      test('should return SOUTH for Andaman and Nicobar Islands', () => {
        expect(deriveZone('Andaman and Nicobar Islands')).toBe('SOUTH');
      });
    });

    describe('WEST Zone', () => {
      test('should return WEST for Gujarat', () => {
        expect(deriveZone('Gujarat')).toBe('WEST');
      });

      test('should return WEST for Maharashtra', () => {
        expect(deriveZone('Maharashtra')).toBe('WEST');
      });

      test('should return WEST for Goa', () => {
        expect(deriveZone('Goa')).toBe('WEST');
      });

      test('should return WEST for Dadra and Nagar Haveli and Daman and Diu', () => {
        expect(deriveZone('Dadra and Nagar Haveli and Daman and Diu')).toBe('WEST');
      });
    });

    describe('EAST Zone', () => {
      test('should return EAST for West Bengal', () => {
        expect(deriveZone('West Bengal')).toBe('EAST');
      });

      test('should return EAST for Bihar', () => {
        expect(deriveZone('Bihar')).toBe('EAST');
      });

      test('should return EAST for Jharkhand', () => {
        expect(deriveZone('Jharkhand')).toBe('EAST');
      });

      test('should return EAST for Assam', () => {
        expect(deriveZone('Assam')).toBe('EAST');
      });

      test('should return EAST for Sikkim', () => {
        expect(deriveZone('Sikkim')).toBe('EAST');
      });

      test('should return EAST for Arunachal Pradesh', () => {
        expect(deriveZone('Arunachal Pradesh')).toBe('EAST');
      });

      test('should return EAST for Nagaland', () => {
        expect(deriveZone('Nagaland')).toBe('EAST');
      });

      test('should return EAST for Manipur', () => {
        expect(deriveZone('Manipur')).toBe('EAST');
      });

      test('should return EAST for Mizoram', () => {
        expect(deriveZone('Mizoram')).toBe('EAST');
      });

      test('should return EAST for Tripura', () => {
        expect(deriveZone('Tripura')).toBe('EAST');
      });

      test('should return EAST for Meghalaya', () => {
        expect(deriveZone('Meghalaya')).toBe('EAST');
      });
    });

    describe('CENTRAL Zone', () => {
      test('should return CENTRAL for Madhya Pradesh', () => {
        expect(deriveZone('Madhya Pradesh')).toBe('CENTRAL');
      });

      test('should return CENTRAL for Chhattisgarh', () => {
        expect(deriveZone('Chhattisgarh')).toBe('CENTRAL');
      });

      test('should return CENTRAL for Odisha', () => {
        expect(deriveZone('Odisha')).toBe('CENTRAL');
      });
    });

    describe('MISC Zone', () => {
      test('should return MISC for unknown state', () => {
        expect(deriveZone('Unknown State')).toBe('MISC');
      });

      test('should return MISC for empty string', () => {
        expect(deriveZone('')).toBe('MISC');
      });

      test('should return MISC for invalid input', () => {
        expect(deriveZone('123')).toBe('MISC');
      });
    });

    describe('Case Insensitivity', () => {
      test('should handle mixed case correctly', () => {
        expect(deriveZone('KaRnAtAkA')).toBe('SOUTH');
        expect(deriveZone('mAhArAsHtRa')).toBe('WEST');
        expect(deriveZone('DeLhI')).toBe('NORTH');
      });

      test('should handle extra whitespace', () => {
        expect(deriveZone('  Karnataka  ')).toBe('SOUTH');
        expect(deriveZone('Maharashtra   ')).toBe('WEST');
        expect(deriveZone('   Delhi')).toBe('NORTH');
      });
    });
  });
});
