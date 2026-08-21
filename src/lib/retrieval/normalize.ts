/**
 * Persian normalization, applied identically at index time and query time.
 *
 * The load-bearing case is ZWNJ (U+200C). Persian writes `می‌شود` with a
 * zero-width non-joiner; users type `میشود` without one. Same word, different
 * bytes. ZWNJ is *deleted* rather than turned into a space, which collapses both
 * spellings onto the single token `میشود` — and because the keyword index
 * searches by prefix, a query of `می شود` still reaches it through `می`. Mapping
 * ZWNJ to a space instead would index `می` + `شود` and then fail outright on the
 * far more common typed form, which is the worse direction to be wrong in.
 *
 * Arabic-vs-Persian letter folding matters for the same reason: `ي`/`ك` (Arabic)
 * and `ی`/`ک` (Persian) are visually near-identical and mixed freely in real
 * text, including inside Liara's own docs.
 */

const ZWNJ = /‌/g;
/** Tashkeel and Quranic marks, which carry no search signal. */
const DIACRITICS = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;

/** Arabic-Indic (٠-٩) and extended Persian (۰-۹) digits, in codepoint order. */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

const LETTER_FOLD: Record<string, string> = {
  'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه',
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  'ؤ': 'و', 'ئ': 'ی', 'ى': 'ی',
};

export function normalizeFa(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC');

  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else {
      out += LETTER_FOLD[ch] ?? ch;
    }
  }
  s = out;

  return s
    .replace(ZWNJ, '')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits on anything that is not a letter or digit. `.`, `-` and `_` are kept
 * inside a token so `Node.js`, `digishop-api` and `DATABASE_URL` survive as one
 * term each — they are exactly the strings users search for.
 */
const TOKEN_SPLIT = /[^\p{L}\p{N}._-]+/u;

export function tokenizeFa(input: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeFa(input).split(TOKEN_SPLIT)) {
    const t = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (!t) continue;
    out.push(t);
    // A compound identifier is also emitted glued and in pieces, symmetrically
    // at index and query time. The docs title their Node.js page "NodeJS" while
    // users type "Node.js"; the same trick lets `digishop-api` be found by
    // `digishop`, and `DATABASE_URL` by `database`.
    if (/[._-]/.test(t)) {
      const glued = t.replace(/[._-]/g, '');
      if (glued.length >= 3) out.push(glued);
      for (const part of t.split(/[._-]+/)) {
        if (part.length >= 3) out.push(part);
      }
    }
  }
  return out;
}

/**
 * Query-side vocabulary bridge, for the cases where the user's Persian and the
 * docs' Persian are simply different words.
 *
 * This is not decoration: `دیپلوی` — the transliteration everyone actually
 * types — appears in exactly zero of the 1125 bundled docs, which all say
 * `استقرار`. No amount of tuning fixes a term that is not in the corpus, and a
 * hand-written map of a dozen entries fixes it for free, before spending a
 * single token on embeddings.
 *
 * Expansion is one-directional and query-only: adding `استقرار` to a query
 * cannot hurt a document that already matched on `دیپلوی`, because terms combine
 * with OR.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  // Vocabulary the docs never use.
  'دیپلوی': ['استقرار', 'deploy'],
  'دپلوی': ['استقرار', 'deploy'],
  'deploy': ['استقرار'],
  'اپ': ['برنامه', 'اپلیکیشن'],
  'اپلیکیشن': ['برنامه'],
  'app': ['برنامه', 'اپلیکیشن'],
  'ریاستارت': ['ریاستارت', 'راهاندازی', 'restart'],
  'restart': ['ریاستارت', 'راهاندازی'],
  'داون': ['خطا', 'قطع', 'down'],
  'اسکیل': ['مقیاس', 'scale'],
  'scale': ['مقیاس'],
  'بکاپ': ['پشتیبان', 'backup'],
  'backup': ['پشتیبان'],
  'لاگ': ['لاگ', 'log'],
  'ورژن': ['نسخه'],
  'کانفیگ': ['تنظیمات', 'config'],
  'ساب‌دامین': ['زیردامنه', 'subdomain'],
  'سابدامین': ['زیردامنه', 'subdomain'],
  'قیمت': ['تعرفه', 'هزینه', 'پلن'],
  'هزینه': ['تعرفه', 'قیمت', 'پلن'],
  'پلن': ['تعرفه', 'پلن'],
};

/** Returns the query's own terms plus any bridging synonyms, de-duplicated. */
export function expandQuery(query: string): string[] {
  const terms = tokenizeFa(query);
  const seen = new Set(terms);
  for (const t of terms) {
    for (const syn of SYNONYMS[t] ?? []) {
      for (const s of tokenizeFa(syn)) seen.add(s);
    }
  }
  return [...seen];
}

/**
 * Persian function words. Deliberately excludes technical vocabulary that looks
 * like filler but is the whole query — `اپ`, `خطا`, `دیپلوی`, `پلن`, `کن` stay
 * searchable. Stored already-normalized so the filter can compare directly.
 */
export const FA_STOPWORDS: ReadonlySet<string> = new Set(
  [
    'از', 'به', 'در', 'که', 'را', 'با', 'بر', 'بی', 'تا', 'و', 'یا', 'هم', 'نیز',
    'این', 'آن', 'همان', 'چنین', 'همین', 'هر', 'همه', 'برخی', 'بعضی', 'دیگر',
    'برای', 'درباره', 'روی', 'زیر', 'بالای', 'بین', 'مثل', 'مانند', 'طبق', 'توسط',
    'است', 'هست', 'بود', 'باشد', 'بودن', 'شد', 'شود', 'شده', 'کرد', 'کردن', 'کرده',
    'دارد', 'داشت', 'دارند', 'دارم', 'می', 'نمی', 'ام', 'ای', 'اید', 'اند', 'ات',
    'ها', 'های', 'هایی', 'یی', 'تر', 'ترین',
    'اگر', 'چون', 'زیرا', 'ولی', 'اما', 'پس', 'سپس', 'وقتی', 'هنگام', 'گاه',
    'خیلی', 'بسیار', 'کمی', 'فقط', 'حتی', 'باید', 'نباید', 'شاید', 'البته',
    // Interrogatives and auxiliaries. These are strong *routing* signals (see
    // src/lib/ai/router.ts) but pure noise for retrieval: docs.liara.ir has a
    // page of FAQ headings that otherwise wins every «چطور … کنم» query.
    'چطور', 'چگونه', 'چرا', 'چه', 'چند', 'کجا', 'کی', 'آیا', 'کدام', 'چیست',
    'میتوانم', 'میتوان', 'میتوانید', 'بتوانم', 'بتوان', 'کنم', 'کنید', 'کند',
    'کنیم', 'کنند', 'شوم', 'شوید', 'دهم', 'دهید', 'بدهم', 'بگیرم', 'how', 'what',
    'من', 'تو', 'او', 'ما', 'شما', 'ایشان', 'خود', 'خودم', 'خودت',
    'یک', 'دو', 'چند', 'اول', 'آخر',
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'and', 'or', 'for', 'on', 'with',
  ].map(normalizeFa),
);

/** Index/query term filter: normalized, non-stopword, at least two characters. */
export function keepTerm(term: string): boolean {
  return term.length >= 2 && !FA_STOPWORDS.has(term);
}
