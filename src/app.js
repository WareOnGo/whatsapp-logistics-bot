const express = require('express');
const whatsappRoutes = require('./routes/whatsapp');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.status(200).send('OK');
});

app.use('/api/whatsapp', whatsappRoutes);

module.exports = app;