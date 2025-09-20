// src/utils/warehouseParser.js

const Fuse = require('fuse.js');

/**
 * Parses a string of sizes (e.g., "500 sqft, 600 sq ft") into an array of integers.
 */
function parseSizesToArray(input) {
  if (!input) return [];
  return input
    .split(',')
    .map(part => {
      const cleanPart = part.replace(/\D/g, '');
      return cleanPart ? parseInt(cleanPart, 10) : null;
    })
    .filter(num => num !== null);
}

function parseWarehouseData(message) {
  const lines = message.split('\n').filter(line => line.trim() !== '');
  const data = {};

  const keyMap = {
    'warehouse owner type': 'warehouseOwnerType',
    'warehouse type': 'warehouseType',
    'address': 'address',
    'google location': 'googleLocation',
    'city': 'city',
    'state': 'state',
    'postalcode': 'postalCode',
    'contact person': 'contactPerson',
    'contact number': 'contactNumber',
    'total space': 'totalSpaceSqft',
    'offered space': 'offeredSpaceSqft',
    'number of docks': 'numberOfDocks',
    'clear height': 'clearHeightFt',
    'compliances': 'compliances',
    'other specifications': 'otherSpecifications',
    'rate per sqft': 'ratePerSqft',
    'availability': 'availability',
    'uploaded by': 'uploadedBy',
    'is broker (y/n)?': 'isBroker',
    'photos': 'photos',
    'media available': 'mediaAvailable',
  };

  const fuse = new Fuse(Object.keys(keyMap), {
    threshold: 0.4,
    ignoreLocation: true,
  });

  lines.forEach(line => {
    const parts = line.split(':');
    if (parts.length < 2) return;
    const keyFromMessage = parts[0].trim();
    const value = parts.slice(1).join(':').trim();
    const results = fuse.search(keyFromMessage);
    if (results.length > 0) {
      const bestMatchKey = results[0].item;
      const modelKey = keyMap[bestMatchKey];
      data[modelKey] = value;
    }
  });

  // --- UPDATED PARSING LOGIC ---
  // Only convert totalSpaceSqft to an integer array
  if (data.totalSpaceSqft) {
    data.totalSpaceSqft = parseSizesToArray(data.totalSpaceSqft);
  }
  // offeredSpaceSqft is left as a string
  // --- END OF UPDATED LOGIC ---

  const required = [
    'warehouseType', 'address', 'city', 'state', 'postalCode', 'contactPerson', 
    'contactNumber', 'totalSpaceSqft', 'compliances', 'ratePerSqft', 'uploadedBy'
  ];
  
  const missingFields = [];
  for (const field of required) {
    // Check if the field is missing or (if it's totalSpaceSqft) is an empty array
    if (!data[field] || (field === 'totalSpaceSqft' && data[field].length === 0)) {
      missingFields.push(field);
    }
  }
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  // Validate ratePerSqft cannot be zero
  if (data.ratePerSqft !== undefined) {
    const rateValue = parseFloat(data.ratePerSqft);
    if (!isNaN(rateValue) && rateValue === 0) {
      throw new Error('Zero value is not allowed in rate per sqft');
    }
  }

  return data;
}

module.exports = parseWarehouseData;