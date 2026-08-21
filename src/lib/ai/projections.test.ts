import test from 'node:test';
import assert from 'node:assert/strict';

const { toApp, toDatabase } = (await import(
  new URL('projections.ts', import.meta.url).href
)) as typeof import('./projections');

test('database projection keeps DBaaS semantics instead of application fields', () => {
  const database = toDatabase({
    _id: 'database-1',
    hostname: 'orders-db',
    type: 'postgres',
    status: 'ACTIVE',
    scale: 1,
    planID: 'small-g2',
    network: { _id: 'network-1', name: 'private-net' },
    publicNetwork: true,
    internalPort: 5432,
    version: '18.4',
    created_at: '2026-08-21T00:00:00.000Z',
  });

  assert.equal(database.hostname, 'orders-db');
  assert.equal(database.engine, 'postgres');
  assert.equal(database.version, '18.4');
  assert.equal(database.network, 'private-net');
  assert.equal(database.publicNetwork, true);
  assert.equal(database.internalPort, 5432);
  assert.equal('name' in database, false);
  assert.equal('subdomain' in database, false);
});

test('database projection preserves DBaaS engines instead of coercing them to app platforms', () => {
  const cases = [
    ['postgresql', 'postgres'],
    ['mariadb', 'mariadb'],
    ['rabbitmq', 'rabbitmq'],
    ['elastic-search', 'elasticsearch'],
    ['ms_sql', 'mssql'],
    ['future-engine', 'unknown'],
  ] as const;

  for (const [type, expected] of cases) {
    const database = toDatabase({
      _id: `database-${type}`,
      hostname: `${type}-service`,
      type,
      status: 'ACTIVE',
      scale: 1,
      planID: 'small-g2',
      created_at: '2026-08-21T00:00:00.000Z',
    });

    assert.equal(database.engine, expected);
  }
});

test('application projection preserves deployed, undeployed, and unknown states', () => {
  const app = (isDeployed?: boolean) => toApp({
    _id: `app-${String(isDeployed)}`,
    project_id: `shop-${String(isDeployed)}`,
    type: 'node',
    status: 'ACTIVE',
    scale: 1,
    planID: 'small-g2',
    created_at: '2026-08-21T00:00:00.000Z',
    ...(isDeployed === undefined ? {} : { isDeployed }),
  });

  assert.equal(app(true).isDeployed, true);
  assert.equal(app(false).isDeployed, false);
  assert.equal(app(undefined).isDeployed, undefined);
});
