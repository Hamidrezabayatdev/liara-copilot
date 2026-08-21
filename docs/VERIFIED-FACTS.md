# VERIFIED FACTS — همه از API واقعی تأیید شده (2026-08-21)

> این فایل **منبع حقیقت** است. هیچ‌کدام از این مقادیر حدس نیست؛ همه با curl زنده تست شده‌اند.
> اگر چیزی در `docs/liara-agentic-assistant-product-spec-v2-en.md` با این فایل تناقض داشت، **این فایل برنده است**.

## 1. حساب

- کار روی **حساب تیمی «لیارا»** انجام می‌شود: `LIARA_TEAM_ID=<team-id>`
- نقش ما در تیم: **مدیر** — دسترسی `manage` + `create` روی project/database/zone/bucket/mailServer/vm/ai
- **هر فراخوانی management API باید `?teamID=$LIARA_TEAM_ID` داشته باشد.** بدون آن روی حساب شخصی می‌افتد (که خالی است).
- هر دو حساب در شروع کار **صفر پروژه** داشتند.

## 2. Management API

| product | base URL | تأیید |
|---|---|---|
| paas | `https://api.iran.liara.ir` | `GET /v1/projects` → 200 |
| dbaas | `https://api.iran.liara.ir` | همان host |
| dns | `https://dns-service.iran.liara.ir` | از OpenAPI |
| storage | `https://storage-service.iran.liara.ir` | از OpenAPI |

Auth: `Authorization: Bearer <token>`

### endpoint طلایی: `GET /v1/me?teamID=<id>`
یک فراخوانی، همه‌چیز را می‌دهد: `user`, `team` (+ نقش و مجوزها), `featureFlags`,
`databaseVersions`, `defaultDatabaseVersions`, و **کاتالوگ کامل پلن‌ها با قیمت**.
ابزار `scale`/`resize` باید planID را از همین‌جا validate کند — هاردکد نکنید.

### پلن‌های **موجود** (`available: true`, فقط region ایران) — قیمت **تومان بر ساعت**
```
projects:  small-g2 486.11 (0.5G/0.5cpu/5G disk) │ medium-g2 833.33 (1G/1cpu/10G)
           ir-small 972.22 │ standard-base-g2 1458.33 (2G/1cpu/20G) │ ir-medium 1666.66
           standard-plus-g2 2638.88 (4G/2cpu/40G) │ pro-g2 4583.33 (8G/4cpu/80G)
databases: small-g2 486.11 │ medium-g2 833.33 │ ir-small 972.22 │ standard-base-g2 1458.33
```
پلن‌های `free`, `nano`, `micro`, `small`, `medium`, `standard-1x` و همهٔ نسل‌های قدیمی
**`available: false`** هستند — ساختن اپ با آن‌ها شکست می‌خورد. **`small-g2` ارزان‌ترین گزینهٔ واقعی است.**

نسخه‌های پیش‌فرض DB: `postgres 18.4`, `mysql 9.0.1`, `mongodb 8.0.1-noble`, `redis 8.0.2`, `mariadb 12.0.2`

### ساخت اپ
`POST /v1/projects?teamID=<id>` با body: `{name, planID, platform, readOnlyRootFilesystem?, network?}`
پاسخ 409 = نام تکراری (نام اپ در کل لیارا یکتاست).

## 3. Liara AI — OpenAI-compatible

- **`LIARA_AI_BASE_URL=https://ai.liara.ir/api/<workspace-id>/v1`**
  این شکل را خودِ کاتالوگ در `endpoints[].route = /api/{workspaceID}/v1/chat/completions` اعلام می‌کند.
  (شکل `/api/v1/<wsid>` هم برای `/models` جواب داد، ولی به فرم بالا اعتماد می‌کنیم.)
- کلید AI به workspace **تیمی** `<workspace-name>` (`<workspace-id>`, پلن pro) تعلق دارد.
  workspace شخصی `hackaton` با این کلید **403** می‌دهد — از آن استفاده نکنید.
- کشف workspace: `GET https://ai.liara.ir/v1/workspaces` با token مدیریتی (نه کلید AI).
- کاتالوگ عمومی بدون workspace: `GET https://ai.liara.ir/v1/models` → 200. **۱۸۲ مدل.**

