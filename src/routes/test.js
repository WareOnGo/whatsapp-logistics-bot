// routes/test.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadMediaBuffer } = require('../services/storageService');

// Configure multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

// Define the test route. upload.single('mediaFile') is the middleware that handles the file.
router.post('/upload', upload.single('mediaFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file was uploaded.');
    }

    // Call the new service function with the file's buffer and mimetype
    const permanentUrl = await uploadMediaBuffer(req.file.buffer, req.file.mimetype);

    res.status(200).json({ 
      message: 'File uploaded to Cloudflare R2 successfully!', 
      url: permanentUrl 
    });

  } catch (error) {
    // If this fails, it's likely due to incorrect .env variables for R2
    res.status(500).json({ 
      message: 'Upload failed.', 
      error: error.message 
    });
  }
});

module.exports = router;