// routes/whatsapp.js

const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const parseWarehouseData = require('../utils/warehouseParser');
const { deriveZone, saveWarehouse, logMessage } = require('../services/warehouseService'); // CHANGED: Added logMessage

router.post('/', async (req, res) => {
  const twiml = new MessagingResponse();
  
  // CHANGED: Get sender and message body from Twilio's request
  const senderNumber = req.body.From;
  const messageBody = req.body.Body;

  try {
    const parsedData = parseWarehouseData(messageBody);
    const zone = deriveZone(parsedData.state);
    
    const finalData = {
      ...parsedData,
      zone: zone,
    };

    const newWarehouse = await saveWarehouse(finalData);

    // Log the successful attempt
    await logMessage({
      senderNumber: senderNumber,
      messageBody: messageBody,
      status: 'SUCCESS',
    });

    const successMessage = `✅ Success! Your warehouse data has been saved with ID: *${newWarehouse.id}*.`;
    twiml.message(successMessage);

  } catch (err) {
    console.error('Error processing WhatsApp message:', err.message);

    // Log the failed attempt
    await logMessage({
      senderNumber: senderNumber,
      messageBody: messageBody,
      status: 'FAILURE',
      errorMessage: err.message, // Include the error message
    });

    const errorMessage = `❌ Error: We couldn't process your data. \n\n*Reason*: ${err.message} \n\nPlease correct the message and try again.`;
    twiml.message(errorMessage);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;