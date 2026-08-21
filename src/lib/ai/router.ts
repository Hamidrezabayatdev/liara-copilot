/**
 * Escalation router: decide how much machinery a message deserves.
 *
 * Spec §17 says deterministic-before-generative, so this tries a keyword pass
 * first and only pays for a model call when the keywords are genuinely
 * ambiguous. In practice most messages route for zero tokens, which is itself
 * part of the cost story we show the user.
 *
 * Asymmetry that drives the precedence order: under-escalating produces a
 * confidently wrong answer (bad), while over-escalating just costs a little
 * more (recoverable). So the diagnostic and write signals — which are
 * high-precision — win over the cheaper ones whenever both match.
 */
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { modelFor, type Tier, type UsageCollector } from './provider';

export type Level = 1 | 2 | 3;

export type RouteDecision = {
  escalation: Level;
  tier: Tier;
  /** cap for stopWhen: stepCountIs(...) */
  maxSteps: number;
  /** Persian text for the "چرا این مسیر؟" popover */
  routingReason: string;
  decidedBy: 'heuristic' | 'model' | 'continuity';
};

/**
 * Level 3, part A — a symptom that something is broken. These are never demoted:
 * "چرا اپم داون است" is diagnosis even though it is phrased as a question.
 */
const L3_FAILURE = [
'خطا','ارور','۵۰۲','502','500','503','504','۵۰۰','۵۰۳','crash','کرش','fail','شکست',
'نشد','داون','down','قطع شد','از کار افتاد','کار نمی','بالا نمی','ران نمی','لود نمی','باز نمی',
'timeout','تایم اوت','unhealthy','بی‌پاسخ','هنگ','چرا','عیب‌یابی','عیب یابی','دیباگ','debug',
'مشکل','ایراد','علت','ریشه','تشخیص','رفع','درست کن','fix','بررسی کن','چک کن',
];

/**
 * Level 3, part B — imperatives that change state.
 *
 * These ARE demoted when the message also carries a how-to frame, because
 * Persian first-person and infinitive forms contain the imperative as a
 * substring: «دیپلوی کنم» (how do *I* deploy) contains «دیپلوی کن» (deploy it!).
 * Rather than hand-build a morphological analyser for کن/کنم/کنید/کند, we use
 * the question frame as the disambiguator — which is what actually carries the
 * meaning: "چطور … ری‌استارت کنم؟" asks, "ری‌استارت کن" commands.
 */
const L3_WRITE = [
'ری‌استارت','ریستارت','restart','دیپلوی کن','دیپلوی مجدد','redeploy','rollback','رول‌بک',
'بازگردانی','برگردان','scale','اسکیل','replica','ست کن','تنظیم کن','ذخیره کن','اضافه کن',
'رکورد dns','حذف کن',
];

/** Decisive account-state phrasing: possessives and state/listing verbs. */
const L2_STRONG = [
'اپ من','اپ‌های من','اپ های من','برنامه‌های من','برنامه های من','پروژه‌های من','پروژه های من',
'حساب من','اپم','برنامه‌ام','وضعیت','status','مصرف','چند تا','چندتا','لیست اپ','فهرست اپ',
'مانیتور','متریک','metric','پلن من',
];

/**
 * Resource nouns. On their own these are too weak to force Level 2 — "قیمت دیسک
 * چند است؟" is a pricing question about disks, not a read of your disks. They
 * only escalate when paired with a possessive, a state verb, or a concrete
 * resource name.
 */
const L2_WEAK = [
'دیسک','دامنه','domain','دیتابیس','database','متغیر محیطی','متغیرهای محیطی','env','environment',
'لاگ','logs','منابع','ram','cpu','بکاپ','backup','بازدید','ترافیک',
];

/** Turns a weak resource noun into a real Level 2 read. */
const L2_ACTIVATORS = ['من','خودم','نشان بده','نمایش بده','ببین','بگو','چقدر','چند','فعلی','الان'];

/**
 * How-to / definition frames. Their presence means the user is asking *about*
 * the platform rather than asking us to touch it.
 */
const L1_FRAME = [
'چطور','چگونه','چیست','چیه','یعنی چه','یعنی چی','تفاوت','فرق','آیا','قیمت','تعرفه',
'راهنما','مستندات','docs','داکیومنت','میشود','می‌شود','آموزش','معرفی','توضیح بده',
'پشتیبانی می','امکان','بهتره','پیشنهاد',
];

/** Short replies that continue whatever we were already doing. */
const CONTINUATION = [
'بله','بلی','آره','اره','اوکی','ok','okay','باشه','حله','تایید','تأیید','yes','y',
'نه','خیر','no','ادامه بده','ادامه','انجام بده','برو','بعدی','همان','همون','درسته',
];

/** Pure continuity check used by the request agent without trusting metadata. */
export function isContinuationMessage(message: string): boolean {
  const text = normalize(message);
  return text.split(' ').filter(Boolean).length <= 4 && matched(text, CONTINUATION) !== null;
}

/** Looks like a Liara app/db name, e.g. `digishop-api`. Mentioning one implies state intent. */
const RESOURCE_NAME = /[a-z][a-z0-9]*-[a-z0-9-]+/;

/** Fold Persian orthographic variance so keyword matching is not defeated by ZWNJ. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u200c/g, ' ')  // ZWNJ → space (می‌شود ≈ می شود)
    .replace(/\u064A/g, '\u06CC')  // ي → ی
    .replace(/\u0643/g, '\u06A9')  // ك → ک
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Substring match on normalized text. Prefix matching is deliberate: Persian
 * suffixes mean «خطا» must still match «خطای», so we do NOT require a word
 * boundary on the right.
 */
function matched(haystack: string, signals: string[]): string | null {
  for (const s of signals) {
    if (haystack.includes(normalize(s))) return s;
  }
  return null;
}

const SETTINGS: Record<Level, { tier: Tier; maxSteps: number }> = {
  1: { tier: 'answer', maxSteps: 2 },
  2: { tier: 'answer', maxSteps: 5 },
  3: { tier: 'reason', maxSteps: 12 },
};

function decide(level: Level, reason: string, decidedBy: RouteDecision['decidedBy']): RouteDecision {
  return { escalation: level, ...SETTINGS[level], routingReason: reason, decidedBy };
}

/**
 * Route a message. `previousLevel` is the escalation of the last assistant turn;
 * pass it so that "بله، انجام بده" stays inside the troubleshooting session
 * instead of being re-classified as a trivial question.
 */
export async function route(
  message: string,
  opts: { previousLevel?: Level; collector: UsageCollector },
): Promise<RouteDecision> {
  const text = normalize(message);

  // 1. Continuity: a short confirmation inherits the conversation's level.
  if (opts.previousLevel && isContinuationMessage(message)) {
    return decide(
      opts.previousLevel,
      `پیام کوتاه و در ادامهٔ گفتگو است، پس همان سطح ${opts.previousLevel} قبلی حفظ شد (بدون هزینهٔ مسیریابی).`,
      'continuity',
    );
  }

  const frame = matched(text, L1_FRAME);

  // 2. A failure symptom always wins — something is actually broken.
  const failure = matched(text, L3_FAILURE);
  if (failure) {
    return decide(
      3,
      `نشانهٔ «${failure}» یعنی چیزی خراب است و باید ریشه‌یابی شود. مدل استدلالی + ابزارهای بازرسی. مسیریابی رایگان بود.`,
      'heuristic',
    );
  }

  // 3. A state-changing imperative — unless it is really a how-to question.
  const write = matched(text, L3_WRITE);
  if (write && !frame) {
    return decide(
      3,
      `«${write}» یک درخواست تغییر وضعیت است. هر عمل نوشتنی فقط با تأیید صریح شما و پس از نمایش تفاوت قبل/بعد اجرا می‌شود. مسیریابی رایگان بود.`,
      'heuristic',
    );
  }

  // 4. Decisive account-state phrasing.
  const strong = matched(text, L2_STRONG);
  if (strong) {
    return decide(
      2,
      `عبارت «${strong}» به وضعیت واقعی حساب شما اشاره دارد، پس ابزارهای فقط‌خواندنی با مدل ارزان اجرا می‌شوند. مسیریابی رایگان بود.`,
      'heuristic',
    );
  }

  // 5. A how-to frame with no account signal is the cheapest path.
  if (frame) {
    return decide(
      1,
      `«${frame}» یک پرسش عمومی/مستندات است و نیازی به دسترسی به حساب ندارد. ارزان‌ترین مسیر انتخاب شد. مسیریابی رایگان بود.`,
      'heuristic',
    );
  }

  // 6. A resource noun counts only when something makes it concrete.
  const weak = matched(text, L2_WEAK);
  if (weak && (matched(text, L2_ACTIVATORS) || RESOURCE_NAME.test(text))) {
    return decide(
      2,
      `«${weak}» به یک منبع مشخص در حساب شما اشاره دارد، پس با ابزارهای فقط‌خواندنی بررسی می‌شود. مسیریابی رایگان بود.`,
      'heuristic',
    );
  }

  // 3. Ambiguous: one cheap classification call.
  return classifyWithModel(message, opts.collector);
}

const CLASSIFY_SCHEMA = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)])
    .describe('1=general/docs question, 2=needs reading this account state, 3=troubleshooting or a state change'),
  reason: z.string().describe('یک جملهٔ کوتاه فارسی که دلیل انتخاب این سطح را توضیح دهد'),
});

async function classifyWithModel(
  message: string,
  collector: UsageCollector,
): Promise<RouteDecision> {
  try {
    const { output } = await generateText({
      model: modelFor('router', collector),
      output: Output.object({ schema: CLASSIFY_SCHEMA }),
      system:
        'تو یک مسیریاب هستی، نه پاسخ‌دهنده. پیام کاربر دربارهٔ پلتفرم ابری لیارا است. ' +
        'فقط سطح لازم را تعیین کن:\n' +
        '۱ = پرسش عمومی یا مستندات؛ بدون نیاز به دیدن حساب کاربر.\n' +
        '۲ = پاسخ به وضعیت واقعی حساب کاربر وابسته است (فهرست اپ‌ها، لاگ، متغیرها) اما فقط خواندن.\n' +
        '۳ = چیزی خراب است و باید ریشه‌یابی شود، یا کاربر می‌خواهد وضعیتی را تغییر دهد.\n' +
        'در تردید بین ۲ و ۳، سطح بالاتر را انتخاب کن. هرگز به سؤال پاسخ نده.',
      prompt: message,
    });
    const level = output.level as Level;
    return decide(
      level,
      `${output.reason} (کلیدواژهٔ قطعی پیدا نشد، پس یک فراخوانی کوتاه با مدل ارزان مسیر را تعیین کرد.)`,
      'model',
    );
  } catch {
    // Never fail a chat because routing failed. Level 2 is the safe middle:
    // it can read state, so it will not confidently invent an answer, and it
    // does not unlock writes.
    return decide(
      2,
      'مسیریابی خودکار ممکن نشد، پس سطح میانی (فقط‌خواندنی) به‌عنوان حالت مطمئن انتخاب شد.',
      'model',
    );
  }
}
