// OpenClaw `/bot` bridge for the WhatsApp logistics bot.
//
// Topology (see the OpenClaw integration playbook): Twilio is the gateway; this
// service dispatches `/bot ...` messages to the OpenClaw agent and replies
// ASYNCHRONOUSLY via Twilio's REST API. OpenClaw never faces the internet — it's
// reached over the private Tailscale address of the Lightsail box.
//
// Required env:
//   OPENCLAW_URL    e.g. https://openclaw-1.<your-tailnet>.ts.net   (Tailscale Serve)
//   OPENCLAW_TOKEN  the gateway auth token
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN   (already used elsewhere in this repo)

const axios = require('axios');
const twilio = require('twilio');

const OPENCLAW_URL = process.env.OPENCLAW_URL;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;
const OPENCLAW_TIMEOUT_MS = 90 * 1000; // agent runs can take many seconds
const BOT_PREFIX = '/bot';
const WHATSAPP_MAX_LEN = 1500; // WhatsApp hard limit is ~1600; leave headroom

function isBotCommand(body) {
  return (body || '').trim().toLowerCase().startsWith(BOT_PREFIX);
}

function stripPrefix(body) {
  return (body || '').trim().slice(BOT_PREFIX.length).trim();
}

// Call the OpenClaw agent via its OpenAI-compatible endpoint. `model: "openclaw"`
// routes through the configured agent (skills, memory, model), not a raw LLM.
async function askOpenClaw(prompt) {
  const resp = await axios.post(
    `${OPENCLAW_URL}/v1/chat/completions`,
    { model: 'openclaw', messages: [{ role: 'user', content: prompt }] },
    {
      headers: {
        Authorization: `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: OPENCLAW_TIMEOUT_MS,
    }
  );
  return resp.data?.choices?.[0]?.message?.content?.trim() || '(no response)';
}

// Fire-and-forget: the caller has already returned 200 to Twilio. We run the
// agent and then push the answer back inside the open 24-hour window (free,
// no template). `from`/`to` come from the inbound webhook, so no extra number var.
async function handleBotCommandAsync({ to, from, body }) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // Reply goes FROM the bot's number (inbound `To`) back TO the rep (inbound `From`).
  const reply = (text) => client.messages.create({ from: to, to: from, body: text });

  const query = stripPrefix(body);
  if (!query || query.toLowerCase() === 'help') {
    await reply('Ask me anything, e.g.\n`/bot summarise today’s warehouse submissions`\n`/bot what did I note earlier?`');
    return;
  }

  try {
    const answer = await askOpenClaw(query);
    await reply(answer.slice(0, WHATSAPP_MAX_LEN));
  } catch (err) {
    console.error('[openclaw] bot command failed:', err.response?.status, err.message);
    await reply('Sorry — I couldn’t reach the assistant just now. Please try again in a moment.');
  }
}

module.exports = { isBotCommand, handleBotCommandAsync };
