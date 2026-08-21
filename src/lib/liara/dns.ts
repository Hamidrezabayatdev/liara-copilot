/**
 * DNS operations.
 *
 * The one permitted write is creating a record — reversible because the record
 * can be removed from the Liara console, and because creating it does not
 * mutate anything that already existed. Updating (`PUT`) and deleting a record
 * are both denied: they overwrite or lose live configuration.
 */

import { fail, liaraFetch } from './client';
import {
  DNS_RECORD_TYPES,
  DNS_TTLS,
  type DnsRecord,
  type DnsRecordInput,
  type DnsRecordType,
  type LiaraCtx,
  type ToolResult,
  type Zone,
} from './types';

/** A DNS zone is a domain name; it must be safe as one URL path segment. */
const ZONE_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const RECORD_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** `@` for the zone root, `*` for a wildcard, otherwise RFC-1123 labels. */
const RECORD_NAME_RE = /^(@|\*|(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/;

function badZone(zone: unknown): string | null {
  if (typeof zone !== 'string' || !ZONE_RE.test(zone)) {
    return `invalid zone ${JSON.stringify(zone)} (expected a domain name like "example.com")`;
  }
  return null;
}

export function listZones(ctx: LiaraCtx): Promise<ToolResult<{ data?: Zone[]; zones?: Zone[] }>> {
  return liaraFetch('dns', 'GET', '/api/v1/zones', { ctx });
}

export function getZone(ctx: LiaraCtx, zone: string): Promise<ToolResult<unknown>> {
  const bad = badZone(zone);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('dns', 'GET', `/api/v1/zones/${zone}`, { ctx });
}

export function listDnsRecords(
  ctx: LiaraCtx,
  zone: string,
): Promise<ToolResult<{ data?: DnsRecord[]; status?: string }>> {
  const bad = badZone(zone);
  if (bad) return Promise.resolve(fail(bad));
  return liaraFetch('dns', 'GET', `/api/v1/zones/${zone}/dns-records`, { ctx });
}

export function getDnsRecord(
  ctx: LiaraCtx,
  zone: string,
  id: string,
): Promise<ToolResult<unknown>> {
  const bad = badZone(zone);
  if (bad) return Promise.resolve(fail(bad));
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) {
    return Promise.resolve(fail(`invalid dns record id ${JSON.stringify(id)}`));
  }
  return liaraFetch('dns', 'GET', `/api/v1/zones/${zone}/dns-records/${id}`, { ctx });
}

/**
 * Create a DNS record.
 *
 * Validated locally before the call so a bad TTL or record type is explained
 * in Persian-friendly terms instead of arriving as an opaque 400. Refuses to
 * create a record that would collide with an existing name+type, because
 * silently shadowing live DNS is not a reversible write.
 */
export async function createDnsRecord(
  ctx: LiaraCtx,
  zone: string,
  record: DnsRecordInput,
): Promise<ToolResult<{ created: DnsRecordInput; response: unknown }>> {
  const bad = badZone(zone);
  if (bad) return fail(bad);

  if (!record || typeof record !== 'object') return fail('record must be an object');

  const { name, type, ttl, contents } = record;
  if (typeof name !== 'string' || !RECORD_NAME_RE.test(name)) {
    return fail(`invalid record name ${JSON.stringify(name)} (use "@" for the zone root)`);
  }
  if (!DNS_RECORD_TYPES.includes(type as DnsRecordType)) {
    return fail(
      `invalid record type ${JSON.stringify(type)} (expected one of ${DNS_RECORD_TYPES.join(', ')})`,
    );
  }
  if (ttl !== undefined && !(DNS_TTLS as readonly number[]).includes(ttl)) {
    return fail(`invalid ttl ${JSON.stringify(ttl)} (expected one of ${DNS_TTLS.join(', ')})`);
  }
  if (!Array.isArray(contents) || contents.length === 0) {
    return fail('record.contents must be a non-empty array (its shape depends on the record type)');
  }
  for (const c of contents) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return fail('every entry in record.contents must be an object');
    }
  }

  const existing = await listDnsRecords(ctx, zone);
  if (!existing.ok) return existing;
  const rows = Array.isArray(existing.data?.data) ? existing.data.data : [];
  const collision = rows.find((r) => r?.name === name && r?.type === type);
  if (collision) {
    return fail(
      `a ${type} record named "${name}" already exists in ${zone} (id ${collision.id}). ` +
        `Changing an existing record is blocked at the tool layer — edit it in the Liara console.`,
    );
  }

  const body: Record<string, unknown> = { name, type, contents };
  if (ttl !== undefined) body.ttl = ttl;

  const res = await liaraFetch<unknown>('dns', 'POST', `/api/v1/zones/${zone}/dns-records`, {
    ctx,
    body,
  });
  if (!res.ok) return res;

  return {
    ok: true,
    data: { created: { name, type, ttl, contents }, response: res.data },
    source: 'account',
  };
}
