// PUBLIC process entry point:  node --env-file=.env.public src/server-public.ts   (see backend/scripts/api-dev.sh)
// This process holds only the public database login. The owner (admin) endpoints run in a separate process (server-admin.ts).
// Refuses to start unless the configuration is clearly the local development setup. If the database is down at start-up the
// API still starts and answers "request only"; it checks the database label on the first successful connection.
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { ConfigError, loadPublicConfig } from './config.ts';
import { Db } from './db.ts';
import { createLogger } from './logger.ts';
import { buildPublicApp } from './public-app.ts';
import { Services } from './services.ts';

const logger = createLogger();
let config;
try {
  config = loadPublicConfig(process.env);
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
  tuning: config.tuning, envProbe: 'SELECT public_environment() AS env',
}, logger);
const services = new Services(config, db);
const app = buildPublicApp({ config, db, services, logger });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info('listening', { port: info.port, env: config.env, pool: 'public' });
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
