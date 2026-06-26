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

// Caps to keep re-sent context small. The biggest per-call cost is OpenClaw's own base
// agent context (skills + AGENTS.md + references), so history just needs to be enough for
// conversational continuity — not a transcript of long drafts.
const MAX_TURNS = 16;          // backstop on turn count (~8 exchanges)
const MAX_TURN_CHARS = 1200;   // truncate any single stored turn (e.g. a long draft)
const MAX_TOTAL_CHARS = 6000;  // total history budget; drop oldest turns beyond this

function truncate(text) {
  const s = String(text || '');
  return s.length > MAX_TURN_CHARS ? s.slice(0, MAX_TURN_CHARS) + ' …[truncated]' : s;
}

// Keep the most-recent turns within BOTH the turn-count and total-char budgets.
function trim(turns) {
  let kept = turns.slice(-MAX_TURNS);
  let total = 0;
  const out = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    total += (kept[i].content || '').length;
    if (total > MAX_TOTAL_CHARS && out.length > 0) break;
    out.unshift(kept[i]);
  }
  return out;
}

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
    const next = trim([...prev,
      { role: 'user', content: truncate(userText) },
      { role: 'assistant', content: truncate(assistantText) },
    ]);
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
