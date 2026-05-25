/**
 * Upload Service - Handles image upload to AWS S3.
 *
 * Business rules:
 * - Only JPEG and PNG formats are accepted
 * - Maximum file size: 5MB
 * - File naming: UUID + original extension, stored under `uploads/` prefix
 * - Sets Content-Type (image/jpeg or image/png) and Cache-Control headers
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const s3Client = new S3Client({
  region: config.s3.region,
});

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Upload an image file to S3.
 *
 * Validates format (JPEG/PNG) and size (≤5MB), generates a unique filename,
 * uploads to S3 under the `uploads/` prefix with appropriate headers.
 *
 * @param file - The uploaded file object from multer
 * @returns The publicly accessible URL of the uploaded image
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6
 */
export async function uploadImage(file: UploadedFile): Promise<string> {
  // Validate file format
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    throw new AppError(422, 'invalid_file_type', '仅支持 JPEG 和 PNG 格式');
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new AppError(413, 'file_too_large', '文件大小不能超过 5MB');
  }

  // Generate unique filename: UUID + original extension
  const ext = path.extname(file.originalname).toLowerCase() || ALLOWED_MIME_TYPES[file.mimetype];
  const uniqueFilename = `${uuidv4()}${ext}`;
  const key = `uploads/${uniqueFilename}`;

  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: 'public, max-age=31536000',
  });

  await s3Client.send(command);

  // Construct the accessible URL
  const url = `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;

  logger.info('Image uploaded successfully', {
    key,
    size: file.size,
    contentType: file.mimetype,
  });

  return url;
}
