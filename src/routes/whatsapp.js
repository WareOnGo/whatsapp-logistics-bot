const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { PrismaClient } = require('@prisma/client');
const parseWarehouseData = require('../utils/warehouseParser');
const { deriveZone, saveWarehouse, logMessage, isVerifiedNumber } = require('../services/warehouseService');
const { uploadMediaFromUrl } = require('../services/storageService');

const prisma = new PrismaClient();

router.post('/', async (req, res) => {
  const twiml = new MessagingResponse();
  const senderNumber = req.body.From.replace('whatsapp:', '').trim();
  const messageBody = (req.body.Body || '').trim();
  const numMedia = parseInt(req.body.NumMedia || '0');
  const imageUrl = numMedia > 0 ? req.body.MediaUrl0 : null;
  const contentType = numMedia > 0 ? req.body.MediaContentType0 : null;

  // Step 1: Verify the sender is on the allowlist
  const isVerified = await isVerifiedNumber(senderNumber);
  if (!isVerified) {
    await logMessage({ senderNumber, messageBody, status: 'UNVERIFIED_ATTEMPT', imageUrl });
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<Response/>');
    return;
  }

  // Step 2: Check for an active draft and handle expiration
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

    // Scenario A: User finalizes a submission
    if (userDraft && command === 'close') {
      const warehouseData = userDraft.warehouseData;
      
      const finalData = {
        warehouseOwnerType: warehouseData.warehouseOwnerType,
        warehouseType: warehouseData.warehouseType,
        address: warehouseData.address,
        googleLocation: warehouseData.googleLocation,
        city: warehouseData.city,
        state: warehouseData.state,
        postalCode: warehouseData.postalCode,
        contactPerson: warehouseData.contactPerson,
        contactNumber: warehouseData.contactNumber,
        numberOfDocks: warehouseData.numberOfDocks,
        clearHeightFt: warehouseData.clearHeightFt,
        compliances: warehouseData.compliances,
        otherSpecifications: warehouseData.otherSpecifications,
        ratePerSqft: warehouseData.ratePerSqft,
        availability: warehouseData.availability,
        uploadedBy: warehouseData.uploadedBy,
        isBroker: warehouseData.isBroker,
        totalSpaceSqft: Array.isArray(warehouseData.totalSpaceSqft) ? warehouseData.totalSpaceSqft : [],
        offeredSpaceSqft: warehouseData.offeredSpaceSqft,
        photos: userDraft.imageUrls.join(', '),
        zone: deriveZone(warehouseData.state),
      };

      const newWarehouse = await saveWarehouse(finalData);
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
      await logMessage({ 
        senderNumber, 
        messageBody: `[Submission Finalized with ${userDraft.imageUrls.length} images]`, 
        status: 'SUCCESS', 
        imageUrl: userDraft.imageUrls[0] || null 
      });
      twiml.message(`✅ All done! Warehouse submission complete. Your ID is *${newWarehouse.id}*.`);

    // Scenario B: User cancels a submission
    } else if (userDraft && command === 'cancel') {
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
      twiml.message(`Submission canceled. You can now start a new one.`);

    // Scenario C: User adds media to an existing draft
    } else if (userDraft && imageUrl) {
      const permanentUrl = await uploadMediaFromUrl(imageUrl, contentType);
      await prisma.draft.update({
        where: { senderNumber: senderNumber },
        data: { imageUrls: { push: permanentUrl } },
      });
      twiml.message(`👍 Image received. Send more media, reply "close" to finalize, or "cancel" to start over.`);
    
    // Scenario D: User sends new text while a draft is open
    } else if (userDraft && messageBody) {
        twiml.message(`You already have a submission in progress. To add media, please send a photo/PDF. To finalize, reply "close". To start over, reply "cancel".`);

    // Scenario E: User sends 'close' or 'cancel' with no draft
    } else if (!userDraft && (command === 'close' || command === 'cancel')) {
      twiml.message(`No active submission found. Ready to receive new warehouse details.`);

    // Scenario F: User starts a new submission
    } else if (!userDraft && messageBody) {
      const parsedData = parseWarehouseData(messageBody);
      const mediaAvailableValue = (parsedData.mediaAvailable || 'n').toLowerCase();

      if (mediaAvailableValue === 'y' || mediaAvailableValue === 'yes') {
        let initialImageUrls = [];
        if (imageUrl) {
            const permanentUrl = await uploadMediaFromUrl(imageUrl, contentType);
            initialImageUrls.push(permanentUrl);
        }
        await prisma.draft.create({
          data: {
            senderNumber: senderNumber,
            status: 'awaiting_images',
            warehouseData: parsedData,
            imageUrls: initialImageUrls,
          },
        });
        const currentMessage = twiml.toString().includes('expired') ? twiml.toString() : '';
        const newTwiml = new MessagingResponse();
        newTwiml.message(`${currentMessage} Details received. Please send your media now. Reply "close" to finish, or "cancel" to start over.`.trim());
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(newTwiml.toString());
        
      } else {
        let permanentUrl = null;
        if (imageUrl) {
            permanentUrl = await uploadMediaFromUrl(imageUrl, contentType);
        }
        const { mediaAvailable, ...warehouseData } = parsedData;
        const finalData = { 
            ...warehouseData, 
            zone: deriveZone(parsedData.state), 
            photos: permanentUrl
        };
        const newWarehouse = await saveWarehouse(finalData);
        await logMessage({ senderNumber, messageBody, status: 'SUCCESS', imageUrl: permanentUrl });
        twiml.message(`✅ Success! No media expected. Your warehouse data has been saved with ID: *${newWarehouse.id}*.`);
      }

    // Scenario G: Any other unexpected situation
    } else {
      const templateMessage = `To start a new submission, please copy this template, fill in the details, and send it back:

Warehouse Owner Type: 
Warehouse Type: 
Address: 
City: 
State: 
Postalcode: 
Google Location: 
Contact Person: 
Contact Number: 
Total Space: 
Offered Space: 
Number of Docks: 
Clear Height: 
Compliances: 
Other Specifications: 
Rate Per Sqft: 
Fire NOC Available (y/n): 
Fire Safety Measures: 
Land Type: 
Availability: 
Is Broker (y/n)?: 
Uploaded by: 
Media Available (y/n): `;
      twiml.message(templateMessage);
    }

  } catch (err) {
    if (userDraft) {
      await prisma.draft.delete({ where: { senderNumber: senderNumber } });
    }
    await logMessage({ senderNumber, messageBody, status: 'FAILURE', errorMessage: err.message, imageUrl: imageUrl });
    console.error('Error during submission:', err.message);
    const errorMessage = `❌ Error: ${err.message}`;
    twiml.message(errorMessage);
  }
  
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;