/**
 *   node --import ./scripts/register-ts.mjs --test src/lib/ai/capability.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { activeToolsFor, activeToolsForTurn, minLevelFor } = (await import(
  new URL('capability.ts', import.meta.url).href
)) as typeof import('./capability');

test('level one keeps the tiny documentation surface', () => {
  assert.deepEqual(activeToolsForTurn(1, 'لاگ اپ من را نشان بده'), ['searchDocs', 'askUser']);
});

test('an app request excludes unrelated account schemas', () => {
  const tools = activeToolsForTurn(2, 'لاگ اپ digishop-api را نشان بده');
  assert.ok(tools.includes('getAppLogs'));
  assert.ok(tools.includes('listApps'));
  assert.ok(tools.includes('searchDocs'));
  assert.ok(tools.includes('askUser'));
  assert.ok(!tools.includes('listDatabases'));
  assert.ok(!tools.includes('listBuckets'));
  assert.ok(!tools.includes('listDnsRecords'));
});

test('a database request exposes only its read family at level two', () => {
  const tools = activeToolsForTurn(2, 'وضعیت دیتابیس PostgreSQL من چیست؟');
  assert.ok(tools.includes('listDatabases'));
  assert.ok(tools.includes('getDatabase'));
  assert.ok(tools.includes('getPlans'));
  assert.ok(!tools.includes('getAppLogs'));
  assert.ok(!tools.includes('restartApp'));
});

test('the verdict presenter is available only on level-three narrowed turns', () => {
  assert.ok(!activeToolsForTurn(1, 'خطای دیتابیس').includes('reportDiagnosis'));
  assert.ok(!activeToolsForTurn(2, 'وضعیت دیتابیس').includes('reportDiagnosis'));
  assert.ok(
    activeToolsForTurn(3, 'چرا دیتابیس PostgreSQL خطا می‌دهد؟').includes(
      'reportDiagnosis',
    ),
  );
});

test('architecture intent keeps the cross-resource read surface', () => {
  const tools = activeToolsForTurn(2, 'برای معماری اپ من چه دیتابیسی پیشنهاد می‌دهی؟');
  assert.ok(tools.includes('listApps'));
  assert.ok(tools.includes('listDatabases'));
  assert.ok(tools.includes('listBuckets'));
  assert.ok(tools.includes('getPlans'));
});

test('multi-resource intent gets the union of relevant families', () => {
  const tools = activeToolsForTurn(3, 'رکورد DNS اپ digishop-api را درست کن');
  assert.ok(tools.includes('getApp'));
  assert.ok(tools.includes('restartApp'));
  assert.ok(tools.includes('reportDiagnosis'));
  assert.ok(tools.includes('listDnsRecords'));
  assert.ok(tools.includes('createDnsRecord'));
  assert.ok(!tools.includes('listDatabases'));
  assert.ok(tools.every((name) => minLevelFor(name) <= 3));
});

test('ambiguous and continuation messages preserve the full routed capability', () => {
  assert.deepEqual(activeToolsForTurn(2, 'وضعیت حساب من را بگو'), activeToolsFor(2));
  assert.deepEqual(activeToolsForTurn(3, 'بله، ادامه بده'), activeToolsFor(3));
});

test('latin substrings and bare hyphenated ids do not select the wrong family', () => {
  assert.deepEqual(
    activeToolsForTurn(2, 'What happened to my storage?'),
    activeToolsFor(2),
  );
  assert.deepEqual(activeToolsForTurn(2, 'وضعیت elastic-search من'), activeToolsFor(2));
  assert.deepEqual(activeToolsForTurn(2, 'وضعیت assets-prod من'), activeToolsFor(2));
});
