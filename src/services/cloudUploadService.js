// ============================================================
// Cloud Upload Service — Unified Cloudinary + ImageKit Interface
// ============================================================
// Uses Cloudinary for images (avatars, logos) and ImageKit for
// documents (resumes, PDFs, proofs). Falls back to local disk
// storage if cloud credentials are not configured.
// ============================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── Lazy-loaded cloud clients (only initialize when credentials exist) ──
let cloudinaryClient = null;
let imagekitClient = null;

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');

// Ensure local upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Initialize Cloudinary ──
function getCloudinary() {
  if (cloudinaryClient) return cloudinaryClient;

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return null;
  }

  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true,
    });
    cloudinaryClient = cloudinary;
    console.log('[CloudUpload] Cloudinary initialized successfully');
    return cloudinaryClient;
  } catch (err) {
    console.warn('[CloudUpload] Failed to initialize Cloudinary:', err.message);
    return null;
  }
}

// ── Initialize ImageKit ──
function getImageKit() {
  if (imagekitClient) return imagekitClient;

  const { IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } = process.env;
  if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) {
    return null;
  }

  try {
    const ImageKit = require('@imagekit/nodejs').default || require('@imagekit/nodejs');
    imagekitClient = new ImageKit({
      publicKey: IMAGEKIT_PUBLIC_KEY,
      privateKey: IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    });
    console.log('[CloudUpload] ImageKit initialized successfully');
    return imagekitClient;
  } catch (err) {
    console.warn('[CloudUpload] Failed to initialize ImageKit:', err.message);
    return null;
  }
}

// ── Utility: Extract base64 data from a data URL ──
function parseBase64DataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = dataUrl.match(/^data:([a-zA-Z0-9_\-+./]+);base64,([\s\S]+)$/);
  if (!match || match.length < 3) return null;

  const mimeType = match[1];
  const base64Clean = match[2].replace(/\s/g, '');

  return {
    mimeType,
    base64Data: base64Clean,
    buffer: Buffer.from(base64Clean, 'base64'),
    extension: getExtensionFromMime(mimeType),
  };
}

// ── Utility: Get file extension from MIME type ──
function getExtensionFromMime(mimeType) {
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/csv': 'csv',
    'text/plain': 'txt',
  };
  return mimeMap[mimeType] || mimeType.split('/')[1] || 'bin';
}

// ── Utility: Check if a string is a base64 data URL ──
function isBase64DataUrl(str) {
  return typeof str === 'string' && str.startsWith('data:') && str.includes(';base64,');
}

