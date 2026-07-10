/**
 * Weekly Digest Service
 *
 * Builds and sends a weekly email to opted-in users summarising the number of
 * new tasks posted last week plus a few highlights. Sends via the Resend HTTP
 * API. Idempotent per ISO week (weekly_digest_runs.week_start UNIQUE).
 */

import crypto from 'crypto';
import { query } from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const TASK_TYPE_LABELS: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  one_time: '单次任务',
};

const REWARD_UNIT_LABELS: Record<string, string> = { once: '次', hour: '小时', day: '日', month: '月' };

export interface DigestHighlight {
  id: string;
  type: string;
  description: string;
  reward: number;
  reward_unit: string | null;
}

export interface RunDigestOptions {
  /** Compute and return stats without sending or recording. */
  dryRun?: boolean;
  /** Send only to this address (for testing); skips idempotency + DB recipients. */
  testEmail?: string;
}

/** Number of daily buckets recipients are spread across (one per weekday). */
export const DIGEST_BUCKETS = 7;

/**
 * Rolling reporting window relative to the send day: the trailing 7 days ending
 * at 00:00 JST of the run day. e.g. a Tuesday run covers
 * [last Tuesday 00:00 JST, this Tuesday 00:00 JST).
 *
 * `runDate` (the JST calendar date of the run) is used as the per-day
 * idempotency key so the daily job is safe against double triggers.
 */
export function getRollingWindow(now = new Date()): { start: Date; end: Date; runDate: string } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  // 00:00 JST of the run day, expressed back in UTC.
  const endUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS;
  const end = new Date(endUtc);
  const start = new Date(endUtc - 7 * 24 * 60 * 60 * 1000);
  const runDate = new Date(end.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  return { start, end, runDate };
}

/**
 * Today's recipient bucket (0..6), derived from the JST weekday of the run day.
 * Each user is deterministically assigned to a bucket via md5(user_id) % 7, so
 * exactly ~1/7 of opted-in users are emailed each day and every user receives
 * the digest once per week on a stable weekday.
 */
export function getTodaysBucket(now = new Date()): number {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.getUTCDay(); // 0=Sun..6=Sat on the JST clock
}

/** Build an HMAC-signed unsubscribe token: `${userId}.${sig}`. */
export function makeUnsubscribeToken(userId: string): string {
  const sig = crypto
    .createHmac('sha256', config.digest.unsubscribeSecret)
    .update(userId)
    .digest('hex')
    .slice(0, 32);
  return `${userId}.${sig}`;
}

/** Verify an unsubscribe token; returns the userId if valid, else null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', config.digest.unsubscribeSecret)
    .update(userId)
    .digest('hex')
    .slice(0, 32);
  if (sig.length !== expected.length) return null;
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return userId;
  } catch {
    return null;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDigestHtml(params: {
  newCount: number;
  highlights: DigestHighlight[];
  unsubscribeToken: string;
}): string {
  const { newCount, highlights, unsubscribeToken } = params;
  const unsubUrl = `${config.digest.apiUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const items = highlights
    .map((h) => {
      const typeLabel = TASK_TYPE_LABELS[h.type] || h.type;
      const desc = escapeHtml(h.description.slice(0, 40)) + (h.description.length > 40 ? '…' : '');
      const unit = h.reward_unit ? ` / ${REWARD_UNIT_LABELS[h.reward_unit] || h.reward_unit}` : '';
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="font-size:12px;color:#1565C0;">${escapeHtml(typeLabel)}</div>
            <div style="font-size:14px;color:#333;margin:4px 0;">${desc}</div>
            <div style="font-size:15px;color:#E65100;font-weight:600;">¥${h.reward.toLocaleString()}${unit}</div>
          </td>
        </tr>`;
    })
    .join('');

  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#333;">
    <h2 style="color:#1976D2;margin:0 0 2px;">LocallyHelper · 在日同城互助任务</h2>
    <p style="font-size:13px;color:#888;margin:0 0 16px;">灵活接单，赚取外快</p>
    <p style="font-size:15px;line-height:1.6;">
      上周新增了 <strong style="color:#E65100;">${newCount}</strong> 个可接任务，按报酬精选了几个，挑个顺手的接了吧 💪
    </p>
    ${
      highlights.length > 0
        ? `<p style="font-size:14px;color:#666;margin-top:20px;font-weight:600;">本周高薪任务：</p>
           <table style="width:100%;border-collapse:collapse;">${items}</table>`
        : ''
    }
    <p style="margin-top:24px;">
      <a href="${config.digest.appUrl}" style="display:inline-block;background:#1976D2;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">打开 App 接单</a>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="font-size:12px;color:#999;line-height:1.5;">
      LocallyHelper —— 在日本，灵活接单赚外快。<br/>
      如不想再收到此类邮件，请点击<a href="${unsubUrl}" style="color:#999;">退订</a>。
    </p>
  </div>`;
}

/**
 * Send a batch of emails via the Resend HTTP API (up to 100 per call).
 * Returns the number of successfully accepted emails.
 */
