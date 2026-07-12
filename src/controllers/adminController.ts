/**
 * Admin Controller
 *
 * Provides admin-only endpoints:
 * - POST /admin/login — authenticate admin
 * - GET /admin/users — list all users
 * - GET /admin/tasks — list all tasks
 * - PATCH /admin/tasks/:id/status — force update task status
 * - GET /admin/reports — list all reports
 * - PATCH /admin/reports/:id — handle a report (resolve/dismiss)
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { query } from '../config/database';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { getPresignedUrl } from '../services/uploadService';
import { scrapeXhsPost } from '../services/xhsScraperService';
import { downloadAndReuploadImages, structureWithOpenAI } from '../services/marketplaceDraftService';
import { createTaskSchema } from '../validators/taskValidator';
import * as taskService from '../services/taskService';

const router = Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_JWT_SECRET = 'locally_helper_admin_2026';

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * POST /admin/login
 * Authenticate with username/password, return JWT.
 */
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'unauthorized', message: '用户名或密码错误' });
    return;
  }

  const token = jwt.sign(
    { username, role: 'admin' },
    ADMIN_JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.status(200).json({ token, expiresIn: '24h' });
});

// ─── Protected Routes (require admin JWT) ────────────────────────────────────

router.use(adminAuthMiddleware as any);

/**
 * GET /admin/users
 * List all users with basic info.
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let whereStr = '';
    let countWhereStr = '';

    if (search) {
      whereStr = `WHERE u.cognito_sub::text ILIKE $3`;
      countWhereStr = `WHERE u.cognito_sub::text ILIKE $1`;
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [usersResult, countResult] = await Promise.all([
      query(
        `SELECT id, cognito_sub, email, phone, nickname, avatar_url, average_rating,
                birthday, gender, address, bio, email_opt_in,
                (SELECT COUNT(*) FROM tasks t WHERE t.selected_helper_id = u.id AND t.status = 'completed')::int AS completed_task_count,
                created_at, updated_at
         FROM users u ${whereStr} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(`SELECT COUNT(*) AS count FROM users u ${countWhereStr}`, countParams),
    ]);

    res.status(200).json({
      users: usersResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/tasks
 * List all tasks with filtering by status.
 */
