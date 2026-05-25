import { z } from 'zod';

/**
 * UUID v4 format regex for validating helper IDs and other UUID fields.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zod schema for validating the submit intent request body (POST /tasks/:id/intents).
 *
 * Validates:
 * - message: optional string, max 200 characters
 *
 * Validates: Requirements 3.1, 3.2
 */
export const submitIntentSchema = z.object({
  message: z
    .string()
    .max(200, 'メッセージは200文字以下である必要があります')
    .optional(),
});

/**
 * Zod schema for validating the select helper request body (POST /tasks/:id/select-helper).
 *
 * Validates:
 * - helperId: required UUID format string
 *
 * Validates: Requirements 3.7
 */
export const selectHelperSchema = z.object({
  helperId: z
    .string({ error: 'ヘルパーIDは必須です' })
    .regex(UUID_REGEX, 'ヘルパーIDは有効なUUID形式である必要があります'),
});

/**
 * Zod schema for validating UUID path parameters (task ID, intent ID).
 */
export const intentParamsSchema = z.object({
  id: z
    .string()
    .regex(UUID_REGEX, 'タスクIDは有効なUUID形式である必要があります'),
});

/**
 * Zod schema for validating intent ID path parameter.
 */
export const intentIdParamsSchema = z.object({
  id: z
    .string()
    .regex(UUID_REGEX, 'タスクIDは有効なUUID形式である必要があります'),
  intentId: z
    .string()
    .regex(UUID_REGEX, '意向IDは有効なUUID形式である必要があります'),
});

/**
 * TypeScript types inferred from the schemas.
 */
export type SubmitIntentInput = z.infer<typeof submitIntentSchema>;
export type SelectHelperInput = z.infer<typeof selectHelperSchema>;
