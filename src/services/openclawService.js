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
const { handleAgentReply, getPendingReminders, cancelPending } = require('./reminderService');
const { getHistory, appendExchange, clearHistory } = require('./conversationService');
const { getActiveMedia, FRESH_MS } = require('./mediaContextService');
const { resolveImageDataUri } = require('./mediaService');
const { getOpenTasks, formatTasksForContext, handleTaskDirectives, clearAllTasks } = require('./taskService');

// Control directives the agent emits to ACTUALLY perform destructive/clear actions —
// so it can never just claim "done" without the bot doing it. Stripped before reply.
const REMINDER_CANCEL_RE = /\[\[REMINDER_CANCEL\|([a-z0-9]+)\]\]/gi;
const TASKS_CLEAR_RE = /\[\[TASKS_CLEAR\]\]/i;
const CONTEXT_CLEAR_RE = /\[\[CONTEXT_CLEAR\]\]/i;

// Apply + strip control directives. Returns { text, contextCleared }.
async function handleControlDirectives(text, senderNumber, pendingReminders) {
  let out = text || '';
  let contextCleared = false;
  // reminder cancellations (may be multiple, e.g. all + a number)
  const cancels = [...out.matchAll(REMINDER_CANCEL_RE)].map((m) => m[1].toLowerCase());
  for (const which of cancels) await cancelPending(senderNumber, which, pendingReminders);
  out = out.replace(REMINDER_CANCEL_RE, '');
  if (TASKS_CLEAR_RE.test(out)) { await clearAllTasks(senderNumber); out = out.replace(TASKS_CLEAR_RE, ''); }
  if (CONTEXT_CLEAR_RE.test(out)) { await clearHistory(senderNumber); contextCleared = true; out = out.replace(CONTEXT_CLEAR_RE, ''); }
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, contextCleared };
}

// A long-lived pin is auto-attached while fresh; after that, only when the user's message
// actually refers to it — so we don't re-send a stale attachment on unrelated turns.
const MEDIA_REFERENCE_RE = /\b(this|that|it|image|photo|picture|pic|pdf|doc|document|file|attachment|above|shown|screenshot|chart|diagram|page|slide)\b/i;

// Resolve the user's active media pin into something askOpenClaw can attach (or null).
async function resolvePinnedMedia(senderNumber, query) {
  const pin = await getActiveMedia(senderNumber);
  if (!pin) return null;
  const fresh = Date.now() - pin.pinnedAt < FRESH_MS;
  if (!fresh && !MEDIA_REFERENCE_RE.test(query || '')) return null; // available but not relevant now
  const media = pin.media;
  if (media.kind === 'image' && media.r2Url) {
    try {
      return { ...media, dataUri: await resolveImageDataUri(media.r2Url, media.mime) };
    } catch (e) {
      console.error('[media] resolve image failed:', e.message);
      return null;
    }
  }
  return media; // pdf/doc carry their text inline
}

// Build the user message content for OpenClaw, attaching pinned media if present:
//  - image -> multimodal [text, image_url(dataUri)]  (OpenClaw vision)
//  - pdf/doc -> text with the extracted document appended
//  - none -> plain string
function buildUserContent(prompt, media) {
  if (media && media.kind === 'image' && media.dataUri) {
    return [
      { type: 'text', text: prompt || 'Please look at the attached image.' },
      { type: 'image_url', image_url: { url: media.dataUri } },
    ];
  }
  if (media && (media.kind === 'pdf' || media.kind === 'doc') && media.text) {
    return `${prompt}\n\n[Attached ${media.kind.toUpperCase()} the user shared${media.truncated ? ' (truncated)' : ''}]:\n${media.text}`;
  }
  return prompt;
}

const OPENCLAW_URL = process.env.OPENCLAW_URL;
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN;
const OPENCLAW_TIMEOUT_MS = 90 * 1000; // agent runs can take many seconds
const TZ = 'Asia/Kolkata'; // WareOnGo is India