async function sendResendBatch(
  emails: { from: string; to: string; subject: string; html: string }[]
): Promise<number> {
  if (emails.length === 0) return 0;
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emails),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend batch failed: ${res.status} ${text}`);
  }
  return emails.length;
}

/**
 * Run the daily slice of the digest.
 *
 * Recipients are spread across 7 daily buckets (md5(user_id) % 7). Each run
 * emails only today's bucket, and the content window is the trailing 7 days
 * ending at 00:00 JST of the run day, so every recipient gets exactly their
 * own "past week" relative to their send day.
 *
 * Idempotent per run day (weekly_digest_runs.week_start stores the run date)
 * unless dryRun/testEmail.
 */
export async function runWeeklyDigest(options: RunDigestOptions = {}): Promise<{
  skipped?: boolean;
  dryRun?: boolean;
  runDate: string;
  bucket: number;
  newTaskCount: number;
  highlightCount: number;
  recipientCount: number;
  sentCount?: number;
  failedCount?: number;
}> {
  if (!config.resend.apiKey && !options.dryRun) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const { start, end, runDate } = getRollingWindow();
  const bucket = getTodaysBucket();
  const isRealRun = !options.dryRun && !options.testEmail;

  // Idempotency: reserve this run day first (prevents double sends on retrigger)
  if (isRealRun) {
    const reserve = await query(
      `INSERT INTO weekly_digest_runs (week_start, status) VALUES ($1, 'running')
       ON CONFLICT (week_start) DO NOTHING RETURNING id`,
      [runDate]
    );
    if (reserve.rows.length === 0) {
      logger.info('Digest already processed for run date', { runDate });
      return { skipped: true, runDate, bucket, newTaskCount: 0, highlightCount: 0, recipientCount: 0 };
    }
  }

  // New task count: created last week AND currently still open (matches highlights)
  const countRes = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM tasks
     WHERE created_at >= $1 AND created_at < $2 AND status = 'open'`,
    [start, end]
  );
  const newTaskCount = countRes.rows[0]?.c ?? 0;

  // Top 5 highlights: highest reward open tasks created last week
  const highlightsRes = await query<DigestHighlight>(
    `SELECT id, type, description, reward, reward_unit
     FROM tasks
     WHERE created_at >= $1 AND created_at < $2 AND status = 'open'
     ORDER BY reward DESC NULLS LAST, created_at DESC
     LIMIT 3`,
    [start, end]
  );
  const highlights = highlightsRes.rows;

  // Recipients — only today's bucket (md5(id) % 7 == bucket), so the list is
  // spread evenly across the week and never exceeds ~1/7 of all opted-in users.
  let recipients: { id: string; email: string }[];
  if (options.testEmail) {
    recipients = [{ id: 'test-user', email: options.testEmail }];
  } else {
    const r = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users
       WHERE email_opt_in = true AND email IS NOT NULL AND email <> ''
         AND (get_byte(decode(md5(id::text), 'hex'), 0) % $1) = $2`,
      [DIGEST_BUCKETS, bucket]
    );
    recipients = r.rows;
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      runDate,
      bucket,
      newTaskCount,
      highlightCount: highlights.length,
      recipientCount: recipients.length,
    };
  }

  const subject = `LocallyHelper 互助任务周报 · 近一周新增 ${newTaskCount} 个可接任务`;

  // Send in batches of 100
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const emails = chunk.map((rcpt) => ({
      from: config.resend.fromEmail,
      to: rcpt.email,
      subject,
      html: renderDigestHtml({
        newCount: newTaskCount,
        highlights,
        unsubscribeToken: makeUnsubscribeToken(rcpt.id),
      }),
    }));
    try {
      sent += await sendResendBatch(emails);
    } catch (err) {
      failed += chunk.length;
      logger.error('Weekly digest batch send failed', {
        batchStart: i,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  if (isRealRun) {
    await query(
      `UPDATE weekly_digest_runs
       SET recipient_count = $2, sent_count = $3, failed_count = $4,
           new_task_count = $5, status = 'completed'
       WHERE week_start = $1`,
      [runDate, recipients.length, sent, failed, newTaskCount]
    );
  }

  logger.info('Digest sent', { runDate, bucket, newTaskCount, recipients: recipients.length, sent, failed });

  return {
    runDate,
    bucket,
    newTaskCount,
    highlightCount: highlights.length,
    recipientCount: recipients.length,
    sentCount: sent,
    failedCount: failed,
  };
}

/** Set a user's marketing opt-in flag (used by the unsubscribe endpoint). */
export async function setEmailOptIn(userId: string, optIn: boolean): Promise<boolean> {
  const res = await query(`UPDATE users SET email_opt_in = $2 WHERE id = $1 RETURNING id`, [userId, optIn]);
  return res.rows.length > 0;
}
