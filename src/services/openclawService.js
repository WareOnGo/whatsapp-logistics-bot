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
const { handleAgentReply } = require('./reminderService');

const OPENCLAW_URL = process.env.OPENCLAW_URL;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;
const OPENCLAW_TIMEOUT_MS = 90 * 1000; // agent runs can take many seconds
const WHATSAPP_MAX_LEN = 1500; // WhatsApp hard limit is ~1600; leave headroom

// Command prefix -> OpenClaw agent. Each domain is its own agent (isolated
// workspace/skills/memory). To add a future use case: create the agent on the box
// (`openclaw agents add <id> ...`) and add one line here. The ops PA is the default.
const COMMAND_AGENTS = {
  '/bot': 'main', // ops PA + front-door router (classifies, may delegate)
  '/content': 'content', // explicit shortcut straight to the content engine
};

// Agents the PA is allowed to delegate to. Derived from the command map (everything
// except the PA itself), so adding a use case is one line in COMMAND_AGENTS.
const ROUTABLE_AGENTS = new Set(Object.values(COMMAND_AGENTS).filter((a) => a !== 'main'));
// The PA emits this when a request belongs to a specialist agent. The backend then
// forwards the ORIGINAL message to that agent. The directive is never shown to users.
const ROUTE_RE = /\[\[ROUTE\|agent=([a-z0-9-]+)\]\]/i;

// Parse an inbound message into { agent, query } if it starts with a known command
// prefix; otherwise null (not for us — falls through to normal logistics ingestion).
function parseCommand(body) {
  const trimmed = (body || '').trim();
  const lower = trimmed.toLowerCase();
  for (const [prefix, agent] of Object.entries(COMMAND_AGENTS)) {
    if (lower === prefix || lower.startsWith(prefix + ' ')) {
      return { agent, query: trimmed.slice(prefix.length).trim() };
    }
  }
  return null;
}

function isBotCommand(body) {
  return parseCommand(body) !== null;
}

// WhatsApp caps a single message at ~1600 chars, so long replies (e.g. a blog draft)
// must be SPLIT into multiple messages, not truncated. Split on paragraph/line
// boundaries; hard-split any oversized block; cap total parts as an anti-spam backstop.
const MAX_MESSAGE_PARTS = 8;
function chunkText(text, size = WHATSAPP_MAX_LEN) {
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.trim()) chunks.push(buf.trimEnd()); buf = ''; };
  for (const line of (text || '').split('\n')) {
    if (line.length > size) {            // a single very long line — hard-split it
      flush();
      for (let i = 0; i < line.length; i += size) chunks.push(line.slice(i, i + size));
      continue;
    }
    if ((buf + line + '\n').length > size) flush();
    buf += line + '\n';
  }
  flush();
  return chunks.length ? chunks : [''];
}

// Send a reply, splitting into ordered parts if it exceeds one WhatsApp message.
async function sendReply(reply, text) {
  const chunks = chunkText(text);
  const parts = Math.min(chunks.length, MAX_MESSAGE_PARTS);
  for (let i = 0; i < parts; i++) {
    const prefix = chunks.length > 1 ? `(${i + 1}/${Math.min(chunks.length, MAX_MESSAGE_PARTS)}) ` : '';
    await reply(prefix + chunks[i]);
  }
  if (chunks.length > MAX_MESSAGE_PARTS) {
    await reply(`…(${chunks.length - MAX_MESSAGE_PARTS} more parts trimmed — reply "continue" for the rest)`);
  }
}

// Call the OpenClaw agent via its OpenAI-compatible endpoint. `model: "openclaw"`
// routes through the configured agent (skills, memory, model), not a raw LLM.
// `user` (the WhatsApp number) makes the Gateway derive a STABLE per-user session
// key, so each sender gets their own isolated, persistent conversation memory.
async function askOpenClaw(prompt, userId, agent = 'main') { // agent: which OpenClaw agent to target
  // Give the agent the current time + the user's id so it can compute reminder
  // timing ("in 3h", "at 5pm") and emit a [[REMINDER|minutes=..|text=..]] directive.
  const systemContext =
    `Current time (UTC): ${new Date().toISOString()}. ` +
    `You are talking to WhatsApp user ${userId}.`;
  const resp = await axios.post(
    `${OPENCLAW_URL}/v1/chat/completions`,
    {
      model: `openclaw/${agent}`,
      user: userId,
      messages: [
        { role: 'system', content: systemContext },
        { role: 'user', content: prompt },
      ],
    },
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

  const parsed = parseCommand(body);
  const { agent, query } = parsed || { agent: 'main', query: '' };
  if (!query || query.toLowerCase() === 'help') {
    await reply(
      'Commands:\n' +
      '`/bot <question>` — ops assistant (reminders, notes, warehouse Q&A)\n' +
      '`/content <seed>` — content engine (LinkedIn/X/blog/Reddit drafts in WareOnGo voice)'
    );
    return;
  }

  try {
    // `from` is the rep's WhatsApp number — stable per-user session key.
    // Orchestration loop: ask an agent; if it returns a [[ROUTE|agent=X]] directive,
    // forward the ORIGINAL query to X. Hard-bounded against loops:
    //   - MAX_ROUTING_HOPS caps total forwards,
    //   - `visited` blocks A→B→A (or A→A) cycles,
    //   - only the PA ("main") is allowed to delegate; specialist replies are final
    //     (so /content and any routed agent's output is never re-parsed for routes).
    const MAX_ROUTING_HOPS = 3;
    let agentNow = agent;
    const visited = new Set([agentNow]);
    let answer = '';
    for (let hop = 0; ; hop++) {
      answer = await askOpenClaw(query, from, agentNow);
      if (agentNow !== 'main') break; // only the PA delegates
      const m = answer.match(ROUTE_RE);
      const target = m && m[1].toLowerCase();
      if (!target || !ROUTABLE_AGENTS.has(target) || visited.has(target)) break;
      if (hop >= MAX_ROUTING_HOPS) {
        console.warn(`[openclaw] routing hop cap (${MAX_ROUTING_HOPS}) hit; stopping`);
        break;
      }
      console.log(`[openclaw] PA routed to agent "${target}"`);
      visited.add(target);
      agentNow = target; // forward the same query to the specialist
    }

    // Extract + schedule any reminder directives (≤24h), and strip them from the
    // user-facing text before replying. Long replies are split across messages.
    const cleanText = handleAgentReply({ agentText: answer, to, from });
    await sendReply(reply, cleanText);
  } catch (err) {
    console.error('[openclaw] bot command failed:', err.response?.status, err.message);
    await reply('Sorry — I couldn’t reach the assistant just now. Please try again in a moment.');
  }
}

module.exports = { isBotCommand, handleBotCommandAsync, chunkText };
