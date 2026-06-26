// Bot-owned conversation history (per user).
//
// OpenClaw's Codex session continuity is unreliable (it threads via response-ids that
// reset on gateway restarts/deploys). So the BOT owns the conversation: we store each
// user's recent turns and send them to OpenClaw on every call. This makes memory:
//   - deterministic (survives gateway AND bot restarts — it's in Postgres),
//   - isolated (keyed by sender via FK to VerifiedNumber — never shared across users).
//
// Capped to the most recent turns to bound tokens. DB errors degrade to "no history"
// rather than breaking the webhook.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MAX_TURNS = 16; // ~8 user/assistant exchanges

// Returns [{role, content}, ...] (most-recent-last) or [] on miss/error.
async function getHistory(senderNumber) {
  try {
    const row = await prisma.conversation.findUnique({ where: { senderNumber } });
    return Array.isArray(row?.turns) ? row.turns : [];
  } catch (err) {
    console.error('[conversation] getHistory failed (treating as empty):', err.message);
    return [];
  }
}

// Append a user turn + assistant turn, trim to MAX_TURNS, persist.
async function appendExchange(senderNumber, userText, assistantText) {
  try {
    const prev = await getHistory(senderNumber);
    const next = [...prev,
      { role: 'user', content: userText },
      { role: 'assistant', content: assistantText },
    ].slice(-MAX_TURNS);
    await prisma.conversation.upsert({
      where: { senderNumber },
      create: { senderNumber, turns: next },
      update: { turns: next },
    });
  } catch (err) {
    console.error('[conversation] appendExchange failed:', err.message);
  }
}

async function clearHistory(senderNumber) {
  try { await prisma.conversation.delete({ where: { senderNumber } }); } catch (_) {}
}

module.exports = { getHistory, appendExchange, clearHistory, MAX_TURNS };