// ── Utility: Check if a string is an image mime ──
function isImageMime(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

// ── Local fallback: save file to disk ──
function saveToLocal(parsed, filenamePrefix = 'file') {
  const uniqueId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${filenamePrefix}_${uniqueId}.${parsed.extension}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(filePath, parsed.buffer);
  console.log(`[CloudUpload] Saved locally: ${filePath}`);

  // Return a relative URL that Express static middleware can serve
  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;
  return {
    url: `${baseUrl}/uploads/${filename}`,
    publicId: filename,
    provider: 'local',
  };
}

// ============================================================
// UPLOAD IMAGE → Cloudinary (with local fallback)
// ============================================================
// Accepts: base64 data URL string, or { buffer, originalname, mimetype }
// Options: { folder: 'hcm/avatars', filenamePrefix: 'avatar' }
// Returns: { url, publicId, provider }
// ============================================================
async function uploadImage(input, options = {}) {
  const { folder = 'hcm/images', filenamePrefix = 'image' } = options;

  // Parse input
  let parsed;
  if (typeof input === 'string') {
    parsed = parseBase64DataUrl(input);
    if (!parsed) {
      // It's already a URL — return as-is
      return { url: input, publicId: null, provider: 'existing' };
    }
  } else if (input && input.buffer) {
    // Multer file object
    parsed = {
      buffer: input.buffer,
      mimeType: input.mimetype,
      extension: getExtensionFromMime(input.mimetype),
      base64Data: input.buffer.toString('base64'),
    };
  } else {
    throw new Error('Invalid input for uploadImage');
  }

  // Try Cloudinary
  const cloudinary = getCloudinary();
  if (cloudinary) {
    try {
      const result = await cloudinary.uploader.upload(
        `data:${parsed.mimeType};base64,${parsed.base64Data}`,
        {
          folder,
          resource_type: 'image',
          transformation: [
            { quality: 'auto', fetch_format: 'auto' },
          ],
        }
      );

      console.log(`[CloudUpload] Image uploaded to Cloudinary: ${result.secure_url}`);
      return {
        url: result.secure_url,
        publicId: result.public_id,
        provider: 'cloudinary',
      };
    } catch (err) {
      console.error('[CloudUpload] Cloudinary upload failed, falling back to local:', err.message);
    }
  }

  // Fallback to local
  return saveToLocal(parsed, filenamePrefix);
}

// ============================================================
// UPLOAD DOCUMENT → ImageKit (with local fallback)
// ============================================================
// Accepts: base64 data URL string, or { buffer, originalname, mimetype }
// Options: { folder: 'hcm/resumes', filenamePrefix: 'resume' }
// Returns: { url, fileId, provider }
// ============================================================
async function uploadDocument(input, options = {}) {
  const { folder = 'hcm/documents', filenamePrefix = 'document' } = options;

  // Parse input
  let parsed;
  let originalName = `${filenamePrefix}.bin`;

  if (typeof input === 'string') {
    parsed = parseBase64DataUrl(input);
    if (!parsed) {
      // It's already a URL — return as-is
      return { url: input, fileId: null, provider: 'existing' };
    }
    originalName = `${filenamePrefix}.${parsed.extension}`;
  } else if (input && input.buffer) {
    // Multer file object
    parsed = {
      buffer: input.buffer,
      mimeType: input.mimetype,
      extension: getExtensionFromMime(input.mimetype),
      base64Data: input.buffer.toString('base64'),
    };
    originalName = input.originalname || originalName;
  } else {
    throw new Error('Invalid input for uploadDocument');
  }

  // Try ImageKit
  const imagekit = getImageKit();
  if (imagekit) {
    try {
      const result = await imagekit.upload({
        file: parsed.base64Data, // base64 string (without data: prefix)
        fileName: originalName,
        folder,
        useUniqueFileName: true,
      });

      console.log(`[CloudUpload] Document uploaded to ImageKit: ${result.url}`);
      return {
        url: result.url,
        fileId: result.fileId,
        provider: 'imagekit',
      };
    } catch (err) {
      console.error('[CloudUpload] ImageKit upload failed, falling back to local:', err.message);
    }
  }

  // Fallback to local
  const localResult = saveToLocal(parsed, filenamePrefix);
  return { url: localResult.url, fileId: localResult.publicId, provider: 'local' };
}

// ============================================================
// SMART UPLOAD — Auto-detect image vs document
// ============================================================
async function smartUpload(input, options = {}) {
  let mimeType = options.mimeType;

  if (!mimeType && typeof input === 'string') {
    const parsed = parseBase64DataUrl(input);
    mimeType = parsed?.mimeType;
  } else if (!mimeType && input?.mimetype) {
    mimeType = input.mimetype;
  }

  if (mimeType && isImageMime(mimeType)) {
    return uploadImage(input, options);
  }
  return uploadDocument(input, options);
}

// ============================================================
// DELETE IMAGE → Cloudinary
// ============================================================
async function deleteImage(publicId) {
  if (!publicId) return false;

  const cloudinary = getCloudinary();
  if (cloudinary) {
    try {
      await cloudinary.uploader.destroy(publicId);
      console.log(`[CloudUpload] Deleted from Cloudinary: ${publicId}`);
      return true;
    } catch (err) {
      console.error('[CloudUpload] Failed to delete from Cloudinary:', err.message);
      return false;
    }
  }

  // Try local deletion
  const localPath = path.join(UPLOAD_DIR, publicId);
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
    return true;
  }
  return false;
}

// ============================================================
// DELETE DOCUMENT → ImageKit
// ============================================================
async function deleteDocument(fileId) {
  if (!fileId) return false;

  const imagekit = getImageKit();
  if (imagekit) {
    try {
      await imagekit.deleteFile(fileId);
      console.log(`[CloudUpload] Deleted from ImageKit: ${fileId}`);
      return true;
    } catch (err) {
      console.error('[CloudUpload] Failed to delete from ImageKit:', err.message);
      return false;
    }
  }

  // Try local deletion
  const localPath = path.join(UPLOAD_DIR, fileId);
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
    return true;
  }
  return false;
}

// ============================================================
// HANDLE BASE64 FIELD — drop-in replacement for old inline handler
// ============================================================
// Use this in controllers where base64 was previously handled inline.
// If value is a base64 data URL, uploads it and returns the cloud URL.
// If value is already a URL or null, returns it as-is.
// ============================================================
async function handleBase64Field(value, fallbackUrl, options = {}) {
  if (!value || typeof value !== 'string') {
    return fallbackUrl !== undefined ? fallbackUrl : null;
  }

  if (isBase64DataUrl(value)) {
    const result = await smartUpload(value, options);
    return result.url;
  }

  // It's already a URL string
  return value;
}

module.exports = {
  uploadImage,
  uploadDocument,
  smartUpload,
  deleteImage,
  deleteDocument,
  handleBase64Field,
  isBase64DataUrl,
  parseBase64DataUrl,
};
