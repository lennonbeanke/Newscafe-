// ADMIN process entry point:  node --env-file=.env.admin src/server-admin.ts   (see backend/scripts/api-dev.sh)
// This process holds only the admin database login and the two keys. The public endpoints run in a separate process
// (server-public.ts) that has none of these secrets. Refuses to start unless the configuration is clearly local development.
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { buildAdminApp } from './admin-app.ts';
import { ConfigError, loadAdminConfig } from './config.ts';
import { Db } from './db.ts';
import { createLogger } from './logger.ts';

const logger = createLogger();
let config;
try {
  config = loadAdminConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n${err.problems.map((p) => `  - ${p}`).join('\n')}\n`);
  } else {
    process.stderr.write('Startup refused: unexpected configuration error\n');
  }
  process.exit(1);
}

const db = new Db({
  host: config.dbHost, port: config.dbPort, database: config.dbName, user: config.dbUser, password: config.dbPassword,
  tuning: { ...config.tuning, poolMax: 4 }, envProbe: 'SELECT env FROM app_environment',
}, logger);
const app = buildAdminApp({ config, db, logger });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info('listening', { port: info.port, env: config.env, pool: 'admin' });
}) as Server;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;

const shutdown = (signal: string): void => {
  logger.info('shutting_down', { signal });
  server.close(() => { void db.close().finally(() => process.exit(0)); });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
