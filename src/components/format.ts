/**
 * Formatting helpers shared by the domain components.
 *
 * Rules encoded here:
 *  - digits stay Latin everywhere (IDs, ports, byte counts and money read wrong
 *    in Persian digits inside a developer console),
 *  - dates render in the Jalali calendar with Latin digits, pinned to
 *    Asia/Tehran so server and client render identically,
 *  - technical vocabulary stays English (deploy / build / release / env).
 */

const TZ = "Asia/Tehran";

const numberFmt = new Intl.NumberFormat("en-US");
const jalaliDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TZ,
});
const jalaliDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: TZ,
});
const clockFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: TZ,
});

/** `1234567` → `1,234,567` (Latin digits, grouped). */
export function formatInt(value: number): string {
  return numberFmt.format(Math.round(value));
}

/** Compact decimal: keeps 1–2 meaningful digits, never scientific notation. */
export function formatDecimal(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

/**
 * Toman amounts come straight from Liara AI (`usage.total_cost_toman`) and are
 * never re-derived from USD. Sub-Toman values keep two decimals so a cheap
 * request does not collapse to `0`.
 */
export function formatToman(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 1) return formatDecimal(value, 3);
  if (Math.abs(value) < 1000) return formatDecimal(value, 1);
  return formatInt(value);
}

/** `1536` → `1.5K`, `2_400_000` → `2.4M`. Used for token counts. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return formatInt(value);
  if (Math.abs(value) < 1_000_000) return `${formatDecimal(value / 1000, 1)}K`;
  return `${formatDecimal(value / 1_000_000, 2)}M`;
}

/** Byte counts with binary units, Latin digits. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${formatDecimal(v, v < 10 ? 1 : 0)} ${units[i]}`;
}

/** `1240` → `1.24s`, `72_500` → `1m 12s`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${formatInt(ms)}ms`;
  if (ms < 60_000) return `${formatDecimal(ms / 1000, ms < 10_000 ? 2 : 1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Jalali date + 24h clock, e.g. `30 مرداد 1405، 12:44`. */
export function formatDateTimeFa(input: string | number | Date): string {
  return jalaliDateTime.format(new Date(input));
}

/** Jalali date only, e.g. `30 مرداد 1405`. */
export function formatDateFa(input: string | number | Date): string {
  return jalaliDate.format(new Date(input));
}

/** `12:44:03` — for log gutters, always Latin/LTR. */
export function formatClock(input: string | number | Date): string {
  return clockFmt.format(new Date(input));
}

const RELATIVE_UNITS: Array<[limit: number, divisor: number, label: string]> = [
  [60_000, 1000, "ثانیه"],
  [3_600_000, 60_000, "دقیقه"],
  [86_400_000, 3_600_000, "ساعت"],
  [2_592_000_000, 86_400_000, "روز"],
];

/**
 * Persian relative time with Latin digits: `4 دقیقه پیش`.
 * `now` is injectable so callers can render deterministically (SSR-safe).
 */
export function formatRelativeFa(
  input: string | number | Date,
  now: string | number | Date = Date.now(),
): string {
  const delta = new Date(now).getTime() - new Date(input).getTime();
  const abs = Math.abs(delta);
  if (abs < 10_000) return "همین حالا";
  for (const [limit, divisor, label] of RELATIVE_UNITS) {
    if (abs < limit) {
      const n = Math.max(1, Math.floor(abs / divisor));
      return delta >= 0 ? `${n} ${label} پیش` : `${n} ${label} بعد`;
    }
  }
  return formatDateFa(input);
}

/** Percentage with a single decimal at most: `37.4٪`. */
export function formatPercent(value: number, fractionDigits = 1): string {
  return `${formatDecimal(value, fractionDigits)}٪`;
}
