/**
 * Marketplace Draft Service
 *
 * Turns raw scraped Xiaohongshu post content into a structured draft that
 * matches the CreateTaskPayload shape for kind='marketplace'
 * (see src/types/task.ts, src/validators/taskValidator.ts).
 *
 * Pipeline (see adminController's /marketplace-draft/scrape route):
 *   1. xhsScraperService.scrapeXhsPost(url)  -> raw title/text/images/author
 *   2. downloadAndReuploadImages(...)         -> our own S3 URLs
 *   3. structureWithOpenAI(...)               -> { type, description, reward, contactMethod }
 *
 * The OpenAI output is NEVER trusted directly — the admin controller re-runs
 * it through createTaskSchema before anything is persisted. This service's
 * job is only to produce a best-effort DRAFT for a human to review and edit.
 */

import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';
import { uploadImage } from './uploadService';

/** Kept in sync with ITEM_CATEGORY_LABELS in the frontend's utils/constants.ts. */
export const ITEM_CATEGORIES = ['electronics', 'furniture', 'clothing', 'books', 'other'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface MarketplaceDraft {
  /** Best-effort item category guess; always one of ITEM_CATEGORIES. */
  type: ItemCategory;
  /** Cleaned-up description, 10-500 chars (may need admin editing to fit). */
  description: string;
  /** Price in yen if mentioned in the text, else null (admin must fill in). */
  reward: number | null;
  /** Contact method if mentioned in the text, else null. */
  contactMethod: string | null;
  /** Passed through as-is for the admin's reference; not part of CreateTaskPayload. */
  sourceAuthorName: string | null;
  sourceUrl: string;
}

let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

/**
 * Download each scraped image URL and re-upload it to our own S3 under the
 * `tasks/` folder, returning our own stable URLs. Xiaohongshu's CDN URLs are
 * often short-lived/signed, so we must not store or link to them directly.
 *
 * Best-effort: a failed individual image is skipped (logged) rather than
 * failing the whole draft — partial images are still useful to the admin.
 */
export async function downloadAndReuploadImages(imageUrls: string[]): Promise<string[]> {
  const uploaded: string[] = [];

  for (const rawUrl of imageUrls) {
    // Xiaohongshu's meta tags and DOM often return protocol-relative URLs
    // (e.g. "//picasso-static.xiaohongshu.com/..."). Browsers resolve these
    // against the current page's protocol automatically, but Node's fetch()
    // requires an absolute URL and throws "Failed to parse URL" otherwise —
    // which downloadAndReuploadImages was silently swallowing as a per-image
    // failure, so every image was dropped without a clear error.
    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn('Failed to download scraped image', { url, status: res.status });
        continue;
      }
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      // Only re-host actual images — skip anything else the page linked to.
      if (!contentType.startsWith('image/')) {
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      // uploadImage validates mimetype against an allowlist (jpeg/png) and
      // enforces a 5MB size cap; images outside that are skipped, not thrown.
      const normalizedMime = contentType.includes('png') ? 'image/png' : 'image/jpeg';
      const newUrl = await uploadImage(
        {
          buffer,
          mimetype: normalizedMime,
          originalname: `xhs_${Date.now()}.${normalizedMime === 'image/png' ? 'png' : 'jpg'}`,
          size: buffer.length,
        },
        'tasks'
      );
      uploaded.push(newUrl);
    } catch (err) {
      logger.warn('Failed to re-upload scraped image', {
        url,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return uploaded;
}

const STRUCTURE_SYSTEM_PROMPT = `你是一个从社交媒体商品发布文案中提取结构化信息的助手。
你会收到一段来自小红书笔记的原始文案。请提取以下信息并以 JSON 格式返回：
- type: 商品分类，必须是以下之一: ${ITEM_CATEGORIES.join(', ')}。如果无法判断，返回 "other"。
- description: 清理后的商品描述，10到500个字符，去除无关的话题标签(#xxx)、表情符号堆砌和求赞求关注等无关内容，但保留商品的实际信息（新旧程度、规格、尺寸等）。
- reward: 如果原文提到了具体价格（数字，日元），返回该数字；如果没有明确提到价格，返回 null。不要编造价格。
- contactMethod: 如果原文提到了联系方式（微信、LINE、小红书号等），原样提取；如果没有，返回 null。

只返回 JSON，不要包含任何其他解释文字。不要编造原文中没有的信息。`;

/**
 * Send the scraped text through OpenAI to get a structured draft.
 * Falls back to a minimal draft (type='other', raw text truncated) if the
 * API call fails or returns something unparseable — the admin can still
 * edit everything by hand, so a failure here should never block the flow.
 */
export async function structureWithOpenAI(rawText: string): Promise<{
  type: ItemCategory;
  description: string;
  reward: number | null;
  contactMethod: string | null;
}> {
  const fallback = {
    type: 'other' as ItemCategory,
    description: rawText.slice(0, 500),
    reward: null,
    contactMethod: null,
  };

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: config.openai.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as Partial<{
      type: string;
      description: string;
      reward: number | string | null;
      contactMethod: string | null;
    }>;

    const type = ITEM_CATEGORIES.includes(parsed.type as ItemCategory)
      ? (parsed.type as ItemCategory)
      : 'other';

    const description =
      typeof parsed.description === 'string' && parsed.description.trim().length >= 10
        ? parsed.description.trim().slice(0, 500)
        : fallback.description;

    const reward =
      typeof parsed.reward === 'number' && Number.isFinite(parsed.reward) && parsed.reward >= 0
        ? Math.round(parsed.reward)
        : typeof parsed.reward === 'string' && /^\d+$/.test(parsed.reward)
          ? parseInt(parsed.reward, 10)
          : null;

    const contactMethod =
      typeof parsed.contactMethod === 'string' && parsed.contactMethod.trim().length > 0
        ? parsed.contactMethod.trim().slice(0, 100)
        : null;

    return { type, description, reward, contactMethod };
  } catch (err) {
    logger.warn('OpenAI structuring failed, falling back to raw text', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return fallback;
  }
}
