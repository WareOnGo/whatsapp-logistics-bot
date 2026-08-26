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
  buildMediaJson: jest.fn().mockReturnValue({ images: [], videos: [], docs: [] }),
}));

// Mock axios for Twenty CRM forwarding
jest.mock('axios');
const axios = require('axios');

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
          .type('form')
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

    // Warehouse ingestion (template parsing, drafts, close/cancel, photo collection)
    // was removed when data entry moved to the Scout web form. Everything that used
    // to start or continue a submission now gets the form link instead.
    describe('Warehouse Entry Deprecated -> Scout form', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
      });

      const post = (body, extra = {}) =>
        request(app)
          .post('/')
          .type('form')
          .send({ From: 'whatsapp:+918076708542', Body: body, NumMedia: '0', ...extra });

      test.each([
        ['a filled-in template', 'Warehouse Type: PEB\nCity: Bhiwandi\nState: Maharashtra'],
        ['an empty message', ''],
        ['the close command', 'close'],
        ['the cancel command', 'cancel'],
        ['free text', 'Invalid warehouse data'],
      ])('returns the Scout form link for %s', async (_label, body) => {
        const response = await post(body);

        expect(response.status).toBe(200);
        expect(response.text).toContain('scout-frontend-mu.vercel.app');
        expect(response.text).toContain('moved off WhatsApp');
      });

      test('returns the Scout form link for a photo with no assistant session', async () => {
        const response = await post('', {
          NumMedia: '1',
          MediaUrl0: 'https://api.twilio.com/media/photo',
          MediaContentType0: 'image/jpeg',
        });

        expect(response.status).toBe(200);
        expect(response.text).toContain('scout-frontend-mu.vercel.app');
      });

      test('never writes a Warehouse row or a Draft', async () => {
        await post('Warehouse Type: PEB\nCity: Bhiwandi\nState: Maharashtra');

        expect(mockPrismaInstance.warehouse.create).not.toHaveBeenCalled();
        expect(mockPrismaInstance.draft.create).not.toHaveBeenCalled();
      });

      test('logs the attempt as DEPRECATED_WAREHOUSE_ENTRY', async () => {
        await post('Warehouse Type: PEB');

        expect(mockPrismaInstance.messageLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'DEPRECATED_WAREHOUSE_ENTRY' }),
          })
        );
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
      });

      test('survives a MessageLog write failure and still replies', async () => {
        mockPrismaInstance.messageLog.create.mockRejectedValueOnce(new Error('db down'));

        const response = await request(app)
          .post('/')
          .type('form')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'Invalid warehouse data',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('scout-frontend-mu.vercel.app');
      });
    });

    describe('Twenty CRM Forwarding (#twenty)', () => {
      beforeEach(() => {
        mockPrismaInstance.verifiedNumber.findFirst.mockResolvedValue({
          id: 1,
          phoneNumber: '+918076708542',
          isActive: true,
        });
        mockPrismaInstance.draft.findUnique.mockResolvedValue(null);
      });

      test('should fire-and-forget to Twenty CRM when health check passes and message contains #twenty', async () => {
        axios.get.mockResolvedValue({ data: { status: 'ok' } });
        axios.post.mockResolvedValue({ data: { parsed: { name: 'Test' } } });

        const response = await request(app)
          .post('/')
          .type('form')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'RFQ in Bangalore\nLocation: HSR layout\nBudget: 100/sft\n#twenty',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('RFQ sent to Twenty CRM');
        expect(axios.get).toHaveBeenCalledWith(
          `${process.env.TWENTY_BASE_URL}/health`,
          { timeout: 10000 }
        );
        expect(axios.post).toHaveBeenCalledWith(
          `${process.env.TWENTY_BASE_URL}/rfq`,
          { rfq: 'RFQ in Bangalore\nLocation: HSR layout\nBudget: 100/sft\n#twenty', senderNumber: '+918076708542' },
          { timeout: 120000 }
        );
      });

      test('should return service down message when health check fails', async () => {
        axios.get.mockRejectedValue(new Error('connect ECONNREFUSED'));

        const response = await request(app)
          .post('/')
          .type('form')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'some bad data #twenty',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('service might be down');
        expect(axios.post).not.toHaveBeenCalled();
        expect(mockPrismaInstance.messageLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'FAILURE' }),
          })
        );
      });

      test('should NOT forward to Twenty CRM when the message lacks #twenty', async () => {
        const response = await request(app)
          .post('/')
          .type('form')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'Invalid warehouse data',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('scout-frontend-mu.vercel.app');
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
      });

      test('should handle #twenty case-insensitively', async () => {
        axios.get.mockResolvedValue({ data: { status: 'ok' } });
        axios.post.mockResolvedValue({ data: { parsed: { name: 'Test' } } });

        const response = await request(app)
          .post('/')
          .type('form')
          .send({
            From: 'whatsapp:+918076708542',
            Body: 'some rfq #TWENTY',
            NumMedia: '0',
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('RFQ sent to Twenty CRM');
        expect(axios.get).toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalled();
      });
    });

  });
});
