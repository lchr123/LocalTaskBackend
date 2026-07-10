import { z } from 'zod';

/**
 * Zod schema for validating the CreateTaskPayload request body.
 *
 * Validates:
 * - type: non-empty string (no DB constraint, frontend controls valid values)
 * - description: string between 10 and 500 characters
 * - location: object with address, latitude (-90 to 90), longitude (-180 to 180)
 * - reward: integer between 1000 and 99999
 * - deadline: ISO 8601 datetime string that must be in the future
 *
 * Validates: Requirements 2.6, 2.7
 */
export const createTaskSchema = z.object({
  // Domain discriminator: 'task' (周边任务/工作, default) or 'marketplace' (二手市场).
  kind: z.enum(['task', 'marketplace']).default('task'),

  type: z.string({ error: 'タスクタイプは必須です' }).min(1, 'タスクタイプは必須です'),

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
    .int('報酬は整数である必要があります')
    .min(0, '報酬は0以上である必要があります')
    .max(100000000, '報酬は100000000以下である必要があります'),

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

  // --- New optional fields (migration 012) ---
  rewardUnit: z.enum(['once', 'hour', 'day', 'month']).nullish(),

  images: z.array(z.string()).max(9, '最多上传9张图片').optional(),

  headcount: z.coerce.number().int().min(1).max(999).optional(),

  startTime: z
    .string()
    .refine((val) => !isNaN(new Date(val).getTime()), { message: '开始时间格式无效' })
    .nullish(),

  contactMethod: z.string().max(100, '联系方式不能超过100字符').nullish(),

  durationHours: z.coerce.number().positive().max(999.9).nullish(),

  durationUnit: z.enum(['once', 'day', 'week', 'month']).nullish(),

  posterMemo: z.string().max(1000, '备注不能超过1000字符').nullish(),

  tagIds: z.array(z.string()).max(20, '标签过多').optional(),
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
  // Domain discriminator: 'task' (周边任务/工作, default) or 'marketplace' (二手市场).
  kind: z.enum(['task', 'marketplace']).default('task'),

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
    .max(100, '検索半径は100km以下である必要があります')
    .default(100),

  type: z.string().optional(),

  minReward: z
    .coerce
    .number()
    .min(0, '最低報酬は0以上である必要があります')
    .optional(),

  maxReward: z
    .coerce
    .number()
    .max(100000000, '最高報酬は100000000以下である必要があります')
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

  sort: z
    .enum(['distance', 'reward', 'newest', 'deadline'])
    .default('distance'),

  tags: z.string().optional(),
});

/**
 * TypeScript types inferred from the schemas.
 */
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
