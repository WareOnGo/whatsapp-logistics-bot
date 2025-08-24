const Fuse = require('fuse.js');

function parseWarehouseData(message) {
  const lines = message.split('\n').filter(line => line.trim() !== '');
  const data = {};

  const keyMap = {
    'warehouse owner type': 'warehouseOwnerType',
    'warehouse type': 'warehouseType',
    'address': 'address',
      'media available': 'mediaAvailable', 
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

  // --- Updated Validation ---
  
  const required = [
    'warehouseType',
    'address',
    'city',
    'state',
    'contactPerson',
    'contactNumber',
    'totalSpaceSqft',
    'compliances',
    'ratePerSqft',
    'uploadedBy'
  ];
  
  // 1. Create an empty array to hold the names of any missing fields.
  const missingFields = [];
  
  // 2. Loop through the required fields and collect any that are missing.
  for (const field of required) {
    if (!data[field]) {
      missingFields.push(field);
    }
  }
  
  // 3. After checking all fields, if the missingFields array is not empty, throw a single error.
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields from message: ${missingFields.join(', ')}`);
  }

  return data;
}

module.exports = parseWarehouseData;