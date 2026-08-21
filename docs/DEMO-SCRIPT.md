# Judge demo script

## 1. Cheap, grounded answer

بدون اتصال حساب بپرسید:

> برای Health Check برنامه Next.js روی لیارا چه تنظیماتی لازم است؟ منبع رسمی بده.

باز کنید: مراحل retrieval، منبع رسمی، پاسخ Markdown و نوار هزینه. توضیح دهید فقط
در صورت ابهام router مدل فراخوانی می‌شود و حداکثر چهار منبع تا افت score وارد
context می‌شوند.

## 2. Real multi-step diagnosis

حساب تیم را از «اتصال حساب» متصل کنید و بپرسید:

> چرا digishop-api خطای ۵۰۲ می‌دهد؟ علت را از وضعیت و لاگ‌ها بررسی کن و قدم بعدی امن پیشنهاد بده.

Agent باید `getApp`، `getAppLogs`، env و docs را بررسی کند، رویداد
`PORT_MISMATCH` را نشان دهد و `APP_PORT: 3001 → 3000` را پیشنهاد کند. روی مرحلهٔ
تأیید مکث کنید: این همان مرز agentic/security است. برای حفظ سناریوی داوری تغییر
را اعمال نکنید، یا پس از نمایش موفق آن را به `3001` برگردانید.

## 3. UX and production finish

- یک source group و یک tool group را باز و بسته کنید.
- Markdown code، copy، theme، mobile width و دکمهٔ «جدیدترین پاسخ» را نشان دهید.
- footer هر پیام را باز کنید: مدل واقعی، token، Toman، latency و درصد صرفه‌جویی.
- `/api/health` و structured telemetry را کوتاه نشان دهید؛ هیچ prompt یا secret
  در log وجود ندارد.
