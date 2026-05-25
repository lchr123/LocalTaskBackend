import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { uploadRateLimiter } from '../middleware/rateLimiter';
import * as uploadService from '../services/uploadService';
import { AuthenticatedRequest } from '../types/common';
import { AppError } from '../utils/errors';

const router = Router();

/**
 * Configure multer for in-memory file storage.
 * Max file size is set to 10MB at the multer level (the service layer
 * enforces the stricter 5MB limit with a proper error response).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB at multer level; service enforces 5MB
  },
});

/**
 * POST /upload/image
 * Upload an image file. Requires authentication.
 * Accepts multipart/form-data with a single file field named 'image'.
 * Uses uploadRateLimiter (5 req/min/user).
 *
 * Returns: { url: string }
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6
 */
router.post(
  '/image',
  authMiddleware as any,
  uploadRateLimiter,
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      if (!req.file) {
        throw new AppError(422, 'validation_error', 'ファイルが必要です');
      }

      const file: uploadService.UploadedFile = {
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
        size: req.file.size,
      };

      const url = await uploadService.uploadImage(file);
      res.status(200).json({ url });
    } catch (err) {
      next(err);
    }
  }
);

export { router as uploadController };
