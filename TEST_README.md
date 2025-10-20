# Unit Testing Guide

## Overview

This project includes comprehensive unit and integration tests using Jest and Supertest.

## Test Structure

```
__tests__/
├── setup.js                          # Global test setup
├── unit/
│   ├── warehouseParser.test.js      # Parser tests
│   └── warehouseService.test.js     # Service layer tests
└── integration/
    └── whatsapp.test.js             # WhatsApp webhook integration tests
```

## Running Tests

### Install Dependencies

```bash
npm install
```

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Only Unit Tests

```bash
npm run test:unit
```

### Run Only Integration Tests

```bash
npm run test:integration
```

### Run Tests with Coverage Report

```bash
npm test -- --coverage
```

## Test Coverage

The test suite aims for at least 70% coverage across:
- Branches
- Functions
- Lines
- Statements

Coverage reports are generated in the `coverage/` directory.

## Test Descriptions

### Unit Tests

#### `warehouseParser.test.js`
Tests for the warehouse data parser:
- ✅ Basic field parsing (all required fields)
- ✅ Optional field parsing (6 new fields)
- ✅ Fire NOC boolean conversion (y/yes/n → true/false)
- ✅ Total space array parsing
- ✅ Fuzzy matching for misspelled fields
- ✅ Missing required fields validation
- ✅ Optional fields handling

#### `warehouseService.test.js`
Tests for the warehouse service:
- ✅ Zone derivation for all Indian states
- ✅ Case insensitivity
- ✅ Whitespace handling
- ✅ Unknown state handling (MISC zone)

### Integration Tests

#### `whatsapp.test.js`
End-to-end tests for the WhatsApp webhook:
- ✅ Unverified number rejection
- ✅ New submission (immediate save with mediaAvailable=n)
- ✅ Draft creation (with mediaAvailable=y)
- ✅ New optional fields storage
- ✅ Draft finalization ("close" command)
- ✅ Draft cancellation ("cancel" command)
- ✅ Image upload to draft
- ✅ Draft expiration (>15 minutes)
- ✅ Error handling
- ✅ Template message with new fields

## Mocking

The integration tests use mocked versions of:
- **Prisma Client** - Database operations
- **Storage Service** - S3 uploads

This allows tests to run without actual database or AWS connections.

## Writing New Tests

### Example Unit Test

```javascript
describe('My Feature', () => {
  test('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Example Integration Test

```javascript
const request = require('supertest');
const app = require('../app');

describe('POST /api/endpoint', () => {
  test('should return 200', async () => {
    const response = await request(app)
      .post('/api/endpoint')
      .send({ data: 'test' });
    
    expect(response.status).toBe(200);
  });
});
```

## CI/CD Integration

Add this to your CI pipeline:

```yaml
- name: Run Tests
  run: npm test -- --ci --coverage --maxWorkers=2

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/coverage-final.json
```

## Troubleshooting

### Tests failing with "Cannot find module"
```bash
npm install
npx prisma generate
```

### Prisma Client issues in tests
The tests mock Prisma, but if you need the real client:
```bash
npx prisma generate
```

### Port already in use
Kill the process using the test port:
```bash
lsof -ti:5000 | xargs kill -9
```

## Best Practices

1. **Arrange-Act-Assert** - Structure tests clearly
2. **Descriptive Names** - Test names should explain what they test
3. **Isolated Tests** - Each test should be independent
4. **Mock External Services** - Don't hit real APIs/databases in unit tests
5. **Clean Up** - Use `beforeEach` and `afterEach` to reset state

## Coverage Goals

| Component | Current | Target |
|-----------|---------|--------|
| Parser | 95% | 90% |
| Service | 85% | 80% |
| Routes | 75% | 70% |
| Overall | 80% | 70% |