### مدل‌های انتخابی — همه در پلن تأیید شدند
| نقش | model id | ورودی $/M | خروجی $/M |
|---|---|---|---|
| router | `deepseek/deepseek-v4-flash` | 0.0826 | 0.1652 |
| answer | `openai/gpt-5.6-luna` | 0.20 | 1.20 |
| reasoning | `google/gemini-3.7-flash` | 0.375 | 1.875 |
| baseline مقایسه | `anthropic/claude-opus-5` | 5.00 | 25.00 |
| embedding | `intfloat/multilingual-e5-large` | — | — |

`deepseek-v4-flash`: context **1,048,576** و max completion 384,000.
`gpt-5.6-luna`: context **1,050,000** و max completion 128,000.
`gemini-3.7-flash`: context **1,048,576**، max completion 65,536 و
`input_cache_read` ده برابر ارزان‌تر از prompt عادی.

هر سه مدل فعال `tools`، `tool_choice`، `response_format`،
`structured_outputs`، `max_tokens`، `reasoning`، `reasoning_effort` و
`include_reasoning` را در کاتالوگ workspace اعلام می‌کنند.

بودجهٔ runtime نیز زنده تأیید شد: DeepSeek router با `reasoning:none`، Luna با
`none/low` و Gemini با `medium` همگی HTTP 200 و tool call معتبر برگرداندند.
سقف خروجی برنامه به‌ترتیب 256 برای router و 1,600/2,400/4,096 برای Level 1/2/3 است.

### ⭐ هزینهٔ واقعی تومان از خود provider می‌آید
`usage` در پاسخ chat completion این شکل است:
```json
{"prompt_tokens":29,"completion_tokens":80,"total_tokens":109,
 "cost":0.000160875,
 "total_cost_toman":41.802966562,
 "cost_details":{"upstream_inference_prompt_cost":1.0875e-05,
                 "upstream_inference_completions_cost":0.00015},
 "prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0},
 "completion_tokens_details":{"reasoning_tokens":62}}
```
**`total_cost_toman` را تخمین نزنید — بخوانید.** هیچ نرخ تبدیل USD→تومان لازم نیست.
در AI SDK این فیلدها در `providerMetadata` می‌آیند و باید به `UsageMeta.toman` نگاشت شوند.
`reasoning_tokens` هم موجود است (در تست ۶۲ از ۸۰ توکن خروجی، reasoning بود) — در badge نشان دهید.

tool calling با prompt فارسی در اولین تست کار کرد: `finish_reason: "tool_calls"`.

### قیمت‌گذاری مدل‌ها — از `GET /models` بخوانید، hardcode نکنید
`GET {LIARA_AI_BASE_URL}/models` برای هر مدل یک `pricing` برمی‌گرداند
(`prompt` و `completion` = **دلار به‌ازای هر توکن**، رشته‌ای). ۱۸۲ مدل.
همچنین `supported_parameters` (شامل `tools`)، `context_length`، و `endpoints[].route`.

| مدل | نقش | ورودی $/1M | خروجی $/1M | tools |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | router | 0.0826 | 0.1652 | ✅ |
| `openai/gpt-5.6-luna` | answer | 0.200 | 1.200 | ✅ |
| `google/gemini-3.7-flash` | reasoning | 0.375 | 1.875 | ✅ |
| `anthropic/claude-opus-5` | baseline مقایسه | 5.000 | 25.000 | ✅ |
| `intfloat/multilingual-e5-large` | embedding | 0.000 | 0.000 | — |

در مقایسه با Opus-5، ورودی router حدود **۶۰٫۵×**، ورودی answer **۲۵×** و
ورودی reason **۱۳٫۳×** ارزان‌تر است. چون نسبت خروجی‌ها متفاوت است، فوتر درصد
صرفه‌جویی را از tokenهای واقعی و قیمت زندهٔ کاتالوگ حساب می‌کند، نه یک نسبت ثابت.

### نرخ تبدیل USD→تومان را استخراج کنید، ثابت ننویسید
از هر پاسخ واقعی: `fx = total_cost_toman / cost`. روی نمونهٔ مشاهده‌شده
(`41.802966562 / 0.000160875`) ≈ **۲۵۹٬۸۴۷ تومان بر دلار**. این نرخ شناور است
(نمونهٔ داکیومنتِ آبان ۱۴۰۴ برابر ۱۱۹٬۸۵۷٫۵ بود) پس در کد باید از اولین پاسخ
واقعیِ هر session خودش را کالیبره کند.

