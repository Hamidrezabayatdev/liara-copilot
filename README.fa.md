<p align="center">
  <img src="public/liara-logo.svg" width="112" alt="لیارا" />
</p>

<h1 align="center">Liara Copilot</h1>

<p align="center" dir="rtl">
  ایجنت فارسی لیارا برای مستندات، عیب‌یابی سرویس‌های ابری و اجرای امن عملیات زیرساختی.
</p>

<p align="center">
  <a href="https://liara-copilot-ir.liara.run"><strong>نسخهٔ آنلاین</strong></a>
  ·
  <a href="https://liara-copilot-ir.liara.run/api/health">وضعیت سرویس</a>
  ·
  <a href="docs/DEPLOYMENT.md">راهنمای استقرار</a>
</p>

<p align="center">
  <a href="README.md">English</a>
  ·
  <strong>فارسی</strong>
</p>

<p align="center">
  <a href="https://github.com/Hamidrezabayatdev/liara-copilot/actions/workflows/quality.yml">
    <img src="https://github.com/Hamidrezabayatdev/liara-copilot/actions/workflows/quality.yml/badge.svg" alt="وضعیت CI" />
  </a>
</p>

![نمای گفت‌وگوی Liara Copilot](docs/assets/liara-copilot-demo.png)

> این پروژه مستقل است و محصول رسمی لیارا نیست.

## دربارهٔ پروژه

Liara Copilot جست‌وجوی مستندات، مشاهدهٔ زندهٔ حساب، عیب‌یابی و عملیات
زیرساختی را در یک رابط مکالمه‌ای جمع می‌کند. پاسخ به پرسش‌های عمومی نیازی به
اتصال حساب ندارد. پس از اتصال حساب شخصی کاربر، ایجنت می‌تواند منابع واقعی را
بررسی کند و تغییرات را فقط با تأیید صریح او انجام دهد.

### قابلیت‌های اصلی

- **پاسخ مستند:** در نسخهٔ محلی ۱٬۱۲۵ صفحه از مستندات رسمی لیارا جست‌وجو
  می‌کند، نتیجه‌ها را با BM25، E5 و RRF به‌صورت تطبیقی بازیابی می‌کند و منبع
  هر پاسخ را نمایش می‌دهد.
- **اطلاعات زندهٔ زیرساخت:** برنامه‌ها، استقرارها، دیتابیس‌ها، دیسک‌ها، دامنه‌ها،
  لاگ‌ها، رویدادها، پلن‌ها و اطلاعات حساب متصل را با ابزارهای allow-list‌شده
  بررسی می‌کند.
- **عیب‌یابی چندمرحله‌ای:** تنظیمات، وضعیت اجرا، لاگ‌ها و رویدادهای اخیر را کنار
  هم تحلیل می‌کند تا به یک تشخیص کاربردی برسد.
- **عملیات با تأیید کاربر:** پیش از هر عملیات نوشتنی پشتیبانی‌شده، نمای
  قبل/بعد را نشان می‌دهد و منتظر تأیید امضاشده و مخصوص همان کاربر می‌ماند.
  عملیات مخرب `DELETE` عمداً در دسترس نیست.
- **مسیریابی بهینهٔ مدل:** تا جای ممکن از قواعد قطعی استفاده می‌کند؛ درخواست‌های
  مبهم را به router سبک، پاسخ‌های عادی را به Luna Pro و استدلال پیچیده را به
  Gemini می‌سپارد.
- **رابط مناسب مکالمه:** Markdown، کد، جدول، لینک، منابع، روند اجرای ابزار و
  مصرف هر پاسخ را به‌صورت streaming در رابط فارسی، RTL و responsive نمایش
  می‌دهد.
- **ماندگاری محلی:** تاریخچهٔ redacted گفتگو را داخل مرورگر نگه می‌دارد و بعد
  از refresh بازیابی می‌کند؛ transcript گفتگو روی سرور ذخیره نمی‌شود.

### کاربردهای رایج

| درخواست شما | رفتار Liara Copilot |
|---|---|
| «چطور Next.js را امن روی لیارا deploy کنم؟» | مستندات رسمی را جست‌وجو می‌کند و پاسخ مرحله‌ای همراه با منبع می‌دهد. |
| «کدام برنامه‌های حساب من فعال‌اند؟» | اتصال حساب را درخواست می‌کند و سپس وضعیت واقعی برنامه‌ها را می‌خواند و خلاصه می‌کند. |
| «چرا API من خطای ۵۰۲ می‌دهد؟» | تنظیمات مرتبط، وضعیت استقرار، رویدادها و لاگ‌ها را برای یافتن علت بررسی می‌کند. |
| «مقدار `APP_PORT` را روی `3000` بگذار.» | پیش‌نمایش تغییر را آماده می‌کند و تا تأیید صریح شما هیچ تغییری نمی‌دهد. |
| یک پرسش ادامه‌دار | context مفید گفتگو را حفظ می‌کند و دادهٔ نامرتبط را دوباره ارسال نمی‌کند. |