// "03:53 pm" IST for a given Date — used to render bot-owned reminder times.
// (The agent's notion of "now" comes from OpenClaw natively via
// agents.defaults.userTimezone=Asia/Kolkata — the bot does NOT inject current time.)
function istTime(date) {
  return new Date(date).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}
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
async function askOpenClaw(prompt, userId, agent = 'main', history = [], media = null, extraContext = '') {
  // Give the agent the current time + the user's id so it can compute reminder
  // timing ("in 3h", "at 5pm") and emit a [[REMINDER|minutes=..|text=..]] directive.
  // `extraContext` carries dynamic per-turn state (e.g. the user's open task list).
  // Note: current date/time is injected by OpenClaw itself (userTimezone=Asia/Kolkata),
  // so the bot does NOT send it. We only pass who the user is + bot-owned context.
  const systemContext =
    `You are talking to WhatsApp user ${userId}.` +
    (extraContext ? `\n\n${extraContext}` : '');
  // We send the conversation history ourselves (bot-owned memory) and DO NOT pass the
  // OpenAI `user` field — so OpenClaw uses ONLY the messages we provide. This avoids its
  // fragile Codex session continuity (resets on restart) and any cross-user session bleed.
  const resp = await axios.post(
    `${OPENCLAW_URL}/v1/chat/completions`,
    {
      model: `openclaw/${agent}`,
      messages: [
        { role: 'system', content: systemContext },
        ...history,
        { role: 'user', content: buildUserContent(prompt, media) },
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

// Core: run one query against `agent`, handle PA front-door routing + reminders, and
// reply (split across messages if long). Fire-and-forget — caller already 200'd Twilio.
// Used both by the /bot|/content prefix path and the sticky-session path.
async function runAgentQuery({ to, from, query, agent }) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // Reply goes FROM the bot's number (inbound `To`) back TO the rep (inbound `From`).
  const reply = (text) => client.messages.create({ from: to, to: from, body: text });

  if (!query || query.toLowerCase() === 'help') {
    await reply(
      "Hi, I'm Ramesh — your WareOnGo assistant. Just message me here. I can:\n" +
      '• set reminders & take notes\n' +
      '• answer warehouse / ops questions\n' +
      '• draft posts & marketing content (LinkedIn, X, blog, and more)\n' +
      '• clean up CSV/Excel files — just send one\n\n' +
      "You can keep chatting normally — send 'stop' to switch back to warehouse submissions."
    );
    return;
  }

  try {
    const senderNumber = (from || '').replace('whatsapp:', '').trim();
    // Bot-owned memory: only the PA ("main") carries conversation history. Specialist
    // one-shots (/content) run statelessly.
    const useHistory = agent === 'main';
    const history = useHistory ? await getHistory(senderNumber) : [];
    // Pinned attachment (image/PDF/doc) for this user — attached when fresh or referenced.
    // Image bytes are pulled from R2 and base64'd here (only transiently in RAM).
    const media = await resolvePinnedMedia(senderNumber, query);

    // Per-user "what's pending" (PA only): inject open TASKS + pending REMINDERS so the
    // agent can answer "what do I have left" completely. Tasks = standing to-dos;
    // reminders = timed to-dos (shown for awareness; the poller actually fires them).
    const openTasks = useHistory ? await getOpenTasks(senderNumber) : [];
    const pendingReminders = useHistory ? await getPendingReminders(senderNumber) : [];
    let tasksContext = '';
    if (useHistory) {
      tasksContext = formatTasksForContext(openTasks);
      if (pendingReminders.length) {
        tasksContext += '\n\nPending reminders (timed; I will ping them automatically) — ' +
          'cancel by number with [[REMINDER_CANCEL|n]] or all with [[REMINDER_CANCEL|all]]:\n' +
          pendingReminders.map((r, i) => `${i + 1}. "${r.text}" at ${istTime(r.dueAt)} IST`).join('\n');
      }
    }

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
      answer = await askOpenClaw(query, senderNumber, agentNow, history, media, tasksContext);
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

    // Apply + strip directives, in order. New reminders first (create), then control
    // actions (cancel reminders / clear tasks / clear chat), then task add/done.
    const afterReminders = await handleAgentReply({ agentText: answer, to, from });
    let contextCleared = false;
    let text = afterReminders;
    if (useHistory) {
      const ctrl = await handleControlDirectives(text, senderNumber, pendingReminders);
      text = ctrl.text; contextCleared = ctrl.contextCleared;
      text = await handleTaskDirectives(text, senderNumber, openTasks);
    }
    await sendReply(reply, text);
    // Persist the exchange so memory survives restarts (PA only) — UNLESS the user asked
    // to clear context (then we start fresh: don't re-save this turn).
    if (useHistory && !contextCleared) await appendExchange(senderNumber, query, text);
  } catch (err) {
    console.error('[openclaw] agent query failed:', err.response?.status, err.message);
    await reply('Sorry — I couldn’t reach the assistant just now. Please try again in a moment.');
  }
}

// Prefix path: parse `/bot ...` or `/content ...` and run it. Returns the resolved
// agent so the caller (webhook) can start/refresh the sticky session for it.
async function handleBotCommandAsync({ to, from, body }) {
  const parsed = parseCommand(body);
  const { agent, query } = parsed || { agent: 'main', query: '' };
  await runAgentQuery({ to, from, query, agent });
  return agent;
}

// Send a WhatsApp message via Twilio REST (for out-of-band notices like voice/cleanup
// results). `to`/`from` are the inbound To/From. Pass mediaUrl to attach a file (e.g. a
// cleaned CSV hosted on R2).
function sendWhatsApp(to, from, text, mediaUrl) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const msg = { from: to, to: from, body: text };
  if (mediaUrl) msg.mediaUrl = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
  return client.messages.create(msg);
}

module.exports = { isBotCommand, parseCommand, handleBotCommandAsync, runAgentQuery, sendWhatsApp, chunkText };
