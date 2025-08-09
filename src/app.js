// app.js

const express = require('express');
const warehouseRoutes = require('./routes/warehouse'); // Old route for Postman testing
//const syncRoutes = require('./routes/sync');
const whatsappRoutes = require('./routes/whatsapp'); // Your new WhatsApp route

const app = express();

// Middleware for parsing JSON (for Postman/other APIs)
app.use(express.json()); 

// Middleware for parsing Twilio's urlencoded requests
app.use(express.urlencoded({ extended: true }));

// --- Your API Routes ---
app.use('/api/warehouse', warehouseRoutes);
//app.use('/api/sync', syncRoutes);
app.use('/api/whatsapp', whatsappRoutes); // Use the new route

// ... rest of your server setup (port listening etc.)
module.exports = app;