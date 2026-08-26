require('dotenv').config();
const app = require('./src/app');
const prisma = require('./src/lib/prisma');
const { closePool } = require('./src/services/dbReadService');
const { startReminderScheduler } = require('./src/services/reminderService');
const { startCleanupScheduler } = require('./src/services/cleanupService');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Fire due reminders on boot (catches any that came due during downtime) and poll.
  startReminderScheduler();
  // Daily R2 cleanup of old assistant attachments.
  startCleanupScheduler();
});

// Graceful shutdown. Without this, a redeploy leaves the old process's DB
// connections open on the Supabase pooler until it reaps them server-side — so
// old and new instances briefly stack, doubling the connection footprint.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing server and DB connections`);

  // Stop accepting new requests, then drain.
  await new Promise((resolve) => server.close(resolve));

  await Promise.allSettled([
    prisma.$disconnect(),
    closePool(),
  ]);

  console.log('[shutdown] done');
  process.exit(0);
}

// Hard cap: if draining stalls, exit anyway rather than hanging the deploy.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    setTimeout(() => {
      console.error('[shutdown] timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
    shutdown(sig).catch((e) => {
      console.error('[shutdown] failed:', e.message);
      process.exit(1);
    });
  });
}
