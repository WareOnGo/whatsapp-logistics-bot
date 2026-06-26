// R2 cleanup — deletes old assistant attachments so the bucket doesn't grow forever.
//
// Assistant images are uploaded under the "assistant-media/" prefix (see storageService),
// so we can expire ONLY those and never touch warehouse photos (which have no prefix).
// We can't set an R2 bucket lifecycle rule via the object-scoped token (AccessDenied), so
// the bot runs this on a daily interval instead. (If you later add a lifecycle rule in the
// Cloudflare R2 dashboard for prefix "assistant-media/", you can drop this job.)

const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const PREFIX = 'assistant-media/';
const MAX_AGE_DAYS = 7;
const RUN_EVERY_MS = 24 * 60 * 60 * 1000;

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
}

async function cleanupOldAssistantMedia(maxAgeDays = MAX_AGE_DAYS) {
  const s3 = client();
  const Bucket = process.env.R2_BUCKET_NAME;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let token, deleted = 0;
  try {
    do {
      const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIX, ContinuationToken: token }));
      const old = (list.Contents || []).filter((o) => o.LastModified && o.LastModified.getTime() < cutoff);
      for (let i = 0; i < old.length; i += 1000) {
        const batch = old.slice(i, i + 1000).map((o) => ({ Key: o.Key }));
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch, Quiet: true } }));
        deleted += batch.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    if (deleted) console.log(`[cleanup] removed ${deleted} assistant media object(s) older than ${maxAgeDays}d`);
  } catch (err) {
    console.error('[cleanup] R2 cleanup failed:', err.message);
  }
  return deleted;
}

let timer = null;
function startCleanupScheduler() {
  if (timer) return timer;
  cleanupOldAssistantMedia().catch(() => {});
  timer = setInterval(() => cleanupOldAssistantMedia().catch(() => {}), RUN_EVERY_MS);
  if (timer.unref) timer.unref();
  console.log('[cleanup] R2 cleanup scheduler started');
  return timer;
}

module.exports = { cleanupOldAssistantMedia, startCleanupScheduler };
