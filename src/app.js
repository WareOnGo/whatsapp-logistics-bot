const express = require('express');
const warehouseRoutes = require('./routes/warehouse');

const app = express();
app.use(express.json());

app.use('/api/warehouse', warehouseRoutes);

module.exports = app;
