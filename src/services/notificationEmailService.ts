/**
 * Unread Chat Reminder Email Service
 *
 * Scans for users with unread chat messages and sends a reminder email,
 * capped at ONE email per user per 24 hours — guaranteed at the database
 * level, not by application logic, so it holds even under concurrent or
 * retried scans.
 *
 * How the "at most one per 24h" guarantee works:
 * 1. A single transaction SELECTs candidate user rows with
 *    `FOR UPDATE SKIP LOCKED`, filtering on
 *    `last_unread_email_at IS NULL OR last_unread_email_at < now() - 24h`.
 * 2. Still inside that transaction, it immediately UPDATEs those same rows'
 *    `last_unread_email_at = now()` and COMMITs.
 * 3. Only after the claim is committed do we attempt to send email.
 *
 * Because the claim (read + write) happens inside one transaction with row
 * locks, two concurrent scans can never both select the same user: whichever
 * transaction commits first moves that user's timestamp forward, so the
 * other transaction's WHERE clause (re-evaluated per row under
 * MVCC/READ COMMITTED semantics for UPDATE) excludes them. `SKIP LOCKED`
 * additionally lets a second concurrent scan skip past rows already locked
 * by the first, rather than blocking.
 *
 * Send failures are NOT retried within the same day — the claim already
 * happened, so we intentionally prefer "miss a notification" over "spam the
 * user twice". They become eligible again after 24h if still unread.
 *
 * Reuses users.email_opt_in (same flag as the weekly digest) as the
 * notification preference — no separate opt-in column.
 */

import { getClient, query } from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';
import { makeUnsubscribeToken } from './digestService';

export interface UnreadCandidate {
  id: string;
  email: string;
  unreadTotal: number;
  unreadSessions: number;
}

export interface UnreadSessionPreview {
  taskTitle: string;
  participantNickname: string;
  unreadCount: number;
}

