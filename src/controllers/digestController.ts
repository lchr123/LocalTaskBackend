/**
 * Digest Controller
 *
 * - POST /digest/run      Trigger the weekly digest (protected by x-digest-secret).
 *                         Supports ?dryRun=1 and ?testEmail=foo@bar.com for safe testing.
 * - GET  /unsubscribe     One-click unsubscribe from a signed token in the email.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { runWeeklyDigest, verifyUnsubscribeToken, setEmailOptIn } from '../services/digestService';
import { runUnreadReminders } from '../services/notificationEmailService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /digest/run
 * Triggered by the GitHub Actions weekly cron. Requires header `x-digest-secret`.
 */
router.post('/digest/run', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const secret = req.header('x-digest-secret');
    if (!config.digest.secret || secret !== config.digest.secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const testEmail = typeof req.query.testEmail === 'string' ? req.query.testEmail : undefined;

    const result = await runWeeklyDigest({ dryRun, testEmail });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /notifications/unread-scan
 * Manually trigger one unread-message reminder scan (for testing/ops). The
 * background scheduler (taskScheduler) already runs this every 30 minutes;
 * this endpoint exists so it can be exercised on demand without waiting.
 * Requires header `x-digest-secret`. Supports ?dryRun=1 and ?testEmail=.
 */
router.post('/notifications/unread-scan', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const secret = req.header('x-digest-secret');
    if (!config.digest.secret || secret !== config.digest.secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const testEmail = typeof req.query.testEmail === 'string' ? req.query.testEmail : undefined;

    const result = await runUnreadReminders({ dryRun, testEmail });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /unsubscribe?token=...
 * Verifies the signed token and flips email_opt_in to false. Returns a simple page.
 */
router.get('/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const userId = token ? verifyUnsubscribeToken(token) : null;

  const page = (title: string, message: string) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title></head>
<body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f5f5;margin:0;padding:48px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
    <h2 style="color:#1976D2;margin-top:0;">${title}</h2>
    <p style="color:#555;line-height:1.6;">${message}</p>
  </div>
</body></html>`;

  if (!userId) {
    res.status(400).send(page('リンクが無効です', 'この配信停止リンクは無効または期限切れです。'));
    return;
  }

  try {
    await setEmailOptIn(userId, false);
    res.status(200).send(page('配信を停止しました', 'LocallyHelper の週間ダイジェストの配信を停止しました。設定からいつでも再開できます。'));
  } catch (err) {
    logger.error('Unsubscribe failed', { error: err instanceof Error ? err.message : 'Unknown error' });
    res.status(500).send(page('エラーが発生しました', 'しばらくしてからもう一度お試しください。'));
  }
});

export { router as digestController };
