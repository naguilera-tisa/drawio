import path from 'node:path';
import { createPool, migrate } from './db.js';
import { buildApp, defaults } from './app.js';

const pool = createPool();
await migrate(pool);

const app = buildApp({
  pool,
  logger: true,
  // En la imagen Docker la webapp de drawio se copia a /app/drawio.
  drawioDir: path.resolve(process.env.DRAWIO_DIR || '../src/main/webapp'),
  publicDir: defaults.publicDir,
  preConfigFile: defaults.preConfigFile,
});

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);

await app.listen({ port: Number(process.env.PORT) || 8080, host: '0.0.0.0' });
