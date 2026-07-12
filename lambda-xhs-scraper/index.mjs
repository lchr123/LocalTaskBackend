/**
 * Xiaohongshu (小红书) Post Scraper — Lambda Handler
 *
 * Renders a post URL with headless Chromium (the content is client-side
 * rendered, so a plain HTTP fetch only returns an empty shell) and extracts:
 *   - title
 *   - text (post body)
 *   - images (CDN URLs — NOT re-hosted here; the caller must download and
 *     re-upload them to its own storage, since these URLs are often
 *     short-lived/signed and We must not link out to XHS's CDN long-term)
 *   - authorName
 *
 * Intended use: pulling content the CALLER already owns/authored on
 * Xiaohongshu, for republishing as a marketplace listing on their own
 * platform. This does not address Xiaohongshu's terms of service around
 * automated access — that risk has been discussed and accepted by the
 * caller; this function only handles the technical extraction.
 *
 * IMPORTANT — selector fragility:
 * Xiaohongshu can change its page structure at any time. This handler tries,
 * in order:
 *   1. Open Graph / Twitter meta tags (most stable — used for link previews,
 *      least likely to change, but usually only yields ONE image + a short
 *      description, not the full post text or full image gallery).
 *   2. Known DOM selectors for the note detail page (richer — full text,
 *      full image gallery, author name — but brittle; verified against the
 *      site's structure at the time this was written and WILL need updating
 *      if Xiaohongshu ships a redesign).
 * If both fail, the handler returns whatever partial data it found rather
 * than throwing, so the caller can still show something and ask the admin
 * to fill in the rest manually.
 *
 * Deployed as a container image — see Dockerfile in this directory.
 */

import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const NAV_TIMEOUT_MS = 25000;
const RENDER_WAIT_MS = 2500;

/**
 * Extract via Open Graph / Twitter Card meta tags. Cheap, fast, most stable.
 */
async function extractFromMetaTags(page) {
  return page.evaluate(() => {
    const meta = (name) =>
      document
        .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
        ?.getAttribute('content') || null;

    const title = meta('og:title') || meta('twitter:title');
    const description = meta('og:description') || meta('twitter:description');
    const image = meta('og:image') || meta('twitter:image');

    return {
      title,
      text: description,
      images: image ? [image] : [],
      authorName: null,
    };
  });
}

/**
 * Extract via the note detail page's DOM. Richer but brittle — these
 * selectors reflect Xiaohongshu's structure as of this writing and are the
 * first thing to check/update if extraction quality degrades.
 */
async function extractFromDom(page) {
  return page.evaluate(() => {
    function text(selector) {
      return document.querySelector(selector)?.textContent?.trim() || null;
    }

    // Post title (notes without an explicit title often reuse the first
    // line of the body here).
    const title = text('#detail-title') || text('.note-content .title');

    // Post body text.
    const bodyText =
      text('#detail-desc') || text('.note-content .desc') || text('.note-content');

    // Author display name.
    const authorName =
      text('.author-wrapper .username') ||
      text('.info .name') ||
      text('a.name');

    // Image gallery — collect every candidate <img> inside the note's media
    // area and de-duplicate. Xiaohongshu typically serves multiple
    // resolutions per image via query params; we keep the raw src as-is and
    // let the caller decide whether to normalize/dedupe further.
    const imageEls = Array.from(
      document.querySelectorAll(
        '.note-slider img, .swiper-slide img, .media-container img'
      )
    );
    const images = Array.from(
      new Set(
        imageEls
          .map((img) => img.getAttribute('src') || img.getAttribute('data-src'))
          .filter((src) => !!src && !src.startsWith('data:'))
      )
    );

    return { title, text: bodyText, images, authorName };
  });
}

function mergeResults(preferred, fallback) {
  return {
    title: preferred.title || fallback.title || null,
    text: preferred.text || fallback.text || null,
    images: preferred.images?.length ? preferred.images : fallback.images || [],
    authorName: preferred.authorName || fallback.authorName || null,
  };
}

export const handler = async (event) => {
  const url = event?.url || (event?.body ? JSON.parse(event.body).url : null);

  if (!url || typeof url !== 'string' || !url.includes('xiaohongshu.com')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid_url', message: 'A xiaohongshu.com post URL is required' }),
    };
  }

  let browser;
  try {
    browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({
      // A realistic desktop UA reduces the chance of being served a
      // stripped-down "unsupported browser" page.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    // Client-side rendered content needs a beat after DOMContentLoaded.
    await page.waitForTimeout(RENDER_WAIT_MS);

    const [metaResult, domResult] = await Promise.all([
      extractFromMetaTags(page).catch(() => ({ title: null, text: null, images: [], authorName: null })),
      extractFromDom(page).catch(() => ({ title: null, text: null, images: [], authorName: null })),
    ]);

    // DOM extraction is richer when it works; meta tags are the fallback.
    const result = mergeResults(domResult, metaResult);

    await browser.close();

    return {
      statusCode: 200,
      body: JSON.stringify({
        url,
        title: result.title,
        text: result.text,
        images: result.images,
        authorName: result.authorName,
        extractedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    console.error('Scrape failed:', err);
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: 'scrape_failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};
