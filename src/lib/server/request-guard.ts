import { createHash } from "node:crypto";

type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();
const activeRequests = new Map<string, number>();
const MAX_BUCKETS = 5_000;

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || direct || "unknown";
  return value.slice(0, 128);
}

/** Opaque per-client key for concurrency guards; never expose the raw address. */
export function clientFingerprint(request: Request): string {
  return createHash("sha256")
    .update("liara-copilot:request-client:v1\0")
    .update(clientAddress(request))
    .digest("base64url")
    .slice(0, 20);
}

/** Browser mutations must come from the exact public origin, not a sibling site. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const allowed = new Set([new URL(request.url).origin]);
    const host =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host")?.trim();
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      new URL(request.url).protocol.replace(":", "");
    if (host && (protocol === "http" || protocol === "https")) {
      allowed.add(`${protocol}://${host}`);
    }
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function takeRateLimit(
  request: Request,
  namespace: string,
  limit: number,
  windowMs: number,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    while (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (typeof oldest !== "string") break;
      buckets.delete(oldest);
    }
  }

  const key = `${namespace}:${clientAddress(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }
  current.count += 1;
  return { allowed: true };
}

export function takeConcurrencySlot(
  key: string,
  maximum: number,
): (() => void) | null {
  const current = activeRequests.get(key) ?? 0;
  if (current >= maximum) return null;
  activeRequests.set(key, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeRequests.get(key) ?? 1) - 1;
    if (next <= 0) activeRequests.delete(key);
    else activeRequests.set(key, next);
  };
}

/**
 * Combine client cancellation with a server deadline that expires before the
 * platform's hard request limit. The caller's signal is never replaced.
 */
export function withRequestDeadline(
  parent: AbortSignal,
  timeoutMs: number,
): AbortSignal {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("request deadline must be a positive duration");
  }
  if (parent.aborted) return parent;
  return AbortSignal.any([parent, AbortSignal.timeout(Math.floor(timeoutMs))]);
}
