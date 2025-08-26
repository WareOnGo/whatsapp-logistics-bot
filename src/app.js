// app.js

const express = require('express');
const warehouseRoutes = require('./routes/warehouse'); // Old route for Postman testing
//const syncRoutes = require('./routes/sync');
const whatsappRoutes = require('./routes/whatsapp'); 
const testRoutes = require('./routes/test');

const app = express();

// Middleware for parsing JSON (for Postman/other APIs)
app.use(express.json()); 

// Middleware for parsing Twilio's urlencoded requests
app.use(express.urlencoded({ extended: true }));

// --- HEALTH CHECK / KEEP-ALIVE ROUTE ---
app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

// --- Your API Routes ---
app.use('/api/warehouse', warehouseRoutes);
//app.use('/api/sync', syncRoutes);
app.use('/api/whatsapp', whatsappRoutes); // Use the new route

app.use('/api/test', testRoutes); // Add this

module.exports = app;