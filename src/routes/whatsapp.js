// routes/whatsapp.js

const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { PrismaClient } = require('@prisma/client');
const parseWarehouseData = require('../utils/warehouseParser');
const { deriveZone, saveWarehouse, logMessage, isVerifiedNumber } = require('../services/warehouseService');

const prisma = new PrismaClient();

router.post('/', async (req, res) => {
  const twiml = new MessagingResponse();
  const senderNumber = req.body.From.replace('whatsapp:', '').trim();
  const messageBody = (req.body.Body || '').trim();
  const numMedia = parseInt(req.body.NumMedia || '0');
  const imageUrl = numMedia > 0 ? req.body.MediaUrl0 : null;

  const isVerified = await isVerifiedNumber(senderNumber);
  if (!isVerified) {
    await logMessage({ senderNumber, messageBody, status: 'UNVERIFIED_ATTEMPT' });
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<Response/>');
    return;
  }

  let userDraft = await prisma.draft.findUnique({
    where: { senderNumber: senderNumber },
  });

  if (userDraft) {
    const DRAFT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    const draftAge = Date.now() - new Date(userDraft.createdAt).getTime();
    if (draftAge > DRAFT_TIMEOUT_MS) {
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
      twiml.message("Your previous session expired due to inactivity. This message will be treated as a new submission.");
      userDraft = null;
    }
  }

  try {
    const command = messageBody.toLowerCase();

    if (userDraft && command === 'close') {
      // --- CHANGED BLOCK 1 ---
      // Destructure to separate mediaAvailable from the actual warehouse data
      const { mediaAvailable, ...warehouseData } = userDraft.warehouseData;
      
      const finalData = {
        ...warehouseData,
        photos: userDraft.imageUrls.join(', '),
        zone: deriveZone(userDraft.warehouseData.state),
      };
      // --- END CHANGED BLOCK 1 ---

      const newWarehouse = await saveWarehouse(finalData);
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
      await logMessage({ senderNumber, messageBody: `[Submission Finalized]`, status: 'SUCCESS' });
      twiml.message(`✅ All done! Warehouse submission complete. Your ID is *${newWarehouse.id}*.`);

    } else if (userDraft && command === 'cancel') {
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
      twiml.message(`Submission canceled. You can now start a new one.`);

    } else if (userDraft && imageUrl) {
      await prisma.draft.update({
        where: { senderNumber: senderNumber },
        data: { imageUrls: { push: imageUrl } },
      });
      twiml.message(`👍 Image received. Send more media, reply "close" to finalize, or "cancel" to start over.`);
    
    } else if (userDraft && messageBody) {
        twiml.message(`You already have a submission in progress. To add media, please send a photo/PDF. To finalize, reply "close". To start over, reply "cancel".`);

    } else if (!userDraft && (command === 'close' || command === 'cancel')) {
      twiml.message(`No active submission found. Ready to receive new warehouse details.`);
    }
    
    else if (!userDraft && messageBody) {
      const parsedData = parseWarehouseData(messageBody);
      const mediaAvailableValue = (parsedData.mediaAvailable || 'n').toLowerCase();

      if (mediaAvailableValue === 'y' || mediaAvailableValue === 'yes') {
        await prisma.draft.create({
          data: {
            senderNumber: senderNumber,
            status: 'awaiting_images',
            warehouseData: parsedData,
            imageUrls: imageUrl ? [imageUrl] : [],
          },
        });
        const currentMessage = twiml.toString().includes('expired') ? twiml.toString() : '';
        const newTwiml = new MessagingResponse();
        newTwiml.message(`${currentMessage} Details received. Please send your media now. Reply "close" to finish, or "cancel" to start over.`.trim());
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(newTwiml.toString());
        
      } else {
        // --- CHANGED BLOCK 2 ---
        // Destructure to separate mediaAvailable from the actual warehouse data
        const { mediaAvailable, ...warehouseData } = parsedData;

        const finalData = {
          ...warehouseData,
          zone: deriveZone(parsedData.state),
          photos: imageUrl
        };
        // --- END CHANGED BLOCK 2 ---
        
        const newWarehouse = await saveWarehouse(finalData);
        await logMessage({ senderNumber, messageBody, status: 'SUCCESS' });
        twiml.message(`✅ Success! No media expected. Your warehouse data has been saved with ID: *${newWarehouse.id}*.`);
      }

    } else {
      const templateMessage = `To start a new submission, please copy this template, fill in the details, and send it back:

      Warehouse Type: 
      Address: 
      City: 
      State: 
      Contact Person: 
      Contact Number: 
      Total Space: 
      Compliances: 
      Rate Per Sqft: 
      Uploaded by: 
      Media Available (y/n): `;
      twiml.message(templateMessage);
    }

  } catch (err) {
    if (userDraft) {
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
    }
    await logMessage({ senderNumber, messageBody, status: 'FAILURE', errorMessage: err.message });
    console.error('Error during submission:', err.message);
    const errorMessage = `❌ Error: ${err.message}`;
    twiml.message(errorMessage);
  }
  
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;