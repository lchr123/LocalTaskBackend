# lambda-xhs-scraper

Renders a Xiaohongshu (小红书) post URL with headless Chromium and extracts
`title` / `text` / `images[]` / `authorName`. Deployed as a **Lambda container
image** (not a zip) because Playwright's Chromium binary is too large/fragile
for a zip-based layer.

Called by the main backend's `POST /admin/marketplace-draft/scrape` endpoint
via the Lambda `Invoke` API — this function is never exposed directly to the
internet.

**Architecture: x86_64 only.** `@sparticuz/chromium` on npm ships x64
Chromium binaries only — arm64 requires a separate Lambda layer zip or a
remotely-hosted pack tar (only available starting Chromium v135+). Always
build and deploy this image for `linux/amd64` / `x86_64`, and create/update
the Lambda function with `--architectures x86_64`. Building an arm64 image
will fail at runtime with `/tmp/chromium: cannot execute binary file`.

## Why a container image, and why isolated from the main backend

- The main backend (`local-task-backend`) runs as a long-lived Express
  process on a small Lightsail instance. Headless Chromium uses ~200-500MB of
  RAM per render and several seconds of CPU — embedding it there would risk
  starving the API of resources on every scrape, and bloat the main Docker
  image with Chromium's system dependencies (fonts, graphics libs, etc.).
- Running it as its own Lambda means: pay-per-invocation, resource isolation
  from the API, and independent scaling (concurrent scrapes don't compete
  with API request handling).

## One-time setup (manual — this repo has no CDK/Terraform)

1. **Create an ECR repository** (once):
   ```bash
   aws ecr create-repository --repository-name localtask-xhs-scraper --region ap-northeast-1
   ```

2. **Build and push the image** (must be `linux/amd64` — see architecture
   note above; `--platform linux/amd64` forces this even when building on an
   arm64 host like Apple Silicon, via QEMU emulation):
   ```bash
   cd lambda-xhs-scraper
   aws ecr get-login-password --region ap-northeast-1 | \
     docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com

   docker build --platform linux/amd64 -t localtask-xhs-scraper .
   docker tag localtask-xhs-scraper:latest \
     <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest
   docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest
   ```

3. **Create the Lambda function** (once), pointing at that image:
   ```bash
   aws lambda create-function \
     --function-name localtask-xhs-scraper \
     --package-type Image \
     --code ImageUri=<ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest \
     --role arn:aws:iam::<ACCOUNT_ID>:role/<LAMBDA_EXECUTION_ROLE> \
     --timeout 60 \
     --memory-size 1024 \
     --architectures x86_64 \
     --region ap-northeast-1
   ```
   Note: a Lambda function's architecture cannot be changed after creation
   via `update-function-code` — if you ever need to switch, delete and
   recreate the function.
   The execution role only needs the standard
   `AWSLambdaBasicExecutionRole` (CloudWatch Logs) — this function makes no
   AWS API calls of its own.

4. **Grant the main backend permission to invoke it.** Add an
   `lambda:InvokeFunction` policy for this function's ARN to whatever
   IAM identity the backend's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
   (in `.env`) resolve to.

## Redeploying after a code change

Xiaohongshu can change its page structure at any time, which will degrade or
break the DOM-based extraction in `extractFromDom` (see the comments in
`index.mjs`). When that happens:

```bash
cd lambda-xhs-scraper
docker build --platform linux/amd64 -t localtask-xhs-scraper .
docker tag localtask-xhs-scraper:latest <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest

aws lambda update-function-code \
  --function-name localtask-xhs-scraper \
  --image-uri <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/localtask-xhs-scraper:latest
```

## Invoke payload / response shape

Request (the `event` object passed to the handler):
```json
{ "url": "https://www.xiaohongshu.com/explore/<note_id>" }
```

Response body (JSON string, per the Lambda `Invoke` response `Payload`):
```json
{
  "url": "...",
  "title": "...",
  "text": "...",
  "images": ["https://...", "..."],
  "authorName": "...",
  "extractedAt": "2026-07-11T00:00:00.000Z"
}
```

`images` are Xiaohongshu CDN URLs — they are often short-lived/signed, so the
caller must download and re-upload them to its own storage promptly (the
backend does this immediately via `uploadService`).

## Local testing without deploying

You can test `index.mjs`'s extraction logic locally with plain
`playwright` (not `playwright-core` + `@sparticuz/chromium`, which only
targets Lambda's Amazon Linux environment):

```bash
npm install playwright
npx playwright install chromium
node -e "
  const { chromium } = require('playwright');
  const { handler } = require('./index.mjs'); // adjust launch() for local testing
"
```

Simplest approach: temporarily swap the `launch()` call to plain
`playwright`'s `chromium.launch()` (no `executablePath`/`args` overrides),
run against a real post URL, and confirm `text`/`images`/`authorName` come
back populated before deploying.
