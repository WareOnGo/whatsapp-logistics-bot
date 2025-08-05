// Dummy model representation
class Warehouse {
  constructor(name, location, capacity, contact) {
    this.name = name;
    this.location = location;
    this.capacity = capacity;
    this.contact = contact;
    this.created_at = new Date();
  }
}

module.exports = Warehouse;
