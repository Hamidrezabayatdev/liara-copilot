# راه‌اندازی — کارهایی که فقط شما می‌توانید انجام دهید
Setup checklist — parallel track for the owner. Everything else I do.

> **آرشیو:** این checklist برای راه‌اندازی اولیه نگه‌داری شده است. برنامه، semantic
> RAG و ناوگان دمو اکنون deploy شده‌اند؛ برای تکرار استقرار از
> [`DEPLOYMENT.md`](./DEPLOYMENT.md) استفاده کنید.

## 1. دسترسی API لیارا

برای توسعهٔ محلی می‌توان یک token مشترک در `.env` گذاشت. در رابط V1 نیز دکمهٔ
«اتصال حساب» وجود دارد که token کاربر را با یک read بی‌خطر اعتبارسنجی و در
cookie رمزنگاری‌شدهٔ `httpOnly` نگه‌داری می‌کند. production به‌صورت پیش‌فرض
token مشترک را قبول نمی‌کند.

1. کنسول → منوی **API** → **ساخت کلید جدید**
2. توکن **فقط یک بار** نمایش داده می‌شود؛ کپی کنید
3. برای fallback توسعه، در ریشه پروژه و فایل `.env` قرار دهید:
   ```
   LIARA_API_TOKEN=...
   ```
   یا: `liara login --api-token=<TOKEN>`

## 2. سرویس هوش مصنوعی
از کنسول → **هوش مصنوعی**:
- `LIARA_AI_BASE_URL` = `https://ai.liara.ir/api/<workspace_id>/v1`
- `LIARA_AI_KEY` = کلید (بخش **کلیدها → ایجاد کلید**، فقط یک بار نمایش داده می‌شود)

> پلن، دسترسی به مدل‌ها را محدود می‌کند. بعد از دریافت کلید، خودم با
> `GET {LIARA_AI_BASE_URL}/models` بررسی می‌کنم که
> `deepseek/deepseek-v4-flash`، `openai/gpt-5.6-luna-pro` و
> `google/gemini-3.7-flash` در پلن فعال باشند
> و اگر نبودند، routing را روی نزدیک‌ترین مدل موجود تنظیم می‌کنم.

## 3. برنامه‌ی مقصد برای استقرار — انجام شد

نسخهٔ production در [liara-copilot-ir.liara.run](https://liara-copilot-ir.liara.run)
فعال است و `/api/health` آمادگی configuration، corpus و semantic index را بررسی
می‌کند.

## 4. حساب دمو (نیازمند تأیید صریح مالک)

ناوگان دمو اکنون فعال است:

- `digishop-front` — سالم
- `digishop-api` — mismatch عمدی پورت و سناریوی اصلی خطای 502
- `digishop-worker` — با scale صفر متوقف

هیچ seed یا تغییر هزینه‌دار در اجرای محلی به‌صورت خودکار انجام نمی‌شود.

---
## متغیرهای محیطی — فایل کامل
`.env` (هیچ‌وقت commit نمی‌شود):
```
LIARA_API_TOKEN=            # مرحله ۱
LIARA_TEAM_ID=              # برای حساب تیمی
ALLOW_SHARED_LIARA_TOKEN=false
LIARA_AI_BASE_URL=          # مرحله ۲
LIARA_AI_KEY=               # مرحله ۲
TOOL_APPROVAL_SECRET=       # خودم می‌سازم (HMAC برای امضای تأییدها)
TOKEN_COOKIE_SECRET=        # خودم می‌سازم (رمزنگاری کوکی توکن کاربر)
ENABLE_SEMANTIC_RAG=true    # پس از اجرای scripts/build-docs-index.mjs
```
