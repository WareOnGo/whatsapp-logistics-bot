// Per-user "active attachment" pin — context pinning, R2/DB-backed.
//
// Image bytes live in R2 (r2Url); PDF/doc text is small and kept inline. The pin METADATA
// lives in Postgres (media_context), so it: survives bot restarts, holds no bytes in RAM,
// handles large files, and supports a long availability window. Keyed by sender (FK to
// VerifiedNumber) → isolated, never shared.
//
// Attach policy (see runAgentQuery): the pin is AVAILABLE for PIN_TTL, but only auto-
// attached while FRESH (first FRESH_MS) or when the user's message references it — so a
// long-lived pin doesn't get wastefully re-sent on unrelated turns.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PIN_TTL_MS = 2 * 60 * 60 * 1000; // pin available for 2 hours
const FRESH_MS = 15 * 60 * 1000;       // auto-attach without a cue for the first 15 min

// media = { kind, r2Url?, mime?, text?, truncated? }
async function setActiveMedia(senderNumber, media) {
  const expiresAt = new Date(Date.now() + PIN_TTL_MS);
  const data = {
    kind: media.kind,
    r2Url: media.r2Url || null,
    mime: media.mime || null,
    text: media.text || null,
    truncated: !!media.truncated,
    expiresAt,
  };
  try {
    await prisma.mediaContext.upsert({
      where: { senderNumber },
      create: { senderNumber, ...data },
      update: data,
    });
    return true;
  } catch (err) {
    console.error('[media] setActiveMedia failed:', err.message);
    return false;
  }
}

// Returns { media, pinnedAt } if a non-expired pin exists, else null.
async function getActiveMedia(senderNumber) {
  try {
    const row = await prisma.mediaContext.findUnique({ where: { senderNumber } });
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      await prisma.mediaContext.delete({ where: { senderNumber } }).catch(() => {});
      return null;
    }
    const pinnedAt = new Date(row.expiresAt).getTime() - PIN_TTL_MS;
    return {
      pinnedAt,
      media: { kind: row.kind, r2Url: row.r2Url, mime: row.mime, text: row.text, truncated: row.truncated },
    };
  } catch (err) {
    console.error('[media] getActiveMedia failed:', err.message);
    return null;
  }
}

async function clearActiveMedia(senderNumber) {
  try { await prisma.mediaContext.delete({ where: { senderNumber } }); } catch (_) {}
}

module.exports = { setActiveMedia, getActiveMedia, clearActiveMedia, PIN_TTL_MS, FRESH_MS };
