// Reminder scheduling for the OpenClaw `/bot` bridge.
//
// Design (matches the OpenClaw playbook: keep the deterministic send path on the
// bot, the agent only proposes): the OpenClaw agent appends a machine-readable
// directive to its reply when a user asks to be reminded. This module extracts
// those directives, schedules them, and fires the reminder back to the user via
// Twilio — but ONLY within WhatsApp's free 24-hour service window.
//
// Directive format the agent emits (stripped from the user-facing reply):
//   [[REMINDER|minutes=180|text=call the Bhiwandi warehouse owner]]
//
// LIMITATION (v1): reminders are kept in-memory (setTimeout). They survive while
// the bot process runs, but are lost on restart/redeploy. Durable storage (DB) is
// the next step — see TODO at the bottom.

const twilio = require('twilio');

const DIRECTIVE_RE = /\[\[REMINDER\|minutes=(\d+)\|text=([^\]]+)\]\]/gi;
const MAX_MINUTES = 24 * 60; // WhatsApp free service window — never schedule beyond it

// Extract reminder directives from an agent reply. Returns { cleanText, reminders }.
function parseReminders(agentText) {
  const reminders = [];
  const cleanText = (agentText || '')
    .replace(DIRECTIVE_RE, (_m, mins, text) => {
      const minutes = parseInt(mins, 10);
      // Refuse anything beyond the 24h WhatsApp window (defense in depth — the
      // agent is also instructed to refuse and warn the user). Do NOT clamp.
      if (minutes > 0 && minutes <= MAX_MINUTES && text.trim()) {
        reminders.push({ minutes, text: text.trim() });
      } else if (minutes > MAX_MINUTES) {
        console.warn(`[reminder] dropped >24h directive (${minutes}m)`);
      }
      return ''; // strip the directive from what the user sees
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleanText, reminders };
}

// Schedule one reminder: fire via Twilio after `minutes`, addressed back to the
// user. `to`/`from` are the bot's number / the rep's number (inbound To/From).
function scheduleReminder({ minutes, text, to, from }) {
  if (minutes <= 0 || minutes > MAX_MINUTES) {
    console.warn(`[reminder] skipped out-of-window reminder (${minutes}m)`);
    return;
  }
  const delayMs = minutes * 60 * 1000;
  setTimeout(async () => {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({ from: to, to: from, body: `⏰ Reminder: ${text}` });
      console.log(`[reminder] delivered to ${from}: ${text}`);
    } catch (err) {
      // Most likely cause: the 24h window closed (user went quiet) → Twilio 63016.
      console.error(`[reminder] delivery failed to ${from}:`, err.message);
    }
  }, delayMs);
  console.log(`[reminder] scheduled for ${from} in ${minutes}m: ${text}`);
}

// Convenience: parse an agent reply and schedule everything found.
function handleAgentReply({ agentText, to, from }) {
  const { cleanText, reminders } = parseReminders(agentText);
  for (const r of reminders) scheduleReminder({ ...r, to, from });
  return cleanText;
}

module.exports = { parseReminders, scheduleReminder, handleAgentReply, MAX_MINUTES };

// TODO (durability): persist reminders in Postgres (Prisma `Reminder` model) and
// reload+reschedule pending ones on boot, so they survive a Render redeploy.