export interface RunUnreadRemindersOptions {
  /** Compute and return the candidate count without claiming or sending. */
  dryRun?: boolean;
  /** Send only to this address (for testing); bypasses claiming + DB recipients. */
  testEmail?: string;
  /** Override the default daily cap (mainly for tests). */
  cap?: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Claim up to `cap` users who currently have unread messages in a stale
 * session and have not been reminded in the last 24h. Claiming and reading
 * their per-session unread breakdown happen in the same transaction as the
 * timestamp update, so a claimed user cannot be claimed again by a
 * concurrent/retried scan within the 24h window.
 */
async function claimCandidates(staleMinutes: number, cap: number): Promise<UnreadCandidate[]> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock and claim eligible users first (SKIP LOCKED avoids blocking on rows
    // a concurrent scan already has locked).
    const claimed = await client.query<{ id: string; email: string }>(
      `SELECT id, email
       FROM users
       WHERE email_opt_in = true
         AND email IS NOT NULL AND email <> ''
         AND (last_unread_email_at IS NULL OR last_unread_email_at < NOW() - INTERVAL '24 hours')
         AND EXISTS (
           SELECT 1 FROM chat_sessions cs
           WHERE (cs.poster_id = users.id AND cs.poster_unread > 0)
              OR (cs.helper_id = users.id AND cs.helper_unread > 0)
         )
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [cap]
    );

    if (claimed.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const userIds = claimed.rows.map((r) => r.id);

    // Only consider sessions whose last message is stale enough (gives the
    // recipient time to notice a push notification / open the app first).
    const unreadRes = await client.query<{
      user_id: string;
      unread_total: string;
      unread_sessions: string;
    }>(
      `SELECT
         u.id AS user_id,
         SUM(CASE WHEN cs.poster_id = u.id THEN cs.poster_unread ELSE cs.helper_unread END) AS unread_total,
         COUNT(*) AS unread_sessions
       FROM users u
       JOIN chat_sessions cs ON (cs.poster_id = u.id OR cs.helper_id = u.id)
       WHERE u.id = ANY($1::uuid[])
         AND ((cs.poster_id = u.id AND cs.poster_unread > 0) OR (cs.helper_id = u.id AND cs.helper_unread > 0))
         AND cs.last_message_time < NOW() - ($2 || ' minutes')::interval
       GROUP BY u.id`,
      [userIds, staleMinutes]
    );

    const unreadByUser = new Map(
      unreadRes.rows.map((r) => [r.user_id, { total: Number(r.unread_total), sessions: Number(r.unread_sessions) }])
    );

    // Only claim (advance the timestamp for) users who actually have stale
    // unread messages right now — others stay eligible for a later scan
    // once their message becomes stale, instead of burning their daily slot.
    const toClaim = claimed.rows.filter((r) => unreadByUser.has(r.id));

    if (toClaim.length === 0) {
      await client.query('ROLLBACK');
      return [];
    }

    await client.query(
      `UPDATE users SET last_unread_email_at = NOW() WHERE id = ANY($1::uuid[])`,
      [toClaim.map((r) => r.id)]
    );

    await client.query('COMMIT');

    return toClaim.map((r) => {
      const u = unreadByUser.get(r.id)!;
      return { id: r.id, email: r.email, unreadTotal: u.total, unreadSessions: u.sessions };
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetch a per-session preview (task title + counterpart nickname) for the
 * unread sessions belonging to a single user. Used to render the per-task
 * list in the reminder email (content plan "Option B": no message text).
 */
async function getUnreadSessionPreviews(userId: string): Promise<UnreadSessionPreview[]> {
  const result = await query<{
    task_title: string | null;
    participant_nickname: string;
    unread_count: number;
  }>(
    `SELECT
       COALESCE(LEFT(t.description, 40), '任务') AS task_title,
       CASE WHEN cs.poster_id = $1 THEN helper_u.nickname ELSE poster_u.nickname END AS participant_nickname,
       CASE WHEN cs.poster_id = $1 THEN cs.poster_unread ELSE cs.helper_unread END AS unread_count
     FROM chat_sessions cs
     JOIN users poster_u ON cs.poster_id = poster_u.id
     JOIN users helper_u ON cs.helper_id = helper_u.id
     LEFT JOIN tasks t ON cs.task_id = t.id
     WHERE (cs.poster_id = $1 AND cs.poster_unread > 0) OR (cs.helper_id = $1 AND cs.helper_unread > 0)
     ORDER BY cs.last_message_time DESC
     LIMIT 5`,
    [userId]
  );

  return result.rows.map((r) => ({
    taskTitle: r.task_title || '任务',
    participantNickname: r.participant_nickname || '用户',
    unreadCount: r.unread_count,
  }));
}

/**
 * Render the reminder email HTML. Content plan "Option B": lists which task
 * + counterpart has unread messages, WITHOUT including message text.
 */
function renderUnreadReminderHtml(params: {
  unreadTotal: number;
  sessions: UnreadSessionPreview[];
  unsubscribeToken: string;
}): string {
  const { unreadTotal, sessions, unsubscribeToken } = params;
  const unsubUrl = `${config.digest.apiUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const messagesUrl = `${config.digest.appUrl}/messages`;

  const items = sessions
    .map(
      (s) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="font-size:14px;color:#333;">📋 ${escapeHtml(s.taskTitle)}${
              s.taskTitle.length >= 40 ? '…' : ''
            }</div>
            <div style="font-size:13px;color:#666;margin-top:4px;">
              来自：${escapeHtml(s.participantNickname)} · ${s.unreadCount} 条未读
            </div>
          </td>
        </tr>`
    )
    .join('');

  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#333;">
    <h2 style="color:#1976D2;margin:0 0 2px;">LocallyHelper</h2>
    <p style="font-size:15px;line-height:1.6;">
      你有 <strong style="color:#E65100;">${unreadTotal}</strong> 条未读消息，以下任务有新消息等你查看：
    </p>
    <table style="width:100%;border-collapse:collapse;">${items}</table>
    <p style="margin-top:24px;">
      <a href="${messagesUrl}" style="display:inline-block;background:#1976D2;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">打开消息</a>
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
 * Run one scan for unread-message reminder emails.
 *
 * Safe to call as often as desired (e.g. every 30 minutes) — the 24h claim
 * guarantees each user receives at most one such email per day regardless of
 * scan frequency or concurrent/retried invocations.
 */
export async function runUnreadReminders(options: RunUnreadRemindersOptions = {}): Promise<{
  dryRun?: boolean;
  candidateCount: number;
  sentCount?: number;
  failedCount?: number;
}> {
  if (!config.resend.apiKey && !options.dryRun) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const cap = options.cap ?? config.unreadReminder.dailyCap;

  if (options.testEmail) {
    if (options.dryRun) {
      return { dryRun: true, candidateCount: 1 };
    }
    const html = renderUnreadReminderHtml({
      unreadTotal: 1,
      sessions: [{ taskTitle: '测试任务', participantNickname: '测试用户', unreadCount: 1 }],
      unsubscribeToken: makeUnsubscribeToken('test-user'),
    });
    const sent = await sendResendBatch([
      { from: config.resend.fromEmail, to: options.testEmail, subject: 'LocallyHelper · 你有未读消息', html },
    ]);
    return { candidateCount: 1, sentCount: sent, failedCount: 1 - sent };
  }

  if (options.dryRun) {
    // Dry run: count candidates WITHOUT claiming (no timestamp mutation).
    const result = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
       FROM users u
       WHERE u.email_opt_in = true AND u.email IS NOT NULL AND u.email <> ''
         AND (u.last_unread_email_at IS NULL OR u.last_unread_email_at < NOW() - INTERVAL '24 hours')
         AND EXISTS (
           SELECT 1 FROM chat_sessions cs
           WHERE ((cs.poster_id = u.id AND cs.poster_unread > 0) OR (cs.helper_id = u.id AND cs.helper_unread > 0))
             AND cs.last_message_time < NOW() - ($1 || ' minutes')::interval
         )`,
      [config.unreadReminder.staleMinutes]
    );
    return { dryRun: true, candidateCount: result.rows[0]?.c ?? 0 };
  }

  const candidates = await claimCandidates(config.unreadReminder.staleMinutes, cap);

  if (candidates.length === 0) {
    return { candidateCount: 0, sentCount: 0, failedCount: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Send individually (not batched) since each email's body is personalized
  // per-user session previews; volume per scan is small (<= dailyCap).
  for (const candidate of candidates) {
    try {
      const sessions = await getUnreadSessionPreviews(candidate.id);
      const html = renderUnreadReminderHtml({
        unreadTotal: candidate.unreadTotal,
        sessions,
        unsubscribeToken: makeUnsubscribeToken(candidate.id),
      });
      const subject = `LocallyHelper · 你有 ${candidate.unreadTotal} 条未读消息`;
      const ok = await sendResendBatch([
        { from: config.resend.fromEmail, to: candidate.email, subject, html },
      ]);
      sent += ok;
      if (ok === 0) failed += 1;
    } catch (err) {
      failed += 1;
      logger.error('Unread reminder send failed', {
        userId: candidate.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  logger.info('Unread reminder scan complete', { candidateCount: candidates.length, sent, failed });

  return { candidateCount: candidates.length, sentCount: sent, failedCount: failed };
}


