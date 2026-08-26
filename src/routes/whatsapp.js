const express = require('express');
const router = express.Router();
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const axios = require('axios');
const { logMessage, isVerifiedNumber } = require('../services/warehouseService');
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

// Warehouse data entry has moved off WhatsApp and into the Scout web form. The bot
// no longer parses templates, holds drafts, or writes Warehouse rows — see Step 2.
const SCOUT_FORM_URL = process.env.SCOUT_FORM_URL || 'https://scout-frontend-mu.vercel.app/';
const WAREHOUSE_ENTRY_MOVED_MSG =
  '📋 Warehouse entry has moved off WhatsApp.\n\n' +
  `Please submit warehouse details here instead:\n${SCOUT_FORM_URL}\n\n` +
  'The form handles photos and documents too, and everything lands in the same database.';

const prisma = require('../lib/prisma');

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
  // the cleaned file. Gated on an active session.
  if (numMedia > 0 && ['csv', 'xlsx'].includes(classify(contentType, req.body.MediaUrl0))) {
    const dcSession = await getActiveSession(senderNumber);
    if (dcSession) {
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
    // not in a session -> fall through to the Scout-form handover.
  }

  // Step 1a.2: image / PDF / doc -> attach to the assistant — but ONLY when the user is
  // in an assistant session. The attachment
  // is buffered and re-attached to follow-up questions (context pinning). With a caption,
  // we answer now; without one, we ack and wait for the question.
  if (numMedia > 0 && ['image', 'pdf', 'doc'].includes(classify(contentType, req.body.MediaUrl0))) {
    const mediaSession = await getActiveSession(senderNumber);
    if (mediaSession) {
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
    // else: not in an assistant session -> fall through to the Scout-form handover.
  }

  // Step 1b: exit the assistant -> back to warehouse-submission mode.
  if (isExitCommand(messageBody)) {
    const ended = await endSession(senderNumber);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    twiml.message(ended
      ? '✅ Assistant session closed. Send /bot or /content to chat with the assistant again.'
      : "You're not in an assistant session. Send /bot or /content to start one.");
    res.end(twiml.toString());
    return;
  }

  // Step 1c: explicit /bot or /content -> start/refresh a sticky session, then run.
  const parsedCmd = parseCommand(messageBody);
  if (parsedCmd) {
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
  // active agent and refresh the 48h window.
  const session = await getActiveSession(senderNumber);
  if (session) {
    await startSession(senderNumber, session.agent); // refresh expiry
    ackEmpty();
    runAgentQuery({ to: req.body.To, from: req.body.From, query: messageBody, agent: session.agent })
      .catch((e) => console.error('[openclaw] async handler error:', e.message));
    return;
  }

  // Step 2: Warehouse data entry is DEPRECATED on WhatsApp — it lives in the Scout
  // web form now. Everything that used to be ingestion (the blank template, a
  // filled-in template, follow-up photos, close/cancel) now just points at the form.
  //
  // Assistant traffic never reaches here — Steps 1a–1d return above. The one
  // non-ingestion path that did live in this block is #twenty, kept below: it only
  // sat inside the old catch because it piggybacked on the warehouse parser failing.

  // #twenty RFQ -> forward to Twenty CRM (behaviour unchanged, just no longer gated
  // behind a warehouse-parse error).
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
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml.toString());
  }

  // Everything else: hand over to the Scout form.
  await logMessage({ senderNumber, messageBody, status: 'DEPRECATED_WAREHOUSE_ENTRY', imageUrl });
  twiml.message(WAREHOUSE_ENTRY_MOVED_MSG);
  
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

module.exports = router;