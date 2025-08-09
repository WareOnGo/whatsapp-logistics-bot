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

  // --- Fuse.js Setup for Fuzzy Matching ---
  const validKeys = Object.keys(keyMap);
  const fuse = new Fuse(validKeys, {
    // Threshold of 0.0 requires a perfect match.
    // Threshold of 1.0 would match anything.
    // 0.4 is a good starting point to allow for small typos.
    threshold: 0.4,
    ignoreLocation: true, // Search the entire string
  });

  lines.forEach(line => {
    const parts = line.split(':');
    if (parts.length < 2) return;

    const keyFromMessage = parts[0].trim();
    const value = parts.slice(1).join(':').trim();

    // Use Fuse.js to find the best match for the key
    const results = fuse.search(keyFromMessage);

    if (results.length > 0) {
      const bestMatchKey = results[0].item; // e.g., 'warehouse owner type'
      const modelKey = keyMap[bestMatchKey]; // e.g., 'warehouseOwnerType'
      data[modelKey] = value;
    }
  });

  // --- Validation and Type Conversion (This part remains the same) ---
  const finalData = {};
  
  const required = ['warehouseOwnerType', 'warehouseType', 'address', 'city', 'state', 'contactPerson', 'contactNumber', 'totalSpaceSqft', 'numberOfDocks', 'compliances', 'ratePerSqft', 'uploadedBy'];
  for (const field of required) {
    if (!data[field]) throw new Error(`Missing required field from message: ${field}`);
  }

  finalData.warehouseOwnerType = String(data.warehouseOwnerType);
  finalData.warehouseType = String(data.warehouseType);
  finalData.address = String(data.address);
  finalData.city = String(data.city);
  finalData.state = String(data.state);
  finalData.contactPerson = String(data.contactPerson);
  finalData.contactNumber = String(data.contactNumber);
  finalData.totalSpaceSqft = parseFloat(data.totalSpaceSqft);
  finalData.numberOfDocks = parseInt(data.numberOfDocks);
  finalData.compliances = data.compliances.split(',').map(item => item.trim());
  finalData.ratePerSqft = parseFloat(data.ratePerSqft);
  finalData.uploadedBy = String(data.uploadedBy);

  if (data.googleLocation) finalData.googleLocation = String(data.googleLocation);
  if (data.postalCode) finalData.postalCode = String(data.postalCode);
  if (data.offeredSpaceSqft) finalData.offeredSpaceSqft = parseFloat(data.offeredSpaceSqft);
  if (data.clearHeightFt) finalData.clearHeightFt = parseFloat(data.clearHeightFt);
  if (data.otherSpecifications) finalData.otherSpecifications = String(data.otherSpecifications);
  if (data.availability) finalData.availability = new Date(data.availability);
  if (data.isBroker) finalData.isBroker = data.isBroker.toLowerCase() === 'y';
  finalData.photos = data.photos ? data.photos.split(',').map(item => item.trim()) : [];

  if (isNaN(finalData.totalSpaceSqft) || isNaN(finalData.numberOfDocks) || isNaN(finalData.ratePerSqft)) {
    throw new Error('Numeric field contains invalid characters.');
  }

  return finalData;
}

module.exports = parseWarehouseData;