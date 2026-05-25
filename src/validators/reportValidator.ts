import { z } from 'zod';

/**
 * UUID v4 regex pattern for validating ID fields.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valid report target types.
 */
const TARGET_TYPES = ['user', 'task'] as const;

/**
 * Valid report types.
 */
const REPORT_TYPES = ['fake_task', 'harassment', 'fraud', 'inappropriate_content', 'other'] as const;

/**
 * Zod schema for validating the POST /reports request body.
 *
 * Validates:
 * - targetType: must be 'user' or 'task'
 * - targetId: valid UUID format
 * - type: must be one of the defined report types
 * - description: 1-1000 characters
 * - imageUrls: optional array of strings, max 5 items
 *
 * Validates: Requirements 6.1, 6.2
 */
export const createReportSchema = z.object({
  targetType: z
    .enum(TARGET_TYPES, { message: 'targetTypeはuserまたはtaskである必要があります' }),

  targetId: z
    .string({ error: 'targetIdは必須です' })
    .regex(UUID_REGEX, 'targetIdは有効なUUID形式である必要があります'),

  type: z
    .enum(REPORT_TYPES, { message: '有効な举报タイプを指定してください' }),

  description: z
    .string({ error: '説明は必須です' })
    .min(1, '説明は1文字以上である必要があります')
    .max(1000, '説明は1000文字以下である必要があります'),

  imageUrls: z
    .array(z.string().url('有効なURLを指定してください'))
    .max(5, '最多上传5张图片')
    .optional(),
});

/**
 * TypeScript type inferred from the schema.
 */
export type CreateReportInput = z.infer<typeof createReportSchema>;
