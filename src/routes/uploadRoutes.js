// ============================================================
// Upload Routes  →  /api/upload/*
// ============================================================
// Generic file upload endpoints. Frontend uploads files here
// and gets back cloud/local URLs to store in form payloads.
// ============================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middlewares/authMiddleware');
const { uploadImage, uploadDocument, smartUpload } = require('../services/cloudUploadService');

// Use memory storage — we'll stream to cloud providers
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// All upload routes require authentication
router.use(protect);

// ── POST /api/upload/image ──
// Uploads an image to Cloudinary (or local fallback)
// Expects: multipart/form-data with field name "file"
// Optional query param: ?folder=hcm/avatars
router.post('/image', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
    }

    const folder = req.query.folder || 'hcm/images';
    const result = await uploadImage(req.file, { folder, filenamePrefix: 'img' });

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        publicId: result.publicId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/document ──
// Uploads a document to ImageKit (or local fallback)
// Expects: multipart/form-data with field name "file"
// Optional query param: ?folder=hcm/resumes
router.post('/document', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
    }

    const folder = req.query.folder || 'hcm/documents';
    const result = await uploadDocument(req.file, { folder, filenamePrefix: 'doc' });

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileId: result.fileId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/auto ──
// Auto-detect: image → Cloudinary, document → ImageKit
// Expects: multipart/form-data with field name "file"
router.post('/auto', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
    }

    const folder = req.query.folder || 'hcm/uploads';
    const result = await smartUpload(req.file, { folder, filenamePrefix: 'upload' });

    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        publicId: result.publicId || result.fileId,
        fileId: result.fileId || result.publicId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
