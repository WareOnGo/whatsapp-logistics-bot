// Sticky OpenClaw assistant sessions.
//
// Once a verified user sends /bot or /content, their subsequent plain messages route
// to that agent for SESSION_HOURS (refreshed on each message) — no prefix needed —
// until they send an exit command or it expires. Backed by the `agent_session` table
// so it survives bot restarts/redeploys.
//
// All DB calls are wrapped: if the table is missing or the DB hiccups, we treat the
// user as having no active session (falls back to prefix-required behaviour) rather
// than breaking the webhook.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SESSION_HOURS = 48;
const EXIT_COMMANDS = new Set(['/stop', '/exit', '/done', '/warehouse', 'stop', 'exit']);

function isExitCommand(body) {
  return EXIT_COMMANDS.has((body || '').trim().toLowerCase());
}

// Returns { agent } if the user has a live (non-expired) session, else null.
async function getActiveSession(senderNumber) {
  try {
    const s = await prisma.agentSession.findUnique({ where: { senderNumber } });
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() <= Date.now()) {
      await prisma.agentSession.delete({ where: { senderNumber } }).catch(() => {});
      return null;
    }
    return { agent: s.agent };
  } catch (err) {
    console.error('[session] getActiveSession failed (treating as none):', err.message);
    return null;
  }
}

// Start or refresh a session for `agent`, extending the window by SESSION_HOURS.
async function startSession(senderNumber, agent) {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  try {
    await prisma.agentSession.upsert({
      where: { senderNumber },
      create: { senderNumber, agent, expiresAt },
      update: { agent, expiresAt },
    });
  } catch (err) {
    console.error('[session] startSession failed:', err.message);
  }
}

async function endSession(senderNumber) {
  try {
    await prisma.agentSession.delete({ where: { senderNumber } });
    return true;
  } catch (err) {
    return false; // no session to end (or DB issue) — caller treats as already-out
  }
}

module.exports = { getActiveSession, startSession, endSession, isExitCommand, SESSION_HOURS };
