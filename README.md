# Liara Copilot

یک دستیار فارسی و RTL برای Liara که بین پاسخ ساده، بررسی زندهٔ حساب و
عیب‌یابی چندمرحله‌ای کم‌هزینه‌ترین مسیر مناسب را انتخاب می‌کند. این پروژه برای
هکاتون ساخته شده و اکنون یک نسخهٔ صفر قابل اجرا است؛ هنوز روی Liara عمومی نشده.

## اجرای محلی

نیازمندی‌ها: Node.js 20+ و pnpm 9.

```bash
pnpm install
cp .env.example .env
```

حداقل این مقادیر را در `.env` تنظیم کنید (این فایل در git نادیده گرفته می‌شود):

```dotenv
LIARA_API_TOKEN=             # اختیاری؛ fallback فقط برای توسعهٔ محلی
LIARA_TEAM_ID=               # همراه fallback برای حساب تیمی
ALLOW_SHARED_LIARA_TOKEN=false # برای fallback خصوصی/محلی به true تغییر دهید
LIARA_AI_BASE_URL=https://ai.liara.ir/api/<workspace-id>/v1
LIARA_AI_KEY=
TOOL_APPROVAL_SECRET=        # openssl rand -base64 32
TOKEN_COOKIE_SECRET=         # openssl rand -base64 32
ENABLE_SEMANTIC_RAG=false
```

کلید AI فقط در سرور استفاده می‌شود. برای منابع حساب، یا fallback محلی بالا را
تنظیم کنید یا از دکمهٔ «اتصال حساب» داخل برنامه استفاده کنید؛ توکن کاربر در یک
cookie رمزنگاری‌شدهٔ `httpOnly` با عمر ۸ ساعت نگه‌داری می‌شود. secretها را commit
نکنید.
سپس:

```bash
pnpm dev
```

برنامه در [http://localhost:3000](http://localhost:3000) باز می‌شود. هر پیام
واقعی به Liara AI هزینه دارد و هزینهٔ برگشتی سرویس در رابط به Toman نمایش داده
می‌شود.

## چه چیزی را می‌توان تست کرد؟

این سناریوها را به ترتیب امتحان کنید:

| سناریو | پیام نمونه | انتظار |
|---|---|---|
| پاسخ مستنداتی | `لیارا چیست؟` | Level 1، مدل Flash، جست‌وجوی مستندات و citation |
| مشاهدهٔ حساب | `چه اپ‌هایی در حساب من فعال هستند؟` | Level 2، کارت اپ‌ها بدون تغییر حساب |
| ماندگاری | یک سؤال بپرسید و صفحه را refresh کنید | گفتگو و جمع هزینه از IndexedDB بازیابی می‌شود |
| دادهٔ حساس | `متغیرهای محیطی digishop-api را نشان بده` | مقدار secretها پیش از رسیدن به مدل redacted می‌شود |
| عیب‌یابی | `چرا digishop-api پاسخ ۵۰۲ می‌دهد؟` | Level 3، بررسی مرحله‌ای status/release/logs و توقف پس از یافتن علت |
| تأیید عملیات | یک تغییر env یا restart درخواست کنید | Before/After و دیالوگ تأیید؛ رد کردن نباید هیچ API write بزند |

سناریوی کامل 502 به کد دمو روی `digishop-api` نیاز دارد؛ اپ‌های ناوگان ساخته
شده‌اند اما هنوز کد معیوب/سالم آن‌ها deploy نشده است. بنابراین فعلاً پاسخ این
سناریو به داده‌ای که واقعاً در حساب وجود دارد محدود می‌ماند و چیزی جعل نمی‌شود.

## بررسی کیفیت

```bash
pnpm lint
pnpm exec tsc --noEmit
node --import ./scripts/register-ts.mjs --test src/lib/**/*.test.ts
pnpm build
```

Smoke test زندهٔ client (به API واقعی وصل می‌شود):

```bash
node scripts/test-liara-client.mjs
```

این تست read-only است، اما به `LIARA_API_TOKEN` و در حساب تیمی به
`LIARA_TEAM_ID` نیاز دارد.

## معماری در یک نگاه

```text
Persian chat UI
  → deterministic escalation router (Level 1 / 2 / 3)
  → Liara AI: Flash for cheap answers, Sonnet only for troubleshooting
  → 20 narrow tools
       ├─ bundled Liara docs: BM25, semantic retrieval optional
       └─ allow-listed Liara management client
  → streamed tool cards + real Toman usage metadata
  → completed chat turns in browser IndexedDB
```

جزئیات تصمیم‌ها در [MASTER-PLAN](docs/MASTER-PLAN.md)، واقعیت‌های اندازه‌گیری‌شده
در [VERIFIED-FACTS](docs/VERIFIED-FACTS.md)، و spec محصول در
[product spec](docs/liara-agentic-assistant-product-spec-v2-en.md) است.

## مرزهای امنیتی

- مدل فقط ابزارهای level جاری را می‌بیند؛ ابزار عمومی `liara_api_call` وجود ندارد.
- client فقط endpointهای صریح allow-list را می‌پذیرد و هر `DELETE` را رد می‌کند.
- تنها شش write برگشت‌پذیر وجود دارد و هرکدام تأیید صریح کاربر می‌خواهند.
- تأییدها با HMAC به حساب، نام ابزار، call id و input دقیق متصل‌اند؛ هر write در
  process فعلی فقط یک بار مصرف می‌شود و بدون secret معتبر fail closed است.
- مقادیر env پیش از ورود به model context redacted می‌شوند.
- production به‌صورت پیش‌فرض `LIARA_API_TOKEN` مشترک را نادیده می‌گیرد و اتصال
  per-user می‌خواهد. درخواست‌ها same-origin، rate-limited و برای هر حساب تک-stream
  هستند؛ headerهای ضد clickjacking نیز فعال‌اند.

## استقرار روی Liara

فایل [`liara.json`](liara.json) فقط تنظیمات معتبر فعلی را نگه می‌دارد. ابتدا یک
اپ NextJS بسازید و متغیرهای محیطی بالا را در Console تنظیم کنید، سپس بعد از
بازبینی نهایی:

```bash
liara deploy --app=liara-copilot-ir --platform=next --team-id="$LIARA_TEAM_ID"
```

این repository هیچ deploy خودکاری انجام نمی‌دهد. cron و disk مربوط به refresh
مستندات زمانی اضافه می‌شوند که endpoint مربوطه پیاده‌سازی شده باشد؛ snapshot
فعلی مستندات همراه کد است.

## محدودیت‌های صادقانهٔ v0

- demo fleet هنوز code deployment ندارد؛ hero demo کامل 502 آماده نیست.
- semantic retrieval پیاده‌سازی شده ولی برای کنترل هزینه پیش‌فرض خاموش است.
- حساب فعلی DNS zone ندارد و metric endpointها در مشاهدهٔ اخیر خالی بوده‌اند.
- replay/rate limit در v0 حافظه‌ای است؛ استقرار چند-instance باید آن را به یک
  store مشترک منتقل کند. cookie نیز پیش از پایان ۸ ساعت revocation سروری ندارد.
- IndexedDB رمزنگاری‌شده نیست؛ فقط خروجی‌های redacted ذخیره می‌شوند و با تغییر
  حساب در همهٔ tabها پاک می‌شود، اما روی مرورگر مشترک تاریخچه را دستی هم پاک کنید.
- live URL، public repository و demo video هنوز مرحلهٔ shipping هستند.
