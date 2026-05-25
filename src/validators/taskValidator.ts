import { z } from 'zod';

/**
 * Valid task type enum values.
 */
const TASK_TYPES = ['delivery', 'shopping', 'dog_walking', 'queuing', 'pickup'] as const;

/**
 * Zod schema for validating the CreateTaskPayload request body.
 *
 * Validates:
 * - type: must be one of the allowed TaskType enum values
 * - description: string between 10 and 500 characters
 * - location: object with address, latitude (-90 to 90), longitude (-180 to 180)
 * - reward: number between 0.01 and 99999.99
 * - deadline: ISO 8601 datetime string that must be in the future
 *
 * Validates: Requirements 2.6, 2.7
 */
export const createTaskSchema = z.object({
  type: z.enum(TASK_TYPES, {
    error: 'タスクタイプは delivery, shopping, dog_walking, queuing, pickup のいずれかである必要があります',
  }),

  description: z
    .string({ error: '説明は文字列である必要があります' })
    .min(10, '説明は10文字以上である必要があります')
    .max(500, '説明は500文字以下である必要があります'),

  location: z.object({
    address: z
      .string({ error: '住所は文字列である必要があります' })
      .min(1, '住所は必須です'),

    latitude: z
      .number({ error: '緯度は数値である必要があります' })
      .min(-90, '緯度は-90以上である必要があります')
      .max(90, '緯度は90以下である必要があります'),

    longitude: z
      .number({ error: '経度は数値である必要があります' })
      .min(-180, '経度は-180以上である必要があります')
      .max(180, '経度は180以下である必要があります'),
  }),

  reward: z
    .number({ error: '報酬は数値である必要があります' })
    .min(0.01, '報酬は0.01以上である必要があります')
    .max(99999.99, '報酬は99999.99以下である必要があります'),

  deadline: z
    .string({ error: '締切はISO 8601形式の日時文字列である必要があります' })
    .refine(
      (val) => {
        const date = new Date(val);
        return !isNaN(date.getTime());
      },
      { message: '締切は有効なISO 8601形式の日時である必要があります' }
    )
    .refine(
      (val) => {
        const date = new Date(val);
        return date.getTime() > Date.now();
      },
      { message: '締切は現在時刻より後である必要があります' }
    ),
});

/**
 * Zod schema for validating task query parameters (GET /tasks).
 *
 * Required:
 * - lat: latitude of the user's position (-90 to 90)
 * - lng: longitude of the user's position (-180 to 180)
 *
 * Optional with defaults:
 * - radius: search radius in km (default 10, max 50)
 * - type: filter by task type
 * - minReward: minimum reward filter
 * - maxReward: maximum reward filter
 * - page: page number (default 1, min 1)
 * - pageSize: items per page (default 20, min 1, max 50)
 *
 * Validates: Requirements 2.6, 2.7
 */
export const taskQuerySchema = z.object({
  lat: z
    .coerce
    .number({ error: '緯度(lat)は必須の数値パラメータです' })
    .min(-90, '緯度は-90以上である必要があります')
    .max(90, '緯度は90以下である必要があります'),

  lng: z
    .coerce
    .number({ error: '経度(lng)は必須の数値パラメータです' })
    .min(-180, '経度は-180以上である必要があります')
    .max(180, '経度は180以下である必要があります'),

  radius: z
    .coerce
    .number()
    .min(0.1, '検索半径は0.1km以上である必要があります')
    .max(50, '検索半径は50km以下である必要があります')
    .default(10),

  type: z.enum(TASK_TYPES).optional(),

  minReward: z
    .coerce
    .number()
    .min(0, '最低報酬は0以上である必要があります')
    .optional(),

  maxReward: z
    .coerce
    .number()
    .max(99999.99, '最高報酬は99999.99以下である必要があります')
    .optional(),

  page: z
    .coerce
    .number()
    .int()
    .min(1)
    .default(1),

  pageSize: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20),
});

/**
 * TypeScript types inferred from the schemas.
 */
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
