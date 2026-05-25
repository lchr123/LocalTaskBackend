import { z } from 'zod';

/**
 * UUID v4 regex pattern for validating ID fields.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zod schema for validating the POST /reviews request body.
 *
 * Validates:
 * - taskId: valid UUID format
 * - revieweeId: valid UUID format
 * - rating: integer between 1 and 5
 * - comment: optional string, max 500 characters
 *
 * Validates: Requirements 5.1, 5.4, 5.7, 9.4
 */
export const createReviewSchema = z.object({
  taskId: z
    .string({ error: 'taskIdは必須です' })
    .regex(UUID_REGEX, 'taskIdは有効なUUID形式である必要があります'),

  revieweeId: z
    .string({ error: 'revieweeIdは必須です' })
    .regex(UUID_REGEX, 'revieweeIdは有効なUUID形式である必要があります'),

  rating: z
    .number({ error: '評価は数値である必要があります' })
    .int('評価は整数である必要があります')
    .min(1, '評価は1以上である必要があります')
    .max(5, '評価は5以下である必要があります'),

  comment: z
    .string()
    .max(500, 'コメントは500文字以下である必要があります')
    .optional(),
});

/**
 * TypeScript type inferred from the schema.
 */
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
