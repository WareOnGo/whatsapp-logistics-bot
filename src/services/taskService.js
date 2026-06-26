// Per-user task list / scratchpad.
//
// Standing to-dos the assistant manages — separate from timed Reminders. The agent sees
// the user's open tasks (injected into its context) and mutates them via directives in its
// reply, which the bot parses and applies:
//   [[TASK_ADD|buy packing tape]]   -> add a task
//   [[TASK_DONE|2]]                 -> complete the 2nd open task (as numbered in context)
// DB-backed + isolated per sender (FK to VerifiedNumber).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MAX_OPEN = 50; // safety cap on open tasks shown/kept per user

const ADD_RE = /\[\[TASK_ADD\|([^\]]+)\]\]/gi;
const DONE_RE = /\[\[TASK_DONE\|(\d+)\]\]/gi;

// Open tasks, oldest first (so display numbering is stable within a turn).
async function getOpenTasks(senderNumber) {
  try {
    return await prisma.task.findMany({
      where: { senderNumber, done: false },
      orderBy: { createdAt: 'asc' },
      take: MAX_OPEN,
    });
  } catch (err) {
    console.error('[task] getOpenTasks failed:', err.message);
    return [];
  }
}

// A short context block listing the user's open tasks, for the agent to read.
function formatTasksForContext(tasks) {
  if (!tasks.length) return 'The user has no open tasks.';
  return 'The user\'s open tasks (refer to these numbers):\n' +
    tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
}

// Parse + apply TASK directives from the agent reply. Returns the cleaned text.
// `openTasks` is the same ordered list injected into context, so [[TASK_DONE|n]] maps right.
async function handleTaskDirectives(text, senderNumber, openTasks) {
  const adds = [];
  const dones = [];
  const cleaned = (text || '')
    .replace(ADD_RE, (_m, t) => { if (t.trim()) adds.push(t.trim()); return ''; })
    .replace(DONE_RE, (_m, n) => { dones.push(parseInt(n, 10)); return ''; })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  for (const t of adds) {
    try { await prisma.task.create({ data: { senderNumber, text: t } }); }
    catch (err) { console.error('[task] add failed:', err.message); }
  }
  for (const n of dones) {
    const task = openTasks[n - 1];
    if (!task) continue;
    try { await prisma.task.update({ where: { id: task.id }, data: { done: true, doneAt: new Date() } }); }
    catch (err) { console.error('[task] complete failed:', err.message); }
  }
  return cleaned;
}

// Mark all open tasks done (for "clear my tasks"). Returns count cleared.
async function clearAllTasks(senderNumber) {
  try {
    const r = await prisma.task.updateMany({
      where: { senderNumber, done: false },
      data: { done: true, doneAt: new Date() },
    });
    return r.count;
  } catch (err) { console.error('[task] clearAll failed:', err.message); return 0; }
}

module.exports = { getOpenTasks, formatTasksForContext, handleTaskDirectives, clearAllTasks };
