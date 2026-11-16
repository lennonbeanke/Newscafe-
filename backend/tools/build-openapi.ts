// Generates the OpenAPI 3.1 description of the API from the SAME schemas the server validates with.
//   node tools/build-openapi.ts            -> prints JSON
//   node tools/build-openapi.ts --write    -> writes backend/docs/openapi.json (a test fails if the committed file is stale)
// It builds the app with placeholder settings and never connects to a database.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdminApp } from '../src/admin-app.ts';
import { loadAdminConfig, loadPublicConfig } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { silentLogger } from '../src/logger.ts';
import { buildPublicApp } from '../src/public-app.ts';
import { Services } from '../src/services.ts';

export function buildOpenApiDocument(): unknown {
  const config = loadPublicConfig({
    APP_ENV: 'development', API_PORT: '8787', API_DB_HOST: '127.0.0.1', API_DB_PORT: '54329', API_DB_NAME: 'newscafe_dev',
    API_DB_PUBLIC_USER: 'newscafe_public', API_DB_PUBLIC_PASSWORD: 'x'.repeat(40),
    API_ALLOWED_ORIGIN: 'http://localhost:3000', API_OUTBOX_DIR: 'backend/.outbox',
  });
  const db = new Db({ host: config.dbHost, port: config.dbPort, database: config.dbName, user: config.dbUser, password: config.dbPassword, tuning: config.tuning, envProbe: 'SELECT 1 AS env' }, silentLogger);
  const app = buildPublicApp({ config, db, services: new Services(config, db), logger: silentLogger });
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'News Cafe API',
      version: '0.1.0',
      description: 'Milestone A2 (local development only). Public endpoints: health, availability, booking request. '
        + 'If the database cannot be reached, booking endpoints answer 503 with `fallback: "request"`; a booking is never reported as saved unless it was committed. '
        + 'Owner (admin) endpoints are added in the next checkpoint.',
    },
    servers: [{ url: 'http://127.0.0.1:8787', description: 'Local development' }],
  });
}

export function buildAdminOpenApiDocument(): unknown {
  const config = loadAdminConfig({
    APP_ENV: 'development', API_ADMIN_PORT: '8788', API_DB_HOST: '127.0.0.1', API_DB_PORT: '54329', API_DB_NAME: 'newscafe_dev',
    API_DB_ADMIN_USER: 'newscafe_admin', API_DB_ADMIN_PASSWORD: 'y'.repeat(40), API_HMAC_KEY: '1'.repeat(64),
    API_ADMIN_ALLOWED_ORIGIN: 'http://localhost:3000',
  });
  const db = new Db({ host: config.dbHost, port: config.dbPort, database: config.dbName, user: config.dbUser, password: config.dbPassword, tuning: config.tuning, envProbe: 'SELECT 1 AS env' }, silentLogger);
  const app = buildAdminApp({ config, db, logger: silentLogger });
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'News Cafe owner (admin) API',
      version: '0.1.0',
      description: 'Milestone A2 (local development only). Owner-only. Sign-in is one step: e-mail address and password (there is no second factor, by the owner decision). '
        + 'Sessions are an HttpOnly SameSite=Strict cookie; every state-changing request must come from the dashboard origin and carry `X-Requested-With: newscafe-admin` and the per-session `X-CSRF-Token` (returned by sign-in and `/me`). '
        + 'Every reservation change records the signed-in owner as the actor and writes its audit record in the same database transaction.',
    },
    servers: [{ url: 'http://127.0.0.1:8788', description: 'Local development (separate process from the public API)' }],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
  const targets: [string, unknown][] = [['openapi.json', buildOpenApiDocument()], ['openapi-admin.json', buildAdminOpenApiDocument()]];
  if (process.argv.includes('--write')) {
    for (const [name, doc] of targets) { writeFileSync(path.join(docs, name), JSON.stringify(doc, null, 2) + '\n'); process.stdout.write(`wrote docs/${name}\n`); }
  } else process.stdout.write(JSON.stringify(Object.fromEntries(targets), null, 2) + '\n');
}
