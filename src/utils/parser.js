function parseWarehouseData(message) {
  const lines = message.split('\n').map(line => line.trim());
  const data = {};

  lines.forEach(line => {
    if (line.startsWith('Name:')) data.name = line.split('Name:')[1].trim();
    if (line.startsWith('Location:')) data.location = line.split('Location:')[1].trim();
    if (line.startsWith('Capacity:')) data.capacity = parseInt(line.split('Capacity:')[1].trim());
    if (line.startsWith('Contact:')) data.contact = line.split('Contact:')[1].trim();
  });

  if (!data.name || !data.location || !data.capacity || !data.contact) {
    throw new Error('Incomplete data');
  }

  return data;
}

module.exports = parseWarehouseData;
