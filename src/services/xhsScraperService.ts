/**
 * Xiaohongshu (小红书) Scraper Client
 *
 * Invokes the standalone lambda-xhs-scraper Lambda function (a container
 * image running headless Chromium — see lambda-xhs-scraper/README.md for why
 * this is a separate function rather than embedded in this API process) and
 * returns the extracted post content.
 *
 * This service does NOT itself render any pages — it only talks to the
 * Lambda over the AWS Invoke API. It also does not persist the returned
 * image URLs; those are Xiaohongshu CDN URLs and the caller (the admin
 * marketplace-draft controller) is responsible for downloading and
 * re-uploading them to our own S3 promptly.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const lambdaClient = new LambdaClient({ region: config.xhsScraper.region });

export interface ScrapedPost {
  url: string;
  title: string | null;
  text: string | null;
  images: string[];
  authorName: string | null;
  extractedAt: string;
}

/**
 * Invoke the scraper Lambda for a single Xiaohongshu post URL.
 * Throws AppError(502, 'scrape_failed', ...) on any failure (invocation
 * error, non-200 from the function, or malformed response) so the admin
 * controller can surface a clear error rather than a raw stack trace.
 */
export async function scrapeXhsPost(url: string): Promise<ScrapedPost> {
  if (!url.includes('xiaohongshu.com')) {
    throw new AppError(422, 'invalid_url', '请提供小红书笔记链接');
  }

  let payloadJson: string;
  try {
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: config.xhsScraper.lambdaFunctionName,
        Payload: Buffer.from(JSON.stringify({ url })),
      })
    );

    if (!result.Payload) {
      throw new Error('Lambda returned an empty payload');
    }
    payloadJson = Buffer.from(result.Payload).toString('utf-8');

    // FunctionError is set when the handler itself threw (as opposed to
    // returning a { statusCode, body } error response) — e.g. a cold-start
    // timeout or an unhandled exception.
    if (result.FunctionError) {
      logger.error('XHS scraper Lambda returned FunctionError', { payloadJson });
      throw new Error('Scraper function error');
    }
  } catch (err) {
    logger.error('XHS scraper Lambda invocation failed', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    throw new AppError(502, 'scrape_failed', '抓取小红书内容失败，请稍后重试');
  }

  let body: { statusCode: number; body: string };
  try {
    body = JSON.parse(payloadJson);
  } catch {
    throw new AppError(502, 'scrape_failed', '抓取服务返回了无法解析的结果');
  }

  if (body.statusCode !== 200) {
    let message = '抓取小红书内容失败';
    try {
      message = JSON.parse(body.body)?.message || message;
    } catch {
      // ignore parse failure, use default message
    }
    throw new AppError(502, 'scrape_failed', message);
  }

  const parsed = JSON.parse(body.body) as ScrapedPost;

  if (!parsed.text && parsed.images.length === 0) {
    throw new AppError(
      502,
      'scrape_empty',
      '未能提取到任何内容，页面结构可能已变化或该链接不是有效的笔记页'
    );
  }

  return parsed;
}
