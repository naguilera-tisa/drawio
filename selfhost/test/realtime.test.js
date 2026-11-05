// Relay WebSocket /rt. No necesita base de datos: se usa un pool falso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { buildApp, defaults } from '../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let app, base;

before(async () => {
  const pool = { query: async () => ({ rows: [] }) };
  app = buildApp({ pool, drawioDir: path.resolve(here, '../../src/main/webapp'), ...defaults });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${app.server.address().port}/rt`;
});
after(async () => { await app?.close(); });

// Abre un cliente y guarda todos los frames recibidos; waitFor espera a uno.
function connect(channel) {
  const ws = new WebSocket(`${base}?id=${channel}&pv=7&av=1`);
  const frames = [];
  const waiters = [];
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    for (const w of [...waiters]) {
      if (w.pred(frame)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frame); }
    }
  });
  ws.waitFor = (action) => {
    const found = frames.find((f) => f.action === action);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout esperando ${action}`)), 2000);
      waiters.push({ pred: (f) => f.action === action, resolve: (f) => { clearTimeout(t); resolve(f); } });
    });
  };
  ws.frames = frames;
  return ws;
}
const closed = (ws) => new Promise((r) => ws.once('close', r));

test('clientsList, newClient y clientLeft', async () => {
  const a = connect('canal1');
  const listA = await a.waitFor('clientsList');
  assert.deepEqual(listA.msg.list, []);

  const b = connect('canal1');
  const listB = await b.waitFor('clientsList');
  assert.deepEqual(listB.msg.list, [listA.msg.cId]);
  assert.equal((await a.waitFor('newClient')).msg, listB.msg.cId);

  b.close();
  assert.equal((await a.waitFor('clientLeft')).msg, listB.msg.cId);
  a.close();
  await closed(a);
});

test('message llega al resto de la sala, no al emisor ni a otros canales', async () => {
  const a = connect('canal2');
  const b = connect('canal2');
  const other = connect('canal3');
  const cidA = (await a.waitFor('clientsList')).msg.cId;
  await b.waitFor('clientsList');
  await other.waitFor('clientsList');

  a.send(JSON.stringify({ action: 'message', msg: 'hola' }));
  const got = await b.waitFor('message');
  assert.equal(got.msg, 'hola');
  assert.equal(got.from, cidA);

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.frames.some((f) => f.action === 'message'), false);
  assert.equal(other.frames.some((f) => f.action === 'message'), false);
  for (const ws of [a, b, other]) ws.close();
});

test('sendSignal fija el remitente y avisa si el destino no existe', async () => {
  const a = connect('canal4');
  const b = connect('canal4');
  const cidA = (await a.waitFor('clientsList')).msg.cId;
  const cidB = (await b.waitFor('clientsList')).msg.cId;

  a.send(JSON.stringify({ action: 'sendSignal', msg: { to: cidB, from: 'suplantado', signal: { x: 1 } } }));
  const sig = await b.waitFor('signal');
  assert.equal(sig.msg.from, cidA);
  assert.deepEqual(sig.msg.signal, { x: 1 });

  a.send(JSON.stringify({ action: 'sendSignal', msg: { to: 'noexiste', signal: {} } }));
  assert.equal((await a.waitFor('sendSignalFailed')).msg.to, 'noexiste');
  for (const ws of [a, b]) ws.close();
});

test('rechaza canales inválidos', async () => {
  const ws = connect('mal canal!');
  const code = await new Promise((r) => ws.once('close', r));
  assert.equal(code, 1008);
});
