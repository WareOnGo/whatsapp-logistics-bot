// routes/whatsapp.js

const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const parseWarehouseData = require('../utils/warehouseParser');
const { deriveZone, saveWarehouse, logMessage, isVerifiedNumber } = require('../services/warehouseService');

router.post('/', async (req, res) => {
  const twiml = new MessagingResponse();

  const senderNumber = req.body.From.replace('whatsapp:', '').trim();
  const messageBody = req.body.Body;

  const isVerified = await isVerifiedNumber(senderNumber);

  if (!isVerified) {
    // NEW: Log the unverified attempt before stopping.
    await logMessage({
      senderNumber: senderNumber,
      messageBody: messageBody,
      status: 'UNVERIFIED_ATTEMPT',
      errorMessage: 'Sender number is not on the allowlist.',
    });
    
    // Then, send the empty response to do nothing and save costs.
    console.log(`Ignoring message from unverified number: ${senderNumber}`);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<Response/>');
    return;
  }

  // If verified, the logic continues as before...
  try {
    const parsedData = parseWarehouseData(messageBody);
    const zone = deriveZone(parsedData.state);
    
    const finalData = {
      ...parsedData,
      zone: zone,
    };

    const newWarehouse = await saveWarehouse(finalData);

    await logMessage({
      senderNumber: senderNumber,
      messageBody: messageBody,
      status: 'SUCCESS',
    });

    const successMessage = `✅ Success! Your warehouse data has been saved with ID: *${newWarehouse.id}*.`;
    twiml.message(successMessage);

  } catch (err) {
    console.error('Error processing WhatsApp message:', err.message);

    await logMessage({
      senderNumber: senderNumber,
      messageBody: messageBody,
      status: 'FAILURE',
      errorMessage: err.message,
    });

    const errorMessage = `❌ Error: We couldn't process your data. \n\n*Reason*: ${err.message} \n\nPlease correct the message and try again.`;
    twiml.message(errorMessage);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;