import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRealtime } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Máximo de miniatura guardada (data URL de SVG/PNG), en caracteres.
const MAX_THUMBNAIL = 500_000;
// Máximo de versiones históricas conservadas por diagrama.
const MAX_VERSIONS = 50;

const LIST_COLUMNS = 'id, title, thumbnail, version, created_at, updated_at';

// Ventana mínima entre dos versiones históricas del mismo diagrama (ms).
const DEFAULT_VERSION_INTERVAL_MS = Number(process.env.VERSION_INTERVAL_MS ?? 5 * 60_000);

export function buildApp({
  pool, drawioDir, publicDir, preConfigFile, logger = false,
  versionIntervalMs = DEFAULT_VERSION_INTERVAL_MS,
}) {
  const app = Fastify({ logger, bodyLimit: 20 * 1024 * 1024 });

  // ---------- API ----------
  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  const checkId = (req, reply) => {
    if (!UUID_RE.test(req.params.id)) {
      reply.code(400).send({ error: 'id inválido' });
      return false;
    }
    return true;
  };

  app.get('/api/diagrams', async (req) => {
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size, 10) || 24));
    const params = [];
    let where = 'deleted_at IS NULL';
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where += ` AND title ILIKE $${params.length}`;
    }
    const total = (await pool.query(`SELECT count(*)::int AS n FROM diagrams WHERE ${where}`, params)).rows[0].n;
    params.push(size, (page - 1) * size);
    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM diagrams WHERE ${where}
       ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows, total, page, size };
  });

  app.post('/api/diagrams', async (req, reply) => {
    const { title, xml } = req.body ?? {};
    const { rows } = await pool.query(
      `INSERT INTO diagrams (title, xml) VALUES ($1, $2) RETURNING *`,
      [cleanTitle(title), typeof xml === 'string' ? xml : ''],
    );
    reply.code(201);
    return rows[0];
  });

  app.get('/api/diagrams/:id', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { rows } = await pool.query('SELECT * FROM diagrams WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: 'no encontrado' });
    return rows[0];
  });

  // Actualización con concurrencia optimista: el cliente envía la `version` que tenía.
  app.put('/api/diagrams/:id', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { title, xml, thumbnail, version } = req.body ?? {};
    if (!Number.isInteger(version)) {
      return reply.code(400).send({ error: 'version (entero) es obligatoria' });
    }
    if (xml !== undefined && typeof xml !== 'string') {
      return reply.code(400).send({ error: 'xml debe ser texto' });
    }
    if (thumbnail != null && (typeof thumbnail !== 'string' || thumbnail.length > MAX_THUMBNAIL)) {
      return reply.code(400).send({ error: 'thumbnail inválida o demasiado grande' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE diagrams SET
           title      = COALESCE($3, title),
           xml        = COALESCE($4, xml),
           thumbnail  = COALESCE($5, thumbnail),
           version    = version + 1,
           updated_at = now()
         WHERE id = $1 AND version = $2 AND deleted_at IS NULL
         RETURNING *`,
        [req.params.id, version, title === undefined ? null : cleanTitle(title), xml ?? null, thumbnail ?? null],
      );
      if (!upd.rows[0]) {
        await client.query('ROLLBACK');
        const cur = await pool.query('SELECT * FROM diagrams WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
        if (!cur.rows[0]) return reply.code(404).send({ error: 'no encontrado' });
        return reply.code(409).send({ error: 'conflicto de versión', current: cur.rows[0] });
      }
      const row = upd.rows[0];
      if (xml !== undefined) {
        // Con edición colaborativa se guarda cada pocos segundos: el historial solo
        // recibe una fila por ventana de VERSION_INTERVAL_MS (0 = en cada guardado).
        await client.query(
          `INSERT INTO diagram_versions (diagram_id, version, xml)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM diagram_versions
             WHERE diagram_id = $1 AND created_at > now() - ($4 * interval '1 millisecond'))`,
          [row.id, row.version, row.xml, versionIntervalMs],
        );
        await client.query(
          `DELETE FROM diagram_versions WHERE diagram_id = $1 AND id NOT IN (
             SELECT id FROM diagram_versions WHERE diagram_id = $1 ORDER BY version DESC LIMIT ${MAX_VERSIONS})`,
          [row.id],
        );
      }
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  app.delete('/api/diagrams/:id', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { rowCount } = await pool.query(
      'UPDATE diagrams SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'no encontrado' });
    return reply.code(204).send();
  });

  app.post('/api/diagrams/:id/duplicate', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { rows } = await pool.query(
      `INSERT INTO diagrams (title, xml, thumbnail)
       SELECT title || ' (copia)', xml, thumbnail FROM diagrams WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'no encontrado' });
    reply.code(201);
    return rows[0];
  });

  app.get('/api/diagrams/:id/versions', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { rows } = await pool.query(
      `SELECT v.id, v.version, v.created_at FROM diagram_versions v
       JOIN diagrams d ON d.id = v.diagram_id
       WHERE v.diagram_id = $1 AND d.deleted_at IS NULL ORDER BY v.version DESC`,
      [req.params.id],
    );
    return rows;
  });

  app.get('/api/diagrams/:id/versions/:version', async (req, reply) => {
    if (!checkId(req, reply)) return;
    const { rows } = await pool.query(
      `SELECT v.* FROM diagram_versions v JOIN diagrams d ON d.id = v.diagram_id
       WHERE v.diagram_id = $1 AND v.version = $2 AND d.deleted_at IS NULL`,
      [req.params.id, parseInt(req.params.version, 10) || 0],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'no encontrado' });
    return rows[0];
  });

  // ---------- Colaboración en tiempo real ----------
  app.register(registerRealtime);

  // ---------- Estáticos ----------
  // PreConfig.js de drawio se sustituye por la versión self-hosted (antes del static de drawio).
  app.get('/drawio/js/PreConfig.js', (req, reply) =>
    reply.sendFile('PreConfig.js', path.dirname(preConfigFile)),
  );
  // Clase de archivo colaborativa (se carga desde PreConfig.js tras app.min.js).
  app.get('/drawio/js/SelfHostFile.js', (req, reply) =>
    reply.sendFile('SelfHostFile.js', path.dirname(preConfigFile)),
  );
  // El service worker no se sirve: evita caches obsoletas con la app embebida.
  app.get('/drawio/service-worker.js', (req, reply) => reply.code(404).send());

  app.register(fastifyStatic, {
    root: drawioDir,
    prefix: '/drawio/',
    decorateReply: true,
    index: ['index.html'],
  });
  app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
    index: ['index.html'],
  });

  // El editor es drawio completo (sin iframe embed) con SelfHostFile y sync.
  app.get('/editor/:id', (req, reply) => {
    if (!checkId(req, reply)) return;
    return reply.redirect(`/drawio/index.html?shid=${req.params.id}&splash=0&offline=1&ui=kennedy`);
  });
  app.get('/editor', (req, reply) => reply.redirect('/'));

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? 'error interno' : err.message });
  });

  return app;
}

function cleanTitle(title) {
  const t = typeof title === 'string' ? title.trim().slice(0, 200) : '';
  return t || 'Sin título';
}

export const defaults = {
  publicDir: path.resolve(__dirname, '../public'),
  preConfigFile: path.resolve(__dirname, '../drawio-config/PreConfig.js'),
};
