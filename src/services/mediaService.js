// Media handling for the OpenClaw assistant: images (vision) + PDFs/docs (text).
//
// WhatsApp media arrives as a Twilio-hosted URL (auth-protected). We download it and:
//   - image  -> a base64 data URI (OpenClaw vision requires data URIs, not external URLs)
//   - pdf    -> extracted text (pdf-parse)
//   - doc/docx -> extracted text (mammoth)
// The result is buffered per-user (see mediaContextService) and attached to the agent
// call. Runs on the bot (Render) — the Lightsail box is not involved.

const axios = require('axios');
const { uploadMediaFromUrl } = require('./storageService');

const MAX_MEDIA_BYTES = 24 * 1024 * 1024; // bytes live in R2, so we can allow bigger files
const MAX_DOC_CHARS = 8000;               // cap extracted text we feed the agent

function classify(contentType, fileName = '') {
  const ct = (contentType || '').toLowerCase().split(';')[0];
  const name = (fileName || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'application/pdf') return 'pdf';
  // spreadsheets (data cleanup). Twilio mislabels CSV as ms-excel sometimes — use name too.
  if (ct === 'text/csv' || ct === 'application/csv' || name.endsWith('.csv')) return 'csv';
  if (
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ct === 'application/vnd.ms-excel' || name.endsWith('.xlsx') || name.endsWith('.xls')
  ) return 'xlsx';
  if (
    ct === 'application/msword' ||
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) return 'doc';
  return 'other';
}

async function fetchTwilioMedia(mediaUrl) {
  const resp = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    maxContentLength: MAX_MEDIA_BYTES,
    timeout: 30000,
  });
  return Buffer.from(resp.data);
}

async function extractPdfText(buf) {
  const { PDFParse } = require('pdf-parse'); // v2 class API
  const parser = new PDFParse({ data: buf });
  try {
    const r = await parser.getText();
    return (r.text || '').trim();
  } finally {
    try { await parser.destroy(); } catch (_) { /* noop */ }
  }
}

async function extractDocText(buf) {
  const mammoth = require('mammoth');
  const r = await mammoth.extractRawText({ buffer: buf });
  return (r.value || '').trim();
}

// Download + prepare a media attachment. Returns one of:
//   { kind:'image', r2Url, mime }        -> bytes stored in R2; resolved to a data URI at call time
//   { kind:'pdf'|'doc', text, truncated} -> extracted text (small) kept in the pin
//   { kind:'other' }                     -> unsupported
//
// Images go to R2 (not RAM) so the bot stays light and can handle large files + long pins.
async function prepareMedia(mediaUrl, contentType) {
  const kind = classify(contentType);
  if (kind === 'other' || kind === 'audio') return { kind };

  if (kind === 'image') {
    const mime = (contentType || 'image/jpeg').split(';')[0];
    // "assistant-media/" prefix so an R2 lifecycle rule can auto-expire these (NOT warehouse photos)
    const r2Url = await uploadMediaFromUrl(mediaUrl, mime, { keyPrefix: 'assistant-media/' });
    return { kind, r2Url, mime };
  }
  // pdf / doc -> extract text (the file's bytes aren't needed by the agent)
  const buf = await fetchTwilioMedia(mediaUrl);
  let text = kind === 'pdf' ? await extractPdfText(buf) : await extractDocText(buf);
  const truncated = text.length > MAX_DOC_CHARS;
  if (truncated) text = text.slice(0, MAX_DOC_CHARS) + ' …[truncated]';
  return { kind, text, truncated };
}

// Fetch an image from its (public) R2 URL and return a base64 data URI for OpenClaw vision.
// Called at request time so the bytes only transit RAM transiently — never stored resident.
async function resolveImageDataUri(r2Url, mime) {
  const resp = await axios.get(r2Url, {
    responseType: 'arraybuffer', maxContentLength: MAX_MEDIA_BYTES, timeout: 30000,
  });
  return `data:${(mime || 'image/jpeg').split(';')[0]};base64,${Buffer.from(resp.data).toString('base64')}`;
}

module.exports = { classify, prepareMedia, resolveImageDataUri, fetchTwilioMedia };