router.get('/tasks', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions dynamically
    const whereClauses: string[] = [];
    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let listParamIndex = 3;
    let countParamIndex = 1;

    if (status) {
      whereClauses.push(`t.status = $${listParamIndex}`);
      listParams.push(status);
      countParams.push(status);
      listParamIndex++;
      countParamIndex++;
    }

    if (search) {
      whereClauses.push(`t.id::text ILIKE $${listParamIndex}`);
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
      listParamIndex++;
      countParamIndex++;
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    // Rebuild WHERE for count query with $1, $2... numbering
    const countWhereClauses: string[] = [];
    let ci = 1;
    if (status) { countWhereClauses.push(`t.status = $${ci}`); ci++; }
    if (search) { countWhereClauses.push(`t.id::text ILIKE $${ci}`); ci++; }
    const countWhereStr = countWhereClauses.length > 0 ? `WHERE ${countWhereClauses.join(' AND ')}` : '';

    const [tasksResult, countResult] = await Promise.all([
      query(
        `SELECT t.id, t.poster_id, u.nickname AS poster_nickname, u.email AS poster_email,
                t.type, t.description, t.location_address,
                ST_Y(t.location::geometry) AS latitude,
                ST_X(t.location::geometry) AS longitude,
                t.reward, t.reward_unit, t.deadline,
                t.status, t.intent_count, t.selected_helper_id,
                t.images, t.headcount, t.start_time, t.contact_method,
                t.duration_hours, t.duration_unit, t.poster_memo,
                t.created_at, t.updated_at
         FROM tasks t
         JOIN users u ON t.poster_id = u.id
         ${whereStr}
         ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(
        `SELECT COUNT(*) AS count FROM tasks t ${countWhereStr}`,
        countParams
      ),
    ]);

    // Presign task images so the admin panel can display private objects
    const tasks = await Promise.all(
      tasksResult.rows.map(async (t: any) => ({
        ...t,
        images: Array.isArray(t.images) && t.images.length > 0
          ? await Promise.all(t.images.map((url: string) => getPresignedUrl(url)))
          : [],
      }))
    );

    res.status(200).json({
      tasks,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/tasks/:id/status
 * Force update task status (admin override, no state machine check).
 */
router.patch('/tasks/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['open', 'in_progress', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      res.status(422).json({ error: 'validation_error', message: '无效的状态值' });
      return;
    }

    const result = await query(
      `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '任务不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/tasks/:id/type
 * Force update task type (admin override). Used to migrate legacy task types.
 */
router.patch('/tasks/:id/type', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { type } = req.body;

    const validTypes = ['full_time', 'part_time', 'one_time'];
    if (!type || !validTypes.includes(type)) {
      res.status(422).json({ error: 'validation_error', message: '无效的类型值' });
      return;
    }

    const result = await query(
      `UPDATE tasks SET type = $1, updated_at = NOW() WHERE id = $2 RETURNING id, type`,
      [type, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '任务不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/reports
 * List all reports with pagination.
 */
router.get('/reports', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * pageSize;

    const conditions = status ? `WHERE r.status = $${3}` : '';
    const countConditions = status ? 'WHERE r.status = $1' : '';
    const params: any[] = [pageSize, offset];
    if (status) params.push(status);

    const [reportsResult, countResult] = await Promise.all([
      query(
        `SELECT r.*, u.nickname AS reporter_nickname, u.email AS reporter_email
         FROM reports r
         JOIN users u ON r.reporter_id = u.id
         ${conditions}
         ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
        params
      ),
      query(
        `SELECT COUNT(*) AS count FROM reports r ${countConditions}`,
        status ? [status] : []
      ),
    ]);

    res.status(200).json({
      reports: reportsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/reports/:id
 * Update report status (resolve or dismiss).
 */
router.patch('/reports/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    const validStatuses = ['submitted', 'reviewing', 'resolved'];
    if (!status || !validStatuses.includes(status)) {
      res.status(422).json({ error: 'validation_error', message: '无效的状态值' });
      return;
    }

    const setClauses = ['status = $1'];
    const values: any[] = [status, id];

    if (adminNote) {
      setClauses.push(`admin_note = $${values.length + 1}`);
      values.push(adminNote);
    }

    const result = await query(
      `UPDATE reports SET ${setClauses.join(', ')} WHERE id = $${values.indexOf(id) + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '举报记录不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/chats
 * List all chat sessions with participant info.
 */
router.get('/chats', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let whereStr = '';
    let countWhereStr = '';

    if (search) {
      whereStr = `WHERE poster_u.cognito_sub::text ILIKE $3`;
      countWhereStr = `WHERE poster_u.cognito_sub::text ILIKE $1`;
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [chatsResult, countResult] = await Promise.all([
      query(
        `SELECT cs.id, cs.task_id,
                poster_u.cognito_sub AS poster_cognito_sub,
                helper_u.cognito_sub AS helper_cognito_sub,
                cs.created_at
         FROM chat_sessions cs
         JOIN users poster_u ON cs.poster_id = poster_u.id
         JOIN users helper_u ON cs.helper_id = helper_u.id
         ${whereStr}
         ORDER BY cs.last_message_time DESC
         LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(
        `SELECT COUNT(*) AS count FROM chat_sessions cs
         JOIN users poster_u ON cs.poster_id = poster_u.id
         ${countWhereStr}`,
        countParams
      ),
    ]);

    res.status(200).json({
      chats: chatsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/reviews
 * List all reviews with participant cognito subs.
 */
router.get('/reviews', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    const [reviewsResult, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.task_id, r.rating, r.comment, r.created_at,
                reviewer_u.cognito_sub AS reviewer_cognito_sub,
                reviewee_u.cognito_sub AS reviewee_cognito_sub
         FROM reviews r
         JOIN users reviewer_u ON r.reviewer_id = reviewer_u.id
         JOIN users reviewee_u ON r.reviewee_id = reviewee_u.id
         ORDER BY r.created_at DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      ),
      query('SELECT COUNT(*) AS count FROM reviews'),
    ]);

    res.status(200).json({
      reviews: reviewsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/chats/:id/messages
 * List all messages in a chat session, ordered by time ascending.
 */
router.get('/chats/:id/messages', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT m.id, m.sender_id, u.nickname AS sender_nickname, u.cognito_sub AS sender_cognito_sub,
              m.content, m.type, m.image_url, m.timestamp
       FROM chat_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.session_id = $1
       ORDER BY m.timestamp ASC`,
      [id]
    );

    // Presign image URLs
    const s3Client = new S3Client({ region: config.s3.region });
    const messages = await Promise.all(
      result.rows.map(async (m: any) => {
        if (m.type === 'image' && m.image_url) {
          try {
            // Extract S3 key from the URL
            const url = new URL(m.image_url);
            const key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
            const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
            m.image_url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
          } catch {
            // Keep original URL if presigning fails
          }
        }
        return m;
      })
    );

    res.status(200).json({ messages });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users/:id/ban
 * Ban a user. Body: { reason, expiresAt? (ISO string, null for permanent) }
 */
router.post('/users/:id/ban', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason, expiresAt } = req.body;

    if (!reason) {
      res.status(422).json({ error: 'validation_error', message: '请提供封禁原因' });
      return;
    }

    const result = await query(
      `INSERT INTO user_bans (user_id, reason, banned_by, expires_at)
       VALUES ($1, $2, 'admin', $3)
       RETURNING *`,
      [id, reason, expiresAt || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users/:id/unban
 * Unban a user (deactivate all active bans).
 */
router.post('/users/:id/unban', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE user_bans SET is_active = false, unbanned_at = NOW()
       WHERE user_id = $1 AND is_active = true`,
      [id]
    );

    res.status(200).json({ message: '已解封' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/users/:id/bans
 * Get ban history for a user.
 */
router.get('/users/:id/bans', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM user_bans WHERE user_id = $1 ORDER BY banned_at DESC`,
      [id]
    );

    res.status(200).json({ bans: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/users/:id/email-opt-in
 * Update a user's marketing email opt-in flag (weekly digest subscription).
 * Body: { emailOptIn: boolean }
 */
router.patch('/users/:id/email-opt-in', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { emailOptIn } = req.body;

    if (typeof emailOptIn !== 'boolean') {
      res.status(422).json({ error: 'validation_error', message: 'emailOptIn 必须为布尔值' });
      return;
    }

    const result = await query(
      `UPDATE users SET email_opt_in = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email_opt_in`,
      [emailOptIn, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '用户不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/bans
 * List all bans with user info, supports filtering by is_active.
 */
router.get('/bans', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const activeFilter = req.query.active as string | undefined;
    const offset = (page - 1) * pageSize;

    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let whereStr = '';
    let countWhereStr = '';

    if (activeFilter === 'true' || activeFilter === 'false') {
      const isActive = activeFilter === 'true';
      whereStr = `WHERE b.is_active = $3`;
      countWhereStr = `WHERE b.is_active = $1`;
      listParams.push(isActive);
      countParams.push(isActive);
    }

    const [bansResult, countResult] = await Promise.all([
      query(
        `SELECT b.*, u.nickname, u.cognito_sub
         FROM user_bans b
         JOIN users u ON b.user_id = u.id
         ${whereStr}
         ORDER BY b.banned_at DESC
         LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(
        `SELECT COUNT(*) AS count FROM user_bans b ${countWhereStr}`,
        countParams
      ),
    ]);

    res.status(200).json({
      bans: bansResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Tag dictionary management (task_tags & helper_tags) ─────────────────────

/**
 * Resolve the tag table + junction table from a `kind` query/body value.
 * Uses an allowlist so the table name is never taken from raw user input.
 */
function resolveTagTables(kind: unknown): { tagTable: string; junction: string } | null {
  if (kind === 'task') return { tagTable: 'task_tags', junction: 'task_task_tags' };
  if (kind === 'helper') return { tagTable: 'helper_tags', junction: 'user_helper_tags' };
  return null;
}

/**
 * GET /admin/tags?kind=task|helper
 * List the full tag dictionary with usage counts.
 */
router.get('/tags', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tables = resolveTagTables(req.query.kind);
    if (!tables) {
      res.status(422).json({ error: 'validation_error', message: '无效的标签类型' });
      return;
    }
    const result = await query(
      `SELECT t.id, t.name, t.label_zh, t.category, t.created_at,
              COUNT(j.tag_id)::int AS usage_count
       FROM ${tables.tagTable} t
       LEFT JOIN ${tables.junction} j ON j.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.category NULLS LAST, t.label_zh`,
      []
    );
    res.status(200).json({ tags: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/tags?kind=task|helper
 * Create a new tag. Body: { name, label_zh, category? }
 */
router.post('/tags', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tables = resolveTagTables(req.query.kind);
    if (!tables) {
      res.status(422).json({ error: 'validation_error', message: '无效的标签类型' });
      return;
    }
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const labelZh = typeof req.body.label_zh === 'string' ? req.body.label_zh.trim() : '';
    const category =
      typeof req.body.category === 'string' && req.body.category.trim() !== ''
        ? req.body.category.trim()
        : null;

    if (!name || name.length > 50) {
      res.status(422).json({ error: 'validation_error', message: 'name 必填且不超过50字符' });
      return;
    }
    if (!labelZh || labelZh.length > 50) {
      res.status(422).json({ error: 'validation_error', message: 'label_zh 必填且不超过50字符' });
      return;
    }
    if (category && category.length > 30) {
      res.status(422).json({ error: 'validation_error', message: 'category 不超过30字符' });
      return;
    }

    const result = await query(
      `INSERT INTO ${tables.tagTable} (name, label_zh, category)
       VALUES ($1, $2, $3)
       RETURNING id, name, label_zh, category, created_at`,
      [name, labelZh, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'conflict', message: 'name 已存在' });
      return;
    }
    next(err);
  }
});

/**
 * PATCH /admin/tags/:id?kind=task|helper
 * Update a tag. Body: { name?, label_zh?, category? }
 */
router.patch('/tags/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tables = resolveTagTables(req.query.kind);
    if (!tables) {
      res.status(422).json({ error: 'validation_error', message: '无效的标签类型' });
      return;
    }
    const { id } = req.params;

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 50) {
        res.status(422).json({ error: 'validation_error', message: 'name 不合法' });
        return;
      }
      updates.push(`name = $${idx++}`);
      params.push(name);
    }
    if (typeof req.body.label_zh === 'string') {
      const labelZh = req.body.label_zh.trim();
      if (!labelZh || labelZh.length > 50) {
        res.status(422).json({ error: 'validation_error', message: 'label_zh 不合法' });
        return;
      }
      updates.push(`label_zh = $${idx++}`);
      params.push(labelZh);
    }
    if ('category' in req.body) {
      const category =
        typeof req.body.category === 'string' && req.body.category.trim() !== ''
          ? req.body.category.trim()
          : null;
      if (category && category.length > 30) {
        res.status(422).json({ error: 'validation_error', message: 'category 不合法' });
        return;
      }
      updates.push(`category = $${idx++}`);
      params.push(category);
    }

    if (updates.length === 0) {
      res.status(422).json({ error: 'validation_error', message: '没有需要更新的字段' });
      return;
    }

    params.push(id);
    const result = await query(
      `UPDATE ${tables.tagTable} SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id, name, label_zh, category, created_at`,
      params
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '标签不存在' });
      return;
    }
    res.status(200).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'conflict', message: 'name 已存在' });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /admin/tags/:id?kind=task|helper
 * Delete a tag. Junction rows are removed automatically (ON DELETE CASCADE).
 */
router.delete('/tags/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tables = resolveTagTables(req.query.kind);
    if (!tables) {
      res.status(422).json({ error: 'validation_error', message: '无效的标签类型' });
      return;
    }
    const { id } = req.params;
    const result = await query(
      `DELETE FROM ${tables.tagTable} WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '标签不存在' });
      return;
    }
    res.status(200).json({ id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

// ─── Marketplace draft from a Xiaohongshu (小红书) post ─────────────────────

/**
 * POST /admin/marketplace-draft/scrape
 * Body: { url: string }  — a xiaohongshu.com post URL.
 *
 * Pipeline: scrape the post (headless-Chromium Lambda) -> re-upload its
 * images to our own S3 -> ask OpenAI to structure the text into
 * type/description/reward/contactMethod. Returns a DRAFT only — nothing is
 * persisted here. The admin reviews/edits the draft in the UI, then submits
 * it through the normal POST /tasks flow (kind='marketplace').
 *
 * Best-effort by design: OpenAI failures fall back to raw text, individual
 * image download failures are skipped — a partial draft is still useful for
 * the admin to finish by hand. Only a total scrape failure (no text AND no
 * images) is treated as a hard error.
 */
router.post('/marketplace-draft/scrape', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
    if (!url) {
      res.status(422).json({ error: 'validation_error', message: '请提供小红书笔记链接' });
      return;
    }

    const scraped = await scrapeXhsPost(url);

    const [images, structured] = await Promise.all([
      downloadAndReuploadImages(scraped.images),
      structureWithOpenAI(scraped.text || scraped.title || ''),
    ]);

    res.status(200).json({
      draft: {
        type: structured.type,
        description: structured.description,
        reward: structured.reward,
        contactMethod: structured.contactMethod,
        images,
      },
      source: {
        url: scraped.url,
        authorName: scraped.authorName,
        rawTitle: scraped.title,
        rawText: scraped.text,
        imageCount: scraped.images.length,
        reuploadedImageCount: images.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/marketplace-draft/publish
 * Body: the reviewed/edited draft fields (same shape as CreateTaskPayload,
 * minus poster — the admin has no Cognito identity of its own).
 *
 * Publishes under config.marketplace.officialPosterUserId (a real app user
 * account dedicated to admin-sourced listings — see config/index.ts). Runs
 * the SAME createTaskSchema validation as the public POST /tasks endpoint,
 * so an AI-generated draft can never bypass normal task validation.
 */
router.post('/marketplace-draft/publish', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!config.marketplace.officialPosterUserId) {
      res.status(500).json({
        error: 'not_configured',
        message: '未配置 MARKETPLACE_OFFICIAL_USER_ID，无法发布',
      });
      return;
    }

    const payload = { ...req.body, kind: 'marketplace' as const };
    const result = createTaskSchema.safeParse(payload);

    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_root';
        if (!fields[key]) fields[key] = issue.message;
      }
      res.status(422).json({
        error: 'validation_error',
        message: Object.values(fields)[0] || '校验失败',
        fields,
      });
      return;
    }

    const task = await taskService.createTask(config.marketplace.officialPosterUserId, result.data);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

export { router as adminController };
