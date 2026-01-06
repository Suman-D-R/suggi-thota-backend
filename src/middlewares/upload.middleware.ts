// File upload middleware
import multer from 'multer';
import multerS3 from 'multer-s3';
import { Request, Response, NextFunction } from 'express';
import { s3, s3Config } from '../config/aws';
import { envConfig } from '../config/env';
// Lazy import logger to avoid circular dependency
let logger: any;
const getLogger = () => {
  if (!logger) {
    logger = require('../utils/logger').logger;
  }
  return logger;
};
import path from 'path';

// File filter function
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  try {
    // Check file type
    if (!envConfig.ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      const error = new Error(`Invalid file type. Allowed types: ${envConfig.ALLOWED_FILE_TYPES.join(', ')}`) as any;
      error.code = 'INVALID_FILE_TYPE';
      return cb(error);
    }

    // Check file size (additional check beyond multer limits)
    if (file.size && file.size > envConfig.MAX_FILE_SIZE) {
      const error = new Error(`File too large. Maximum size: ${envConfig.MAX_FILE_SIZE / (1024 * 1024)}MB`) as any;
      error.code = 'FILE_TOO_LARGE';
      return cb(error);
    }

    cb(null, true);
  } catch (error) {
    getLogger().error('File filter error:', error);
    cb(new Error('File validation failed'));
  }
};

// Storage configuration for local development (fallback)
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const basename = path.basename(file.originalname, extension);
    cb(null, `${basename}-${uniqueSuffix}${extension}`);
  },
});

// S3 storage configuration for AWS SDK v3
const s3Storage = multerS3({
  s3: s3,
  bucket: s3Config.bucketName,
  // ACL removed - bucket doesn't allow ACLs
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const basename = path.basename(file.originalname, extension);
    const filename = `${basename}-${uniqueSuffix}${extension}`;
    const folder = req.uploadFolder || 'uploads';
    cb(null, `${folder}/${filename}`);
  },
  contentType: multerS3.AUTO_CONTENT_TYPE,
});

// Choose storage based on environment
const storage = envConfig.AWS_ACCESS_KEY_ID ? s3Storage : localStorage;

// General upload middleware
export const upload = multer({
  storage,
  limits: {
    fileSize: envConfig.MAX_FILE_SIZE,
    files: 5, // Maximum 5 files per request
  },
  fileFilter,
});

// Single file upload
export const uploadSingle = (fieldName: string, folder?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (folder) {
      (req as any).uploadFolder = folder;
    }
    const uploadSingle = multer({
      storage,
      limits: { fileSize: envConfig.MAX_FILE_SIZE, files: 1 },
      fileFilter,
    }).single(fieldName);

    uploadSingle(req, res, (err) => {
      if (err) {
        getLogger().error('Single file upload error:', err);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
          error: err.code || 'UPLOAD_ERROR',
        });
      }
      next();
    });
  };
};

// Multiple files upload
export const uploadMultiple = (fieldName: string, maxCount: number = 5, folder?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (folder) {
      (req as any).uploadFolder = folder;
    }
    const uploadMultiple = multer({
      storage,
      limits: { fileSize: envConfig.MAX_FILE_SIZE, files: maxCount },
      fileFilter,
    }).array(fieldName, maxCount);

    uploadMultiple(req, res, (err) => {
      if (err) {
        getLogger().error('Multiple files upload error:', err);
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
          error: err.code || 'UPLOAD_ERROR',
        });
      }
      next();
    });
  };
};

// Profile image upload
export const uploadProfileImage = uploadSingle('profileImage', 'profiles');

// Product images upload
export const uploadProductImages = uploadMultiple('images', 5, 'products');

// Category image upload
export const uploadCategoryImage = uploadSingle('image', 'categories');

// Hero banner image upload (store-specific)
export const uploadHeroBannerImage = (req: Request, res: Response, next: NextFunction) => {
  // Create a custom storage that can access storeId from req.body
  // Note: multer processes form fields before files, so req.body should be available
  const customS3Storage = multerS3({
    s3: s3,
    bucket: s3Config.bucketName,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req: any, file, cb) => {
      // Get storeId from body (multer parses form fields before processing files)
      const storeId = (req.body?.storeId || req.query?.storeId) as string | undefined;
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = path.extname(file.originalname);
      const basename = path.basename(file.originalname, extension);
      const filename = `${basename}-${uniqueSuffix}${extension}`;
      
      // Build folder path - include storeId if provided
      const folder = storeId ? `hero-banners/store-${storeId}` : 'hero-banners';
      cb(null, `${folder}/${filename}`);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  });

  const customLocalStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req: any, file, cb) => {
      const storeId = (req.body?.storeId || req.query?.storeId) as string | undefined;
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = path.extname(file.originalname);
      const basename = path.basename(file.originalname, extension);
      const folder = storeId ? `hero-banners/store-${storeId}` : 'hero-banners';
      cb(null, `${folder}-${basename}-${uniqueSuffix}${extension}`);
    },
  });

  // Choose storage based on environment
  const customStorage = envConfig.AWS_ACCESS_KEY_ID ? customS3Storage : customLocalStorage;
  
  const uploadSingle = multer({
    storage: customStorage,
    limits: { fileSize: envConfig.MAX_FILE_SIZE, files: 1 },
    fileFilter,
  }).single('image');

  uploadSingle(req, res, (err) => {
    if (err) {
      getLogger().error('Hero banner image upload error:', err);
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed',
        error: err.code || 'UPLOAD_ERROR',
      });
    }
    next();
  });
};

// Document upload
export const uploadDocument = uploadSingle('document', 'documents');

// Error handler for multer errors
export const handleUploadError = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof multer.MulterError) {
    let message = 'File upload error';
    let statusCode = 400;

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = `File too large. Maximum size: ${envConfig.MAX_FILE_SIZE / (1024 * 1024)}MB`;
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files uploaded';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        break;
      default:
        message = 'File upload failed';
    }

    getLogger().error('Multer error:', error);
    return res.status(statusCode).json({
      success: false,
      message,
      error: error.code,
    });
  }

  if (error.code === 'INVALID_FILE_TYPE' || error.code === 'FILE_TOO_LARGE') {
    getLogger().error('Upload validation error:', error);
    return res.status(400).json({
      success: false,
      message: error.message,
      error: error.code,
    });
  }

  next(error);
};

// Extend Express Request interface for upload folder
declare global {
  namespace Express {
    interface Request {
      uploadFolder?: string;
    }
  }
}

// Legacy uploadMiddleware for backward compatibility
export const uploadMiddleware = upload;

// Upload middleware object
export const uploadMiddlewares = {
  upload,
  uploadSingle,
  uploadMultiple,
  uploadProfileImage,
  uploadProductImages,
  uploadCategoryImage,
  uploadHeroBannerImage,
  uploadDocument,
  handleUploadError,
  uploadMiddleware, // Legacy export
};

