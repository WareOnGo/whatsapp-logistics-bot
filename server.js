require('dotenv').config();
const app = require('./src/app');
const { startReminderScheduler } = require('./src/services/reminderService');
const { startCleanupScheduler } = require('./src/services/cleanupService');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Fire due reminders on boot (catches any that came due during downtime) and poll.
  startReminderScheduler();
  // Daily R2 cleanup of old assistant attachments.
  startCleanupScheduler();
});
