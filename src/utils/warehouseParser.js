const Fuse = require('fuse.js');

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
    'photos': 'photos'
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

  // --- Simplified Validation ---
  
  // Define which fields are compulsory in the message
  const required = ['warehouseOwnerType', 'warehouseType', 'address', 'city', 'state', 'contactPerson', 'contactNumber', 'totalSpaceSqft', 'numberOfDocks', 'compliances', 'ratePerSqft', 'uploadedBy'];
  
  // Check if all required fields were found in the message
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Missing required field from message: ${field}`);
    }
  }

  // NOTE: All type conversion logic has been removed.
  // The function returns the raw string data extracted from the message.
  return data;
}

module.exports = parseWarehouseData;