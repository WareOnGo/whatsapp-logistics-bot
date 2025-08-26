// services/storageService.js

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');

// Configure the S3 client to connect to Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true, // <-- ADD THIS LINE
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadMediaFromUrl(mediaUrl, contentType) {
  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });
    const fileBuffer = response.data;
    const fileExtension = contentType.split('/')[1] || 'bin';
    const fileName = `media_${Date.now()}.${fileExtension}`;
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

async function uploadMediaBuffer(fileBuffer, contentType) {
  try {
    const fileExtension = contentType.split('/')[1] || 'bin';
    const fileName = `test_upload_${Date.now()}.${fileExtension}`;
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
    console.error('Error in storage service (buffer upload):', error.message);
    throw new Error('Failed to upload media buffer to storage.');
  }
}

module.exports = { uploadMediaFromUrl, uploadMediaBuffer };