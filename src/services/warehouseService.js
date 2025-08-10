// services/warehouseService.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function deriveZone(state) {
  const s = state.toLowerCase().trim();
  switch (s) {
    // --- NORTH ZONE ---
    case 'jammu and kashmir':
    case 'ladakh':
    case 'punjab':
    case 'himachal pradesh':
    case 'haryana':
    case 'chandigarh':
    case 'uttarakhand':
    case 'delhi':
    case 'rajasthan':
    case 'uttar pradesh':
      return 'NORTH';

    // --- WEST ZONE ---
    case 'gujarat':
    case 'maharashtra':
    case 'goa':
    case 'dadra and nagar haveli and daman and diu':
      return 'WEST';

    // --- SOUTH ZONE ---
    case 'karnataka':
    case 'telangana':
    case 'andhra pradesh':
    case 'kerala':
    case 'tamil nadu':
    case 'puducherry':
    case 'lakshadweep':
    case 'andaman and nicobar islands':
      return 'SOUTH';
      
    // --- EAST ZONE (includes North-East) ---
    case 'bihar':
    case 'jharkhand':
    //case 'odisha':  // Note: Odisha is often considered East, but is sometimes grouped with Central/South depending on context. Adjust as needed.
    case 'west bengal':
    case 'sikkim':
    case 'arunachal pradesh':
    case 'nagaland':
    case 'manipur':
    case 'mizoram':
    case 'tripura':
    case 'meghalaya':
    case 'assam':
      return 'EAST';

    // --- CENTRAL ZONE ---
    case 'madhya pradesh':
    case 'chhattisgarh':
    case 'odisha': // Note: Odisha is often considered East, but is sometimes grouped with Central/South depending on context. Adjust as needed.
      return 'CENTRAL';
      
    default:
      return 'MISC';
  }
}

async function saveWarehouse(data) {
  return await prisma.warehouse.create({
    data: data
  });
}

async function logMessage(logData) {
  try {
    await prisma.messageLog.create({
      data: {
        senderNumber: logData.senderNumber,
        messageBody: logData.messageBody,
        status: logData.status,
        errorMessage: logData.errorMessage,
      },
    });
  } catch (error) {
    // Log to console if logging to the database fails
    console.error('Failed to write to MessageLog:', error);
  }
}

module.exports = {
  deriveZone,
  saveWarehouse,
  logMessage
};