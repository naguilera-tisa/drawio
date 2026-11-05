// Requiere una BD Postgres accesible vía TEST_DATABASE_URL (o DATABASE_URL).
//   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=t postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:t@localhost:5433/postgres npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '../server/db.js';
import { buildApp, defaults } from '../server/app.js';

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = !url && 'TEST_DATABASE_URL no definida';
const here = path.dirname(fileURLToPath(import.meta.url));

let pool, app;
before(async () => {
  if (skip) return;
  pool = createPool(url);
  await migrate(pool);
  app = buildApp({ pool, drawioDir: path.resolve(here, '../../src/main/webapp'), ...defaults });
  await app.ready();
});
after(async () => { await app?.close(); await pool?.end(); });

const call = (method, u, payload) => app.inject({ method, url: u, payload });

test('CRUD, versionado y conflicto', { skip }, async () => {
  const created = (await call('POST', '/api/diagrams', { title: 'T1', xml: '<a/>' })).json();
  assert.equal(created.version, 1);

  const ok = await call('PUT', `/api/diagrams/${created.id}`, { xml: '<b/>', version: 1 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().version, 2);

  const stale = await call('PUT', `/api/diagrams/${created.id}`, { xml: '<c/>', version: 1 });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.xml, '<b/>');

  const versions = (await call('GET', `/api/diagrams/${created.id}/versions`)).json();
  assert.equal(versions.length, 1);

  const list = (await call('GET', '/api/diagrams?q=T1')).json();
  assert.ok(list.items.some((d) => d.id === created.id));

  assert.equal((await call('DELETE', `/api/diagrams/${created.id}`)).statusCode, 204);
  assert.equal((await call('GET', `/api/diagrams/${created.id}`)).statusCode, 404);
});

test('validaciones', { skip }, async () => {
  assert.equal((await call('GET', '/api/diagrams/no-es-uuid')).statusCode, 400);
  const d = (await call('POST', '/api/diagrams', {})).json();
  assert.equal(d.title, 'Sin título');
  assert.equal((await call('PUT', `/api/diagrams/${d.id}`, { xml: 'x' })).statusCode, 400);
});

test('PreConfig self-hosted y sin service worker', { skip }, async () => {
  const pre = await call('GET', '/drawio/js/PreConfig.js');
  assert.match(pre.body, /DRAWIO_LOG_URL = ''/);
  assert.equal((await call('GET', '/drawio/service-worker.js')).statusCode, 404);
  assert.equal((await call('GET', '/drawio/index.html')).statusCode, 200);
});
