const PERSIAN_VARIANTS = /[\u064a\u0649]/g;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(PERSIAN_VARIANTS, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const OWNED_RESOURCE =
  /(?:حساب|اکانت|اپ(?:لیکیشن)?|برنامه|پروژه|سرویس|دیتابیس|پایگاه داده|باکت|دامنه)(?:ها|های)?(?:(?:م|مون|مان|ام)(?=\s|$|[؟?!،,.])|\s+(?:من|ما)(?=\s|$|[؟?!،,.]))|\b(?:my|our)\s+(?:account|apps?|projects?|services?|databases?|buckets?|domains?)\b/i;

const INSTRUCTIONAL =
  /(?:چطور|چگونه|راهنما|مستندات|آموزش|روش)|\b(?:how|docs?|guide|tutorial)\b/i;

const DIRECT_ACCOUNT_COMMAND =
  /(?:لیست|فهرست)\s+(?:اپ|برنامه|پروژه|سرویس|دیتابیس|پایگاه داده|باکت)|(?:لاگ|متریک|وضعیت|ریلیز|متغیرهای? محیطی).{0,40}(?:بده|نشان بده|بررسی کن|چک کن|بگیر)|\b(?:list|show|inspect|check|restart|scale|rollback)\s+(?:the\s+)?(?:apps?|projects?|services?|databases?|buckets?|releases?|logs?|metrics?)\b/i;

/**
 * Catch only obvious live-account requests. Ambiguous questions continue into
 * docs-only mode, whose system instruction independently forbids guessing.
 */
export function clearlyNeedsLiaraAccount(userText: string): boolean {
  const text = normalize(userText);
  if (OWNED_RESOURCE.test(text)) return true;
  if (INSTRUCTIONAL.test(text)) return false;
  return DIRECT_ACCOUNT_COMMAND.test(text);
}

export const ANONYMOUS_DOCS_INSTRUCTIONS =
  'این نشست به حساب لیارا متصل نیست و فقط ابزار searchDocs در دسترس است. ' +
  'برای پرسش عمومی فقط بر پایهٔ مستندات رسمی پاسخ بده. اگر پاسخ به منابع، وضعیت، ' +
  'لاگ‌ها یا عملیات حساب کاربر وابسته است، روشن و کوتاه بگو اتصال حساب لازم است؛ ' +
  'هیچ نام، مقدار یا وضعیت حسابی را حدس نزن.';
