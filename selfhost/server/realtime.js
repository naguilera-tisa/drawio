import fastifyWebsocket from '@fastify/websocket';
import { randomBytes } from 'node:crypto';

// Relay WebSocket compatible con P2PCollab.js de drawio (DrawioFileSync.PROTOCOL 7).
// Una sala por canal (?id=). No interpreta los mensajes: reenvía lo que envía un
// cliente al resto de la sala. Sin clave de canal (getChannelKey() == null) el
// contenido viaja sin cifrar, lo mismo que ya pasa con el resto de la API.
//
// Cliente -> servidor: {action: 'message', msg} y {action: 'sendSignal', msg: {to, from, signal}}
// Servidor -> cliente: clientsList, newClient, clientLeft, message, signal, sendSignalFailed

const CHANNEL_RE = /^[A-Za-z0-9_\-.=]{1,512}$/;
const MAX_PAYLOAD = 2 * 1024 * 1024;
const HEARTBEAT_MS = 30_000;

export async function registerRealtime(app) {
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_PAYLOAD } });

  /** @type {Map<string, Map<string, import('ws').WebSocket>>} */
  const rooms = new Map();

  const send = (ws, payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };

  const newClientId = (room) => {
    let cid;
    do cid = randomBytes(6).toString('base64url');
    while (room.has(cid));
    return cid;
  };

  app.get('/rt', { websocket: true }, (ws, req) => {
    const channel = String(req.query.id ?? '');

    if (!CHANNEL_RE.test(channel)) {
      ws.close(1008, 'canal inválido');
      return;
    }

    let room = rooms.get(channel);
    if (!room) rooms.set(channel, (room = new Map()));

    const cid = newClientId(room);
    const others = [...room.keys()];
    room.set(cid, ws);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    send(ws, { action: 'admission', msg: {} });
    send(ws, { action: 'clientsList', msg: { cId: cid, list: others } });
    for (const other of others) send(room.get(other), { action: 'newClient', msg: cid });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;

      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (frame?.action === 'message') {
        for (const [otherId, other] of room) {
          if (otherId !== cid) send(other, { action: 'message', msg: frame.msg, from: cid });
        }
      } else if (frame?.action === 'sendSignal') {
        const target = room.get(String(frame.msg?.to));
        if (target && target !== ws) {
          // El remitente lo fija el servidor para que nadie suplante a otro cliente.
          send(target, { action: 'signal', msg: { from: cid, signal: frame.msg.signal } });
        } else {
          send(ws, { action: 'sendSignalFailed', msg: { to: frame.msg?.to } });
        }
      }
    });

    const leave = () => {
      if (room.get(cid) !== ws) return;
      room.delete(cid);
      for (const other of room.values()) send(other, { action: 'clientLeft', msg: cid });
      if (room.size === 0 && rooms.get(channel) === room) rooms.delete(channel);
    };
    ws.on('close', leave);
    ws.on('error', () => ws.terminate());
  });

  // Cierra las conexiones muertas (red caída, pestaña suspendida).
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room.values()) {
        if (!ws.isAlive) {
          ws.terminate();
        } else {
          ws.isAlive = false;
          ws.ping();
        }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const room of rooms.values()) for (const ws of room.values()) ws.terminate();
  });

  return { rooms };
}
