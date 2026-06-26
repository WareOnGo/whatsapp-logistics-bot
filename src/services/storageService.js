// services/storageService.js

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

// Configure the S3 client to connect to Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// opts.keyPrefix lets callers segregate objects in the shared bucket — e.g. assistant
// attachments use "assistant-media/" so an R2 lifecycle rule can expire ONLY those,
// leaving warehouse photos (no prefix) untouched.
async function uploadMediaFromUrl(mediaUrl, contentType, opts = {}) {
  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });
    const fileBuffer = response.data;
    const fileExtension = (contentType.split('/')[1] || 'bin').split(';')[0];
    const rand = Math.random().toString(36).slice(2, 10);
    const fileName = `${opts.keyPrefix || ''}media_${Date.now()}_${rand}.${fileExtension}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );
    const permanentUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;
    return permanentUrl;
  } catch (error) {
    console.error('Error in storage service (URL upload):', error.message);
    throw new Error('Failed to upload media from URL.');
  }
}

/**
 * Classifies a list of media URLs into the { images, videos, docs } structure
 * based on file extension embedded in the R2 URL.
 */
function buildMediaJson(urls) {
  const media = { images: [], videos: [], docs: [] };

  const imageExts = new Set(['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'svg+xml', 'tiff', 'heic', 'heif', 'avif']);
  const videoExts = new Set(['mp4', 'mpeg', 'webm', 'ogg', 'quicktime', 'mov', 'avi', 'mkv', '3gpp']);

  for (const url of urls) {
    const ext = (url.split('.').pop() || '').toLowerCase();
    if (imageExts.has(ext)) {
      media.images.push(url);
    } else if (videoExts.has(ext)) {
      media.videos.push(url);
    } else {
      media.docs.push(url);
    }
  }

  return media;
}

// Upload an in-memory buffer (e.g. a cleaned CSV) and return its public URL.
async function uploadBuffer(buffer, fileName, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${process.env.R2_PUBLIC_URL}/${fileName}`;
}

module.exports = { uploadMediaFromUrl, uploadBuffer, buildMediaJson };