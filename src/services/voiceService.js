// Voice-note transcription for WhatsApp.
//
// WhatsApp voice notes arrive as audio media on the Twilio webhook (NumMedia>=1,
// MediaContentType0 = audio/ogg). We download the audio from Twilio (basic auth),
// send it to OpenAI's transcription API, and return the text — which the caller then
// routes to the OpenClaw agent like any typed message.
//
// Runs entirely on the bot (Render) + OpenAI — the Lightsail box is not involved.
// Requires: OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN. Uses Node 18+
// global fetch/FormData/Blob, so no new npm dependency.

const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // OpenAI limit is 25MB; WhatsApp notes are tiny

// Is this inbound message a voice note / audio?
function isVoiceNote(body) {
  const n = parseInt(body.NumMedia || '0', 10);
  const ct = (body.MediaContentType0 || '').toLowerCase();
  return n > 0 && ct.startsWith('audio');
}

// Download the Twilio-hosted audio and transcribe it. Returns the transcript text.
async function transcribe(mediaUrl, contentType) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  // 1. Fetch the audio bytes from Twilio (media URLs require account auth).
  const resp = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    maxContentLength: MAX_AUDIO_BYTES,
    timeout: 30000,
  });
  const buf = Buffer.from(resp.data);
  const mime = (contentType || 'audio/ogg').split(';')[0];
  const ext = (mime.split('/')[1] || 'ogg');

  // 2. Send to OpenAI transcription (multipart). Native FormData/Blob — no extra deps.
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `voice.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);

  const r = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`OpenAI transcribe ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.text || '').trim();
}

module.exports = { isVoiceNote, transcribe };
