const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const parseWarehouseData = require('../utils/warehouseParser');
const { deriveZone, saveWarehouse, logMessage, isVerifiedNumber } = require('../services/warehouseService');
const { uploadMediaFromUrl, buildMediaJson } = require('../services/storageService');
const { parseCommand, handleBotCommandAsync, runAgentQuery, sendWhatsApp } = require('../services/openclawService');
const { getActiveSession, startSession, endSession, isExitCommand } = require('../services/sessionService');
const { isVoiceNote, transcribe } = require('../services/voiceService');
const { classify, prepareMedia, fetchTwilioMedia } = require('../services/mediaService');
const { setActiveMedia } = require('../services/mediaContextService');
const { cleanFile } = require('../services/dataCleanupService');

const TWENTY_BASE_URL = process.env.TWENTY_BASE_URL;
const TWENTY_RFQ_URL = `${TWENTY_BASE_URL}/rfq`;
const TWENTY_HEALTH_URL = `${TWENTY_BASE_URL}/health`;
const TWENTY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

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

  // --- OpenClaw assistant routing (sticky 48h sessions) ---
  const ackEmpty = () => { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<Response/>'); };

  // Step 1a: voice note -> transcribe -> treat the transcript as an assistant query.
  // Voice is conversational input (not warehouse data), so it goes to the assistant:
  // the active sticky agent if any, else the ops PA. Ack Twilio first; work async.
  if (isVoiceNote(req.body)) {
    ackEmpty();
    (async () => {
      try {
        const text = await transcribe(req.body.MediaUrl0, contentType);
        if (!text) {
          await sendWhatsApp(req.body.To, req.body.From, "I couldn't make out that voice note — could you try again or type it?");
          return;
        }
        const session = await getActiveSession(senderNumber);
        const agent = session ? session.agent : 'main';
        if (session) await startSession(senderNumber, agent); // refresh the 48h window
        // Show what was heard (transcription isn't perfect), then answer.
        await sendWhatsApp(req.body.To, req.body.From, `🎤 "${text}"`);
        await runAgentQuery({ to: req.body.To, from: req.body.From, query: text, agent });
      } catch (e) {
        console.error('[voice] transcription/handler failed:', e.message);
        await sendWhatsApp(req.body.To, req.body.From, "Sorry — I couldn't process that voice note just now. Please try again.")
          .catch(() => {});
      }
    })();
    return;
  }

  // Step 1a.1: spreadsheet (CSV/XLSX) in an assistant session -> data cleanup. Parse →
  // agent emits a cleanup spec → deterministic executor applies it → reply with summary +
  // the cleaned file. Gated on an active session so it never disrupts warehouse ingestion.
  if (numMedia > 0 && ['csv', 'xlsx'].includes(classify(contentType, req.body.MediaUrl0))) {
    const dcSession = await getActiveSession(senderNumber);
    const dcDraft = await prisma.draft.findUnique({ where: { senderNumber } });
    if (dcSession && !dcDraft) {
      ackEmpty();
      (async () => {
        try {
          await sendWhatsApp(req.body.To, req.body.From, '📄 Got your file — cleaning it up, one moment…');
          const kind = classify(contentType, req.body.MediaUrl0);
          const buf = await fetchTwilioMedia(req.body.MediaUrl0);
          const r = await cleanFile(buf, kind === 'xlsx' ? 'xlsx' : 'csv', messageBody.trim());
          await startSession(senderNumber, dcSession.agent); // refresh window
          if (!r.ok) {
            await sendWhatsApp(req.body.To, req.body.From, `Sorry — ${r.error}.`);
            return;
          }
          await sendWhatsApp(req.body.To, req.body.From, `${r.summaryText}\n\nHere's the cleaned file:`, r.r2Url);
        } catch (e) {
          console.error('[datacleanup] failed:', e.message);
          await sendWhatsApp(req.body.To, req.body.From, "Sorry — I couldn't clean that file just now. Please try again.").catch(() => {});
        }
      })();
      return;
    }
    // not in a session -> fall through (a stray spreadsheet isn't warehouse ingestion either,
    // but we leave existing behaviour untouched).
  }

  // Step 1a.2: image / PDF / doc -> attach to the assistant — but ONLY when the user is
  // in an assistant session (so warehouse photos still go to ingestion). The attachment
  // is buffered and re-attached to follow-up questions (context pinning). With a caption,
  // we answer now; without one, we ack and wait for the question.
  if (numMedia > 0 && ['image', 'pdf', 'doc'].includes(classify(contentType, req.body.MediaUrl0))) {
    const mediaSession = await getActiveSession(senderNumber);
    const mediaDraft = await prisma.draft.findUnique({ where: { senderNumber } });
    if (mediaSession && !mediaDraft) {
      ackEmpty();
      (async () => {
        try {
          const media = await prepareMedia(req.body.MediaUrl0, contentType);
          if (media.kind === 'other') {
            await sendWhatsApp(req.body.To, req.body.From, "I can't read that file type yet — try an image, PDF, or Word doc.");
            return;
          }
          const stored = await setActiveMedia(senderNumber, media);
          if (!stored) {
            await sendWhatsApp(req.body.To, req.body.From, "Sorry — I couldn't save that file just now. Please try again.");
            return;
          }
          await startSession(senderNumber, mediaSession.agent); // refresh window
          const caption = messageBody.trim();
          if (caption) {
            await runAgentQuery({ to: req.body.To, from: req.body.From, query: caption, agent: mediaSession.agent });
          } else {
            const noun = media.kind === 'image' ? 'image' : `${media.kind.toUpperCase()} file`;
            await sendWhatsApp(req.body.To, req.body.From, `📎 Got your ${noun}. What would you like to know about it?`);
          }
        } catch (e) {
          console.error('[media] handler failed:', e.message);
          await sendWhatsApp(req.body.To, req.body.From, "Sorry — I couldn't process that file just now. Please try again.").catch(() => {});
        }
      })();
      return;
    }
    // else: not in an assistant session -> fall through to warehouse ingestion (photos).
  }

  // Step 1b: exit the assistant -> back to warehouse-submission mode.
  if (isExitCommand(messageBody)) {
    const ended = await endSession(senderNumber);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    twiml.message(ended
      ? '✅ Back to warehouse submission mode. Send /bot or /content to chat with the assistant again.'
      : "You're in warehouse submission mode. Send /bot or /content to chat with the assistant.");
    res.end(twiml.toString());
    return;
  }

  // Step 1c: explicit /bot or /content -> start/refresh a sticky session, then run.
  // Don't enter assistant mode mid warehouse-submission (ingestion keeps priority).
  const parsedCmd = parseCommand(messageBody);
  if (parsedCmd) {
    const draft = await prisma.draft.findUnique({ where: { senderNumber } });
    if (draft) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      twiml.message('You have a warehouse submission in progress. Send `close` to finish it first, then use /bot or /content.');
      res.end(twiml.toString());
      return;
    }
    // Only `/bot` (the PA) starts a sticky 48h session. `/content` (and other
    // specialist prefixes) are ONE-SHOT — run this single message, don't trap the
    // user in that agent. Any existing /bot session is left untouched.
    if (parsedCmd.agent === 'main') {
      await startSession(senderNumber, 'main');
    }
    ackEmpty();
    handleBotCommandAsync({ to: req.body.To, from: req.body.From, body: messageBody })
      .catch((e) => console.error('[openclaw] async handler error:', e.message));
    return;
  }

  // Step 1d: sticky session active (no prefix needed). Route plain messages to the
  // active agent and refresh the 48h window — UNLESS a warehouse submission is in
  // progress, in which case ingestion takes priority (fall through).
  const session = await getActiveSession(senderNumber);
  if (session) {
    const draft = await prisma.draft.findUnique({ where: { senderNumber } });
    if (!draft) {
      await startSession(senderNumber, session.agent); // refresh expiry
      ackEmpty();
      runAgentQuery({ to: req.body.To, from: req.body.From, query: messageBody, agent: session.agent })
        .catch((e) => console.error('[openclaw] async handler error:', e.message));
      return;
    }
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
        media: buildMediaJson(userDraft.imageUrls),
        // include WarehouseData fields so saveWarehouse can persist them
        fireNocAvailable: warehouseData.fireNocAvailable,
        fireSafetyMeasures: warehouseData.fireSafetyMeasures,
        landType: warehouseData.landType,
        vaastuCompliance: warehouseData.vaastuCompliance,
        approachRoadWidth: warehouseData.approachRoadWidth,
        dimensions: warehouseData.dimensions,
        parkingDockingSpace: warehouseData.parkingDockingSpace,
        pollutionZone: warehouseData.pollutionZone,
        powerKva: warehouseData.powerKva,
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
            photos: permanentUrl,
            media: permanentUrl ? buildMediaJson([permanentUrl]) : null,
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
Vaastu Compliance: 
Approach Road Width: 
Dimensions: 
Parking/Docking Space: 
Pollution Zone: 
Power (in kva): 
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

    // If parse failed but message contains #twenty, forward to Twenty CRM as an RFQ
    if (messageBody.toLowerCase().includes('#twenty')) {
      try {
        await axios.get(TWENTY_HEALTH_URL, { timeout: 10000 });
      } catch (healthErr) {
        await logMessage({ senderNumber, messageBody, status: 'FAILURE', errorMessage: 'Twenty CRM service is down', imageUrl: imageUrl });
        twiml.message(`❌ Twenty CRM service might be down. Please try again later.`);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      // Service is up — fire and forget
      axios.post(TWENTY_RFQ_URL, { rfq: messageBody, senderNumber }, { timeout: TWENTY_TIMEOUT_MS })
        .then(resp => {
          logMessage({ senderNumber, messageBody, status: 'SUCCESS', imageUrl: imageUrl });
          console.log('Twenty CRM RFQ forwarded:', resp.data?.parsed?.name);
        })
        .catch(twentyErr => {
          const errMsg = twentyErr.response?.data?.error || twentyErr.message;
          logMessage({ senderNumber, messageBody, status: 'FAILURE', errorMessage: `Twenty CRM error: ${errMsg}`, imageUrl: imageUrl });
          console.error('Twenty CRM forwarding failed:', errMsg);
        });

      twiml.message(`✅ RFQ sent to Twenty CRM. You'll see it in the CRM shortly.`);
    } else {
      await logMessage({ senderNumber, messageBody, status: 'FAILURE', errorMessage: err.message, imageUrl: imageUrl });
      console.error('Error during submission:', err.message);
      twiml.message(`❌ Error: ${err.message}`);
    }
  }
  
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;