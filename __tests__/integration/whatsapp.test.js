// __tests__/integration/whatsapp.test.js
// Integration tests for the WhatsApp webhook endpoint

const request = require('supertest');
const express = require('express');

// Create mock Prisma instance BEFORE mocking the module
const mockPrismaInstance = {
  verifiedNumber: {
    findFirst: jest.fn(),
  },
  draft: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  warehouse: {
    create: jest.fn(),
  },
  warehouseData: {
    create: jest.fn(),
  },
  messageLog: {
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};

// Mock Prisma client
jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrismaInstance),
  };
});

// Mock storage service
jest.mock('../../src/services/storageService', () => ({
  uploadMediaFromUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-image.jpg'),
}));

// Now require the router after mocks are set up
const whatsappRouter = require('../../src/routes/whatsapp');

// Create Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use('/', whatsappRouter);
  return app;
}

describe('WhatsApp Webhook Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('POST / - Webhook Endpoint', () => {
    describe('Unverified Numbers', () => {
      test('should reject unverified numbers', async () => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+919999999999',
            Body: 'Test message',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('<Response/>');
        expect(mockPrismaInstance.messageLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'UNVERIFIED_ATTEMPT',
            }),
          })
        );
      });
    });

    describe('Verified Numbers - New Submission', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
        mockPrismaInstance.draft.findUnique.mockResolvedValue(null);
      });

      test('should handle submission with mediaAvailable=n (immediate save)', async () => {
        mockPrismaInstance.warehouse.create.mockResolvedValue({ id: 100 });
        mockPrismaInstance.warehouseData.create.mockResolvedValue({ id: 200 });

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: `Warehouse Owner Type: company
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
Uploaded by: Test`,
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Success');
        expect(response.text).toContain('100');
        expect(mockPrismaInstance.warehouse.create).toHaveBeenCalled();
        expect(mockPrismaInstance.warehouseData.create).toHaveBeenCalled();
      });

      test('should create draft when mediaAvailable=y', async () => {
        mockPrismaInstance.draft.create.mockResolvedValue({
          senderNumber: '+918076708542',
          status: 'awaiting_images',
        });

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: `Warehouse Owner Type: company
Media Available: y
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
Uploaded by: Test`,
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Please send your media');
        expect(mockPrismaInstance.draft.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'awaiting_images',
              senderNumber: '+918076708542',
            }),
          })
        );
      });

      test('should parse and save new optional fields', async () => {
        mockPrismaInstance.warehouse.create.mockResolvedValue({ id: 101 });
        mockPrismaInstance.warehouseData.create.mockResolvedValue({ id: 201 });

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: `Warehouse Owner Type: company
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
Vaastu Compliance: Yes
Approach Road Width: 40 feet
Dimensions: 200x250
Parking/Docking Space: 10 trucks
Pollution Zone: Green
Power (in kva): 1000
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`,
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(mockPrismaInstance.warehouseData.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              vaastuCompliance: 'Yes',
              approachRoadWidth: '40 feet',
              dimensions: '200x250',
              parkingDockingSpace: '10 trucks',
              pollutionZone: 'Green',
              powerKva: '1000',
            }),
          })
        );
      });
    });

    describe('Draft Management', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
      });

      test('should finalize draft on "close" command', async () => {
        const mockDraft = {
          senderNumber: '+918076708542',
          status: 'awaiting_images',
          imageUrls: ['https://s3.amazonaws.com/image1.jpg'],
          warehouseData: {
            warehouseOwnerType: 'company',
            warehouseType: 'PEB',
            address: 'Test',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '562149',
            contactPerson: 'Test',
            contactNumber: '9845226666',
            totalSpaceSqft: [50000],
            fireNocAvailable: true,
            fireSafetyMeasures: 'Hydrants',
            compliances: 'Test',
            ratePerSqft: '40',
            uploadedBy: 'Test',
            isBroker: 'n',
          },
          createdAt: new Date(),
        };

        mockPrismaInstance.draft.findUnique.mockResolvedValue(mockDraft);
        mockPrismaInstance.warehouse.create.mockResolvedValue({ id: 102 });
        mockPrismaInstance.warehouseData.create.mockResolvedValue({ id: 202 });
        mockPrismaInstance.draft.delete.mockResolvedValue({});

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'close',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('All done');
        expect(response.text).toContain('102');
        expect(mockPrismaInstance.warehouse.create).toHaveBeenCalled();
        expect(mockPrismaInstance.draft.delete).toHaveBeenCalled();
      });

      test('should cancel draft on "cancel" command', async () => {
        const mockDraft = {
          senderNumber: '+918076708542',
          status: 'awaiting_images',
          imageUrls: [],
          warehouseData: {},
          createdAt: new Date(),
        };

        mockPrismaInstance.draft.findUnique.mockResolvedValue(mockDraft);
        mockPrismaInstance.draft.delete.mockResolvedValue({});

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'cancel',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('canceled');
        expect(mockPrismaInstance.draft.delete).toHaveBeenCalled();
        expect(mockPrismaInstance.warehouse.create).not.toHaveBeenCalled();
      });

      test('should add image to existing draft', async () => {
        const mockDraft = {
          senderNumber: '+918076708542',
          status: 'awaiting_images',
          imageUrls: ['https://s3.amazonaws.com/image1.jpg'],
          warehouseData: {},
          createdAt: new Date(),
        };

        mockPrismaInstance.draft.findUnique.mockResolvedValue(mockDraft);
        mockPrismaInstance.draft.update.mockResolvedValue({});

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: '',
            NumMedia: '1',
            MediaUrl0: 'https://api.twilio.com/image.jpg',
            MediaContentType0: 'image/jpeg',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Image received');
        expect(mockPrismaInstance.draft.update).toHaveBeenCalled();
      });

      test('should expire old draft (>15 minutes)', async () => {
        const oldDate = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
        const mockDraft = {
          senderNumber: '+918076708542',
          status: 'awaiting_images',
          imageUrls: [],
          warehouseData: {},
          createdAt: oldDate,
        };

        mockPrismaInstance.draft.findUnique.mockResolvedValue(mockDraft);
        mockPrismaInstance.draft.delete.mockResolvedValue({});
        mockPrismaInstance.draft.create.mockResolvedValue({});

        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: `Warehouse Owner Type: company
Media Available: y
Warehouse Type: PEB
Address: Test
City: Bangalore
State: Karnataka
Postal Code: 562149
Contact Person: Test
Contact Number: 9845226666
Total Space: 50000 sqft
Fire NOC Available: Y
Fire Safety Measures: Test
Compliances: Test
Rate Per Sqft: 40
Is Broker (y/n)?: n
Uploaded by: Test`,
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('expired');
        expect(mockPrismaInstance.draft.delete).toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
        mockPrismaInstance.draft.findUnique.mockResolvedValue(null);
      });

      test('should handle parsing errors gracefully', async () => {
        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'Invalid warehouse data',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Error');
        expect(mockPrismaInstance.messageLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'FAILURE',
            }),
          })
        );
      });
    });

    describe('Template Message', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
        mockPrismaInstance.draft.findUnique.mockResolvedValue(null);
      });

      test('should send template for close/cancel without draft', async () => {
        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'close',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('No active submission');
      });

      test('should send template with new fields', async () => {
        const response = await request(app)
          .post('/')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'help',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Vaastu Compliance');
        expect(response.text).toContain('Approach Road Width');
        expect(response.text).toContain('Dimensions');
        expect(response.text).toContain('Parking/Docking Space');
        expect(response.text).toContain('Pollution Zone');
        expect(response.text).toContain('Power (in kva)');
      });
    });
  });
});
