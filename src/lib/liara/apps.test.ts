import assert from 'node:assert/strict';
import test from 'node:test';

const { decodeV2LogGroups } = (await import(
  new URL('apps.ts', import.meta.url).href
)) as typeof import('./apps');

test('v2 grouped logs decode, sort, and ignore malformed rows', () => {
  const rows = decodeV2LogGroups({
    data: [
      {
        metaData: { releaseId: 'release-1' },
        values: [
          [
            '1787330999325971400',
            JSON.stringify({ type: 'stderr', _entry: 'PORT_MISMATCH' }),
          ],
          ['bad timestamp', JSON.stringify({ type: 'stdout', _entry: 'still useful' })],
          ['1787330999000000000', '{not-json'],
          [
            '1787330939278481049',
            JSON.stringify({ type: 'stdout', _entry: 'server starting' }),
          ],
        ],
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      type: 'stdout',
      datetime: '2026-08-21T16:48:59.278Z',
      message: 'server starting',
    },
    {
      type: 'stderr',
      datetime: '2026-08-21T16:49:59.325Z',
      message: 'PORT_MISMATCH',
    },
    {
      type: 'stdout',
      datetime: undefined,
      message: 'still useful',
    },
  ]);
});

test('v2 log decoder fails closed on an unknown payload shape', () => {
  assert.deepEqual(decodeV2LogGroups(undefined), []);
  assert.deepEqual(decodeV2LogGroups({ data: { values: [] } }), []);
});
