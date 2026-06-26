// Reminder scheduling for the OpenClaw assistant.
//
// The agent appends a machine-readable directive when a user asks to be reminded; we
// extract it, PERSIST it to Postgres, and a background poller fires due reminders via
// Twilio. DB-backed so reminders survive bot restarts/redeploys (the old in-memory
// setTimeout lost them). WhatsApp's free service window is 24h, so we never schedule
// beyond that.
//
// Directive (stripped from the user-facing reply):
//   [[REMINDER|minutes=180|text=call the Bhiwandi warehouse owner]]

const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DIRECTIVE_RE = /\[\[REMINDER\|minutes=(\d+)\|text=([^\]]+)\]\]/gi;
const MAX_MINUTES = 24 * 60;          // WhatsApp free service window
const POLL_MS = 30 * 1000;            // how often the poller checks for due reminders
const LATE_GRACE_MS = 60 * 60 * 1000; // fire up to 1h late (after downtime); else mark missed

// Extract reminder directives from an agent reply. Returns { cleanText, reminders }.
function parseReminders(agentText) {
  const reminders = [];
  const cleanText = (agentText || '')
    .replace(DIRECTIVE_RE, (_m, mins, text) => {
      const minutes = parseInt(mins, 10);
      if (minutes > 0 && minutes <= MAX_MINUTES && text.trim()) {
        reminders.push({ minutes, text: text.trim() });
      } else if (minutes > MAX_MINUTES) {
        console.warn(`[reminder] dropped >24h directive (${minutes}m)`);
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleanText, reminders };
}

// Parse + persist any reminders found, and return the cleaned user-facing text.
// `to` = bot's WhatsApp number (inbound To), `from` = rep's WhatsApp number (inbound From).
async function handleAgentReply({ agentText, to, from }) {
  const { cleanText, reminders } = parseReminders(agentText);
  if (reminders.length) {
    const senderNumber = (from || '').replace('whatsapp:', '').trim();
    for (const r of reminders) {
      try {
        await prisma.reminder.create({
          data: {
            senderNumber,
            fromNumber: to,
            text: r.text,
            dueAt: new Date(Date.now() + r.minutes * 60 * 1000),
            status: 'pending',
          },
        });
        console.log(`[reminder] saved for ${senderNumber} in ${r.minutes}m: ${r.text}`);
      } catch (err) {
        console.error('[reminder] persist failed:', err.message);
      }
    }
  }
  return cleanText;
}

// Fire all due, pending reminders. Safe to run on an interval and after a restart.
async function fireDueReminders() {
  let due;
  try {
    due = await prisma.reminder.findMany({
      where: { status: 'pending', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });
  } catch (err) {
    console.error('[reminder] poll query failed:', err.message);
    return;
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  for (const r of due) {
    const tooLate = Date.now() - new Date(r.dueAt).getTime() > LATE_GRACE_MS;
    // Atomically claim it so overlapping polls can't double-fire.
    const target = tooLate ? 'missed' : 'sent';
    const claim = await prisma.reminder
      .updateMany({ where: { id: r.id, status: 'pending' }, data: { status: target } })
      .catch(() => ({ count: 0 }));
    if (claim.count !== 1) continue; // already handled by another tick
    if (tooLate) { console.warn(`[reminder] missed (too late) #${r.id}`); continue; }
    try {
      await client.messages.create({
        from: r.fromNumber,
        to: `whatsapp:${r.senderNumber}`,
        body: `⏰ Reminder: ${r.text}`,
      });
      console.log(`[reminder] delivered #${r.id} to ${r.senderNumber}`);
    } catch (err) {
      // Most likely the 24h window closed (Twilio 63016). Mark failed (don't retry-spam).
      await prisma.reminder.update({ where: { id: r.id }, data: { status: 'failed' } }).catch(() => {});
      console.error(`[reminder] delivery failed #${r.id}:`, err.message);
    }
  }
}

// Pending (not-yet-fired) reminders for a user, soonest first — so the agent can include
// them when the user asks "what do I have left". A reminder is a timed to-do.
async function getPendingReminders(senderNumber) {
  try {
    return await prisma.reminder.findMany({
      where: { senderNumber, status: 'pending' },
      orderBy: { dueAt: 'asc' },
      take: 20,
    });
  } catch (err) {
    console.error('[reminder] getPending failed:', err.message);
    return [];
  }
}

let timer = null;
function startReminderScheduler() {
  if (timer) return timer;
  fireDueReminders().catch(() => {});               // catch up immediately on boot
  timer = setInterval(() => fireDueReminders().catch(() => {}), POLL_MS);
  if (timer.unref) timer.unref();
  console.log('[reminder] scheduler started');
  return timer;
}

module.exports = { parseReminders, handleAgentReply, fireDueReminders, startReminderScheduler, getPendingReminders, MAX_MINUTES };
