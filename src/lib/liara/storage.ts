/**
 * Object-storage operations. READ ONLY.
 *
 * Nothing here writes: bucket deletion and object deletion are DELETEs, making
 * a bucket public exposes data, and key creation/revocation hands out or
 * destroys credentials. All are denied in `allowlist.ts`.
 *
 * The access-key endpoints are also excluded from the READ allow-list — they
 * return secrets, which must never enter the model context.
 */

import { fail, liaraFetch } from './client';
import type { Bucket, LiaraCtx, ToolResult } from './types';

const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;

function badBucket(name: unknown): string | null {
  if (typeof name !== 'string' || !BUCKET_RE.test(name)) {
    return `invalid bucket name ${JSON.stringify(name)}`;
  }
  return null;
}

export function listBuckets(
  ctx: LiaraCtx,
): Promise<ToolResult<{ buckets?: Bucket[]; data?: Bucket[]; status?: string }>> {
  return liaraFetch('storage', 'GET', '/api/v1/buckets', { ctx });
}

export function getBucket(ctx: LiaraCtx, bucket: string): Promise<ToolResult<unknown>> {
  const bad = badBucket(bucket);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('storage', 'GET', `/api/v1/buckets/${bucket}`, { ctx });
}

export function getBucketMetrics(ctx: LiaraCtx, bucket: string): Promise<ToolResult<unknown>> {
  const bad = badBucket(bucket);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('storage', 'GET', `/api/v1/buckets/${bucket}/metrics/summary`, { ctx });
}

export function getBucketHistoricalMetrics(
  ctx: LiaraCtx,
  bucket: string,
): Promise<ToolResult<unknown>> {
  const bad = badBucket(bucket);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('storage', 'GET', `/api/v1/buckets/${bucket}/metrics/historical`, { ctx });
}
