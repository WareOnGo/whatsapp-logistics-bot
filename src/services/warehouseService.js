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
  // Extract the new WarehouseData fields
  const { fireNocAvailable, fireSafetyMeasures, landType, ...warehouseData } = data;
  
  // Create the warehouse record first
  const warehouse = await prisma.warehouse.create({
    data: warehouseData
  });
  
  // Always create the related WarehouseData record since fireNocAvailable and fireSafetyMeasures are mandatory
  await prisma.warehouseData.create({
    data: {
      warehouseId: warehouse.id,
      fireNocAvailable: typeof fireNocAvailable === 'boolean' ? fireNocAvailable : null,
      fireSafetyMeasures: fireSafetyMeasures || null,
      landType: landType || null,
    }
  });
  
  return warehouse;
}

async function logMessage(logData) {
  try {
    await prisma.messageLog.create({
      data: {
        senderNumber: logData.senderNumber,
        messageBody: logData.messageBody,
        status: logData.status,
        errorMessage: logData.errorMessage,
        imageUrl: logData.imageUrl,
      },
    });
  } catch (error) {
    // Log to console if logging to the database fails
    console.error('Failed to write to MessageLog:', error);
  }
}

async function isVerifiedNumber(senderNumber) {
  const verifiedUser = await prisma.verifiedNumber.findFirst({
    where: {
      phoneNumber: senderNumber,
      isActive: true,
    },
  });
  return !!verifiedUser; // Returns true if a user is found, false otherwise
}

module.exports = {
  deriveZone,
  saveWarehouse,
  logMessage,
  isVerifiedNumber
};