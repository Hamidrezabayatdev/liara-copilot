# Production deployment on Liara

نسخهٔ فعلی در `https://liara-copilot-ir.liara.run` روی plan تک-instance اجرا
می‌شود. این راهنما deployment را بدون قرار دادن secret در source یا image تکرار
می‌کند.

## 1. Environment

در Console لیارا متغیرهای زیر را تنظیم کنید:

```text
LIARA_AI_BASE_URL
LIARA_AI_KEY
MODEL_ROUTER=deepseek/deepseek-v4-flash
MODEL_ANSWER=openai/gpt-5.6-luna-pro
MODEL_REASON=google/gemini-3.7-flash
MODEL_BASELINE=anthropic/claude-opus-5
MODEL_EMBED=intfloat/multilingual-e5-large
TOOL_APPROVAL_SECRET=<at least 32 random bytes>
TOKEN_COOKIE_SECRET=<at least 32 random bytes>
ALLOW_SHARED_LIARA_TOKEN=false
ENABLE_SEMANTIC_RAG=true
TELEMETRY_ENABLED=true
MAX_MODEL_CALLS_PER_REQUEST=18
```

Management API credentials برای production عمومی لازم نیستند؛ هر کاربر حساب خود
را از UI متصل می‌کند. برای smoke test تیمی، `LIARA_API_TOKEN` و `LIARA_TEAM_ID`
را فقط در محیط امن تنظیم کنید.

## 2. Standard Next.js deployment

```bash
pnpm install --frozen-lockfile
node scripts/build-docs-index.mjs
pnpm check
liara deploy --account hackathon --team-id "$LIARA_TEAM_ID" \
  --app liara-copilot-ir --platform next --path . \
  --liara-json liara.json --no-app-logs
```

`liara.json` پورت، build region و health check را نگه می‌دارد. health check به
`/api/health` می‌زند؛ این endpoint هیچ API یا مدل خارجی را صدا نمی‌زند و آمادگی
configuration، corpus و سازگاری کامل semantic index محلی را بررسی می‌کند.

## 3. Deterministic standalone fallback

در deployment ثبت‌شدهٔ هکاتون، builder استاندارد بعد از compile موفق Next در
مرحلهٔ ساخت runtime image timeout شد. fallback زیر همان build تأییدشدهٔ محلی را
به یک Docker context کوچک و secret-free تبدیل می‌کند؛ روی Liara دیگر `install`
یا `next build` اجرا نمی‌شود.

```bash
node scripts/build-docs-index.mjs
pnpm package:liara
# آخرین خط، مسیر موقت artifact را چاپ می‌کند.

liara deploy --account hackathon --team-id "$LIARA_TEAM_ID" \
  --app liara-copilot-ir --platform docker \
  --path /tmp/liara-copilot-standalone-XXXXXX \
  --dockerfile Dockerfile --port 3000 --build-location germany \
  --liara-json liara.docker.json --no-app-logs
```

Packager موارد زیر را enforce می‌کند:

- dotenvهای کپی‌شده توسط Next پیش از ساخت context حذف می‌شوند.
- `public`، static assets، corpus، semantic index و traced runtime صریحاً
  بسته‌بندی می‌شوند؛ وقتی semantic فعال است index گمشده deployment را fail می‌کند.
- symlinkهای نسبی pnpm بدون وابستگی به مسیر workstation حفظ می‌شوند.
- package ناقص `@swc/helpers` در standalone Next 16 با نسخهٔ کامل lockfile جایگزین
  می‌شود.
- `.liaraignore` فقط traced dependency tree را از ignore پیش‌فرض CLI مستثنا
  می‌کند؛ source و dev dependency وارد image نمی‌شوند.

## 4. Verification

```bash
curl --fail https://liara-copilot-ir.liara.run/api/health
curl --fail https://liara-copilot-ir.liara.run/
liara logs --app liara-copilot-ir --team-id "$LIARA_TEAM_ID" \
  --since "15 minutes ago" --timestamps --last-lines
```

قبل از promotion باید health پاسخ `status: ok` و هر سه check را `true` برگرداند.
در logها eventهای JSON با نام `http.request` شامل request ID، status، duration و
AI usage دیده می‌شوند و نباید prompt، cookie، Authorization یا secret داشته باشند.