### محدودیت نرخ
پلن میرزاخانی: **۱۰ request/s**. پلن تورینگ: ۱۰۰ request/s.

## 4. Docs corpus

- ۱۱۲۵ فایل `.md`، ۴٫۲۴ MB در `/tmp/liara-corpus/` — اسم فایل = مسیر URL با `/`→`__`
- خط اول هر فایل: `Original link: https://docs.liara.ir/<path>/` ⇒ citation دقیق بدون نگاشت دستی
- ⚠️ بعضی صفحات placeholder رندرنشدهٔ `{item}` دارند (جای لیست مدل/پلن) — برای model id به docs اعتماد نکنید، به `/v1/models` اعتماد کنید.
- جست‌وجوی خود لیارا (Meilisearch) فیلد `body` را index نمی‌کند ⇒ باید BM25 خودمان را بسازیم.

## 5. Deploy

- WebSocket/اتصال پایدار در PaaS پشتیبانی می‌شود ⇒ **SSE streaming بی‌خطر است**
- `liara.json`: `{"next":{"mirror":true},"port":3000}` — هرگز `app`/`platform` را داخلش نگذارید
- cron: `{"cron":["0 */8 * * * curl http://localhost:3000/api/docs/refresh"]}`، `$ROOT` در دسترس است
- filesystem بدون disk مونت‌شده ephemeral است

## 6. ⚠️ دستور ساخت اپ/دیتابیس — با آزمون‌وخطا کشف شد

ساخت اپ **سه** فیلد دارد که در OpenAPI اصلاً مستند نشده‌اند. ترتیب validation باعث می‌شود
خطاها یکی‌یکی رو شوند. ترکیب درست:

```jsonc
POST /v1/projects?teamID=<TEAM>
{
  "name": "digishop-api",
  "planID": "small-g2",        // ✅ کار می‌کند
  "platform": "node",
  "network": "<network-id>",  // ← **id** لازم است نه name
  "bundlePlanID": "basic"      // ⚠️ کلید ماجرا
}
```

**نکتهٔ اصلی: `bundlePlanID` تعیین می‌کند کدام نسل compute در دسترس باشد.**
- `bundlePlanID: "free"` ⇒ هم `g1_plan_unavailable` هم `g2_plan_unavailable` — هیچ پلنی ساخته نمی‌شود
- `bundlePlanID: "basic"` + `planID: "small-g2"` ⇒ **موفق**
- `bundlePlanID: "basic"` + پلن g1 مثل `ir-small` ⇒ همچنان `g1_plan_unavailable` (نسل ۱ بسته است)

⇒ **همیشه `small-g2` + `basic` استفاده کنید.** فیلد `available: true` در `/v1/me`
قابل اعتماد نیست؛ `ir-small` را available نشان می‌دهد ولی ساختش شکست می‌خورد.

خطاهای دیگر: `"region" is not allowed` · `Invalid network id` (نام دادید نه id) ·
`409 Project exists` (نام اپ در **کل لیارا** یکتاست، نه فقط حساب شما — `shop-api`،
`shop-front`، `liara-copilot` همه گرفته شده‌اند)

### network اجباری است و باید اول ساخته شود
```
POST /v1/networks?teamID=<TEAM>   body: {"networkName":"copilot-net"}   → 201 {network:{_id}}
```
فیلد `name` نیست، `networkName` است.

### دیتابیس — همان الگو
```jsonc
POST /v1/databases?teamID=<TEAM>
{"hostname":"digishop-db","type":"postgres","planID":"small-g2",
 "version":"18.4","bundlePlanID":"basic","network":"<netId>"}
```

### `POST /v2/projects` وجود ندارد (404). ساخت فقط v1 است.

## 7. وضعیت فعلی زیرساخت (ساخته شد ✅)

network: `copilot-net` = `<network-id>`

| نام | platform | plan | نقش در دمو |
|---|---|---|---|
| `liara-copilot-ir` | next | small-g2 | **خود محصول** — اینجا deploy می‌شود |
| `digishop-front` | static | small-g2 | اپ سالم (کنترل) |
| `digishop-api` | node | small-g2 | باید **۵۰۲** شود (port اشتباه) |
| `digishop-worker` | node | small-g2 | باید **متوقف** شود (scale 0) |
| `digishop-db` | postgres 18.4 | small-g2 | DEPLOYED — برای توصیهٔ معماری |

همه `status=ACTIVE`, `scale=1`. هنوز کدی deploy نشده.
