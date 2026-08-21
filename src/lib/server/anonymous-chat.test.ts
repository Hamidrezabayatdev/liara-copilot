import assert from 'node:assert/strict';
import test from 'node:test';

const { clearlyNeedsLiaraAccount } = (await import(
  new URL('anonymous-chat.ts', import.meta.url).href
)) as typeof import('./anonymous-chat');

test('recognizes obvious personal and live-account requests', () => {
  assert.equal(clearlyNeedsLiaraAccount('وضعیت اپ من چیه؟'), true);
  assert.equal(clearlyNeedsLiaraAccount('لیست اپ‌ها را نشان بده'), true);
  assert.equal(clearlyNeedsLiaraAccount('show my app logs'), true);
  assert.equal(clearlyNeedsLiaraAccount('list databases'), true);
});

test('keeps general how-to and documentation questions public', () => {
  assert.equal(clearlyNeedsLiaraAccount('چطور لاگ اپ را ببینم؟'), false);
  assert.equal(clearlyNeedsLiaraAccount('راهنمای ریستارت برنامه در لیارا'), false);
  assert.equal(clearlyNeedsLiaraAccount('How do deployments work?'), false);
  assert.equal(clearlyNeedsLiaraAccount('Object Storage چیست؟'), false);
});

test('personal wording wins even when phrased as a how-to question', () => {
  assert.equal(clearlyNeedsLiaraAccount('چطور لاگ‌های اپم را ببینم؟'), true);
  assert.equal(clearlyNeedsLiaraAccount('How can I inspect my database?'), true);
});