### مسیریابی مدل‌ها

| نقش | مدل پیش‌فرض | زمان استفاده |
|---|---|---|
| Router | `deepseek/deepseek-v4-flash` | فقط وقتی قواعد تشخیص intent اطمینان کافی ندارند. |
| پاسخ | `openai/gpt-5.6-luna-pro` | پاسخ مستندات، خلاصه‌سازی و درخواست‌های عادی همراه با ابزار. |
| استدلال | `google/gemini-3.7-flash` | عیب‌یابی پیچیده و فرآیندهای چندمرحله‌ای. |

ابزارها و context هر درخواست به‌صورت پویا انتخاب می‌شوند. جست‌وجوی کلیدواژه‌ای
همیشه به‌صورت محلی در دسترس است؛ semantic retrieval فقط وقتی اجرا می‌شود که
اطمینان جست‌وجوی اولیه پایین باشد و حداکثر چهار منبع مرتبط وارد context مدل
می‌شوند.

### معماری

```text
رابط فارسی با پاسخ streaming
  → تشخیص intent با اولویت قواعد قطعی
  → DeepSeek برای routing / Luna Pro برای پاسخ / Gemini برای استدلال
  → جست‌وجوی مستندات رسمی یا مجموعه ابزار مشخص لیارا
       ├─ مستندات محلی: BM25 → E5 و RRF شرطی
       └─ کلاینت allow-list‌شدهٔ Liara Management API
  → خروجی redacted ابزارها + منابع + میزان مصرف
  → نگه‌داری محلی گفتگو در مرورگر
```

### اجرای محلی

پیش‌نیازها: Node.js 22+ و pnpm 9.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

مقادیر `LIARA_AI_BASE_URL`، `LIARA_AI_KEY`، `TOOL_APPROVAL_SECRET` و
`TOKEN_COOKIE_SECRET` را در `.env` تنظیم کنید. متغیرهای مشترک
`LIARA_API_TOKEN` و `LIARA_TEAM_ID` اختیاری‌اند و فقط برای توسعهٔ خصوصی یا
smoke test در نظر گرفته شده‌اند. کاربران نسخهٔ عمومی حساب خودشان را با جریان
session رمزنگاری‌شده متصل می‌کنند.

همهٔ تنظیمات و مقدارهای پیش‌فرض امن در [.env.example](.env.example) توضیح داده
شده‌اند.

### بررسی کیفیت

```bash
pnpm check       # lint + typecheck + unit/integration tests + production build
pnpm test:e2e    # desktop/mobile Chromium + streaming + keyboard + accessibility
```

برای smoke test فقط‌خواندنی Management API:

```bash
node scripts/test-liara-client.mjs
```

### استقرار و عملیات

نسخهٔ production یک endpoint مستقل از شبکه در `/api/health` دارد و deadline
سراسری، سقف فراخوانی مدل، محدودیت نرخ و هم‌زمانی، telemetry ساختاریافته، CSP و
HSTS را پیاده‌سازی می‌کند. telemetry فقط metadata عملیاتی، latency، میزان مصرف
مدل و هزینه را ثبت می‌کند؛ prompt، پاسخ، token حساب، cookie و authorization
header ثبت نمی‌شوند.

برای متغیرهای محیطی، ساخت semantic index، استقرار استاندارد، fallback مستقل و
بررسی‌های پس از انتشار، [راهنمای استقرار روی لیارا](docs/DEPLOYMENT.md) را ببینید.

### مرزهای امنیتی

- token حساب متصل در cookie رمزنگاری‌شدهٔ `HttpOnly` با عمر هشت ساعت نگه‌داری
  می‌شود و در اختیار JavaScript مرورگر یا context مدل قرار نمی‌گیرد.
- دسترسی به ابزارها برای هر intent با allow-list محدود می‌شود و خروجی ابزارها
  پیش از رسیدن به مدل یا مرورگر، کوچک و redacted می‌شود.
- هر عملیات نوشتنی پشتیبانی‌شده به پیش‌نمایش قبل/بعد، تأیید HMAC متصل به کاربر
  فعلی و تأیید صریح او نیاز دارد.
- rate limit، جلوگیری از replay تأیید و circuit state در استقرار تک-instance
  فعلی process-local هستند و پیش از scale افقی باید به store مشترک منتقل شوند.
- پس از تغییر snapshot مستندات محلی باید semantic index با دستور
  `node scripts/build-docs-index.mjs` دوباره ساخته شود.

### مستندات

- [یادداشت‌های معماری](docs/ARCHITECTURE-NOTES.md)
- [راهنمای استقرار](docs/DEPLOYMENT.md)
- [رفتار تأییدشدهٔ API لیارا](docs/VERIFIED-FACTS.md)
- [مشخصات محصول (انگلیسی)](docs/liara-agentic-assistant-product-spec-v2-en.md)
