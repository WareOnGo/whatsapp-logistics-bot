// routes/whatsapp.js

const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const parseWarehouseData = require('../utils/warehouseParser'); // Your lenient parser
const { getNextWarehouseId, deriveZone, saveWarehouse } = require('../services/warehouseService'); // We'll create this service file next

router.post('/', async (req, res) => {
  // The user's message is in `req.body.Body` from Twilio
  const incomingMsg = req.body.Body;
  const twiml = new MessagingResponse();

  try {
    // 1. Parse the incoming message using your existing parser
    const parsedData = parseWarehouseData(incomingMsg);

    // 2. Generate the ID and Zone (from the service logic we will create)
    const newId = await getNextWarehouseId();
    const zone = deriveZone(parsedData.state);
    
    const finalData = {
      ...parsedData,
      id: newId,
      zone: zone,
    };

    // 3. Save the data to the database
    const newWarehouse = await saveWarehouse(finalData);

    // 4. Craft a success response to send back to the user
    const successMessage = `✅ Success! Your warehouse data has been saved with ID: *${newWarehouse.id}*.`;
    twiml.message(successMessage);

  } catch (err) {
    // 5. If any error occurs, craft a helpful error message
    console.error('Error processing WhatsApp message:', err.message);
    const errorMessage = `❌ Error: We couldn't process your data. \n\n*Reason*: ${err.message} \n\nPlease correct the message and try again.`;
    twiml.message(errorMessage);
  }

  // 6. Send the TwiML response back to Twilio
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;