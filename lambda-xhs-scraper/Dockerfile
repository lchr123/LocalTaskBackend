# Lambda container image for the Xiaohongshu (小红书) post scraper.
#
# Playwright's Chromium binary + its native shared libraries are too large and
# too fragile to ship as a zip-based Lambda layer (path/dependency mismatches
# between build and Lambda's execution environment are a common failure mode).
# A container image avoids that entirely: everything the browser needs is
# baked into the image at build time.
#
# @sparticuz/chromium provides a Chromium build specifically compiled to run
# inside AWS Lambda's execution environment; playwright-core drives it via the
# DevTools protocol (no need for the full `playwright` package with its own
# bundled browser download).

FROM public.ecr.aws/lambda/nodejs:20

WORKDIR /var/task

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.mjs ./

CMD ["index.handler"]
