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

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
export type UploadFolder = 'avatars' | 'chats' | 'tasks';

/**
 * Upload an image file to S3.
 *
 * @param file - The uploaded file object from multer
 * @param folder - The S3 prefix folder ('avatars' or 'chats')
 * @returns The accessible URL of the uploaded image
 */
export async function uploadImage(file: UploadedFile, folder: UploadFolder = 'chats'): Promise<string> {
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
  const key = `${folder}/${uniqueFilename}`;

  // Upload to S3 (no ACL - use bucket policy for public access on avatars/)
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
    folder,
    size: file.size,
    contentType: file.mimetype,
  });

  return url;
}

/**
 * Generate a presigned URL for an S3 object given its full URL.
 * The presigned URL is valid for 1 hour (3600 seconds).
 *
 * @param imageUrl - The full S3 URL (e.g., https://bucket.s3.region.amazonaws.com/uploads/uuid.jpg)
 * @returns A presigned URL that allows temporary read access
 */
export async function getPresignedUrl(imageUrl: string): Promise<string> {
  // Extract the key from the full S3 URL
  const bucketPrefix = `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/`;
  if (!imageUrl.startsWith(bucketPrefix)) {
    // Not an S3 URL from our bucket, return as-is
    return imageUrl;
  }

  const key = imageUrl.slice(bucketPrefix.length);

  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return presignedUrl;
}

/**
 * Extract the S3 object key from a (clean or presigned) bucket URL.
 * Returns null if the URL is not from our bucket.
 */
export function extractKeyFromUrl(url: string): string | null {
  const clean = url.split('?')[0];
  const prefix = `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/`;
  if (!clean.startsWith(prefix)) return null;
  return clean.slice(prefix.length);
}

/**
 * List all objects under a given prefix (paginated).
 */
export async function listObjectsByPrefix(
  prefix: string
): Promise<{ key: string; lastModified: Date }[]> {
  const out: { key: string; lastModified: Date }[] = [];
  let token: string | undefined;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) {
        out.push({ key: obj.Key, lastModified: obj.LastModified || new Date(0) });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return out;
}

/**
 * Delete S3 objects by key, in batches of 1000 (S3 DeleteObjects limit).
 *
 * SAFETY: only keys under the `tasks/` prefix are ever deleted; any other key
 * is filtered out, so this can never touch avatars/ or chats/.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const safeKeys = keys.filter((k) => k.startsWith('tasks/'));
  if (safeKeys.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < safeKeys.length; i += 1000) {
    const batch = safeKeys.slice(i, i + 1000);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: config.s3.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    deleted += batch.length;
  }
  return deleted;
}
