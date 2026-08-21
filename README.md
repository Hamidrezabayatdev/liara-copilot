# Liara Copilot

دستیار فارسی و RTL لیارا برای پاسخ مستند، مشاهدهٔ زندهٔ حساب و عیب‌یابی
چندمرحله‌ای—با مسیر مدل متناسب با سختی سؤال، ابزارهای محدود و عملیات قابل تأیید.

**نسخهٔ زنده:** [liara-copilot-ir.liara.run](https://liara-copilot-ir.liara.run)

## چرا این پروژه متفاوت است؟

- بدون اتصال حساب هم به پرسش‌های عمومی با جست‌وجوی ۱٬۱۲۵ صفحهٔ مستندات رسمی
  و citation پاسخ می‌دهد.
- برای دادهٔ واقعی، توکن کاربر فقط در cookie رمزنگاری‌شدهٔ `HttpOnly` با عمر
  هشت ساعت نگه‌داری می‌شود؛ هیچ credential در مرورگر، مدل یا log ذخیره نمی‌شود.
- بین سه مسیر هزینه/کیفیت انتخاب می‌کند: DeepSeek V4 Flash برای routing،
  GPT-5.6 Luna Pro برای پاسخ، و Gemini 3.7 Flash فقط برای reasoning پیچیده.
- ابزارها بر اساس intent محدود می‌شوند. هیچ API عمومی یا `DELETE` وجود ندارد و
  هر write برگشت‌پذیر به diff، امضای HMAC و تأیید صریح همان کاربر نیاز دارد.
- Markdown، code، table، لینک، منبع، مراحل ابزار و هزینه هنگام streaming با UI
  اختصاصی نمایش داده می‌شوند. اسکرول فقط وقتی کاربر پایین گفتگو است دنبال می‌شود.
- نتیجهٔ retrieval با افت واقعی score بریده می‌شود؛ حداکثر چهار منبع مرتبط وارد
  context می‌شوند و مسیر semantic فعال فقط برای queryهای کم‌اطمینان اجرا می‌شود.

## دموی دو دقیقه‌ای

| سناریو | پیام پیشنهادی | چیزی که باید ببینید |
|---|---|---|
| مستندات عمومی | `برای deploy امن Next.js روی لیارا چه تنظیماتی لازم است؟` | جست‌وجوی مستندات، Markdown و لینک رسمی؛ بدون نیاز به حساب |
| مشاهدهٔ حساب | `چه برنامه‌هایی در حساب من فعال‌اند؟` | پس از «اتصال حساب»، کارت‌های واقعی برنامه‌ها؛ بدون write |
| عیب‌یابی | `چرا digishop-api خطای ۵۰۲ می‌دهد؟` | Gemini وضعیت، log و env را بررسی و mismatch پورت ۳۰۰۱/۳۰۰۰ را پیدا می‌کند |
| عملیات امن | `APP_PORT را روی 3000 بگذار` | Before/After و پنجرهٔ تأیید؛ تا تأیید نکنید هیچ تغییری رخ نمی‌دهد |
| ماندگاری | یک گفتگو بسازید و صفحه را refresh کنید | turnهای کامل و جمع هزینه از IndexedDB برمی‌گردند |

ناوگان واقعی دمو نیز روی Liara فعال است:

- [digishop-front](https://digishop-front.liara.run) — کنترل سالم (`200`)
- [digishop-api](https://digishop-api.liara.run) — خطای عمدی mismatch پورت (`502`)
- `digishop-worker` — نسخهٔ موفق deploy شده و عمداً روی scale صفر متوقف است

## اجرای محلی

نیازمندی‌ها: Node.js 22+ و pnpm 9.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

مقادیر `LIARA_AI_BASE_URL`، `LIARA_AI_KEY`، `TOOL_APPROVAL_SECRET` و
`TOKEN_COOKIE_SECRET` را در `.env` تنظیم کنید. `LIARA_API_TOKEN` و
`LIARA_TEAM_ID` فقط برای smoke test یا دموی خصوصی لازم‌اند؛ production عمومی
به‌صورت پیش‌فرض credential مشترک را نادیده می‌گیرد. secretها را commit نکنید.

## بررسی کیفیت

```bash
pnpm check       # lint + typecheck + unit/integration tests + production build
pnpm test:e2e    # Chromium desktop/mobile + streaming + keyboard + WCAG A/AA
```

Smoke test فقط‌خواندنی client واقعی:

```bash
node scripts/test-liara-client.mjs
```

CI همین مجموعه را روی هر push و pull request اجرا و trace/screenshot شکست‌ها را
نگه‌داری می‌کند.

## معماری کوتاه

```text
Persian streaming UI
  → deterministic-first intent router
  → DeepSeek router / Luna Pro answer / Gemini reason
  → docs-only tools or an explicit Liara read/write capability set
       ├─ bundled official docs: BM25 → adaptive semantic RRF
       └─ allow-listed Liara management client
  → projected/redacted tool results + provenance + real Toman usage
  → browser-only conversation persistence
```

Production شامل `/api/health` بدون تماس شبکه، deadline سراسری ۱۱۰ ثانیه، سقف
فراخوانی مدل، rate/concurrency guard، request ID، CSP/HSTS و telemetry ساختاریافته
است. telemetry فقط metadata عملیاتی، مدل، token، latency و هزینه را ثبت می‌کند؛
prompt، پاسخ، token حساب و cookie هرگز log نمی‌شوند.

راهنمای تکرار deployment در [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)، تصمیم‌ها در
[docs/MASTER-PLAN.md](docs/MASTER-PLAN.md)، و واقعیت‌های API در
[docs/VERIFIED-FACTS.md](docs/VERIFIED-FACTS.md) قرار دارند.

## مرزهای صادقانه

- rate limit، replay guard و circuit state برای deployment تک-instance فعلی
  process-local هستند؛ قبل از scale افقی باید به store مشترک منتقل شوند.
- semantic index یک artifact تولیدشده است و بعد از تغییر snapshot مستندات باید
  پیش از deployment با `node scripts/build-docs-index.mjs` دوباره ساخته شود.
- تاریخچه browser-local است و همگام‌سازی بین دستگاه‌ها ندارد؛ با تغییر حساب پاک
  می‌شود و فقط نتیجه‌های redacted را ذخیره می‌کند.
