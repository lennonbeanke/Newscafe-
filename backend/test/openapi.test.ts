// The published API description must match the code: it is generated from the same schemas the server validates with.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAdminOpenApiDocument, buildOpenApiDocument } from '../tools/build-openapi.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
type Doc = { openapi: string; paths: Record<string, Record<string, { responses: Record<string, unknown>; summary?: string }>>; components?: { schemas?: Record<string, unknown> } };

describe('OpenAPI description', () => {
  const doc = buildOpenApiDocument() as Doc;
  it('documents exactly the public endpoints, with every status the code can return', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/availability', '/api/health', '/api/reservations']);
    expect(Object.keys(doc.paths['/api/reservations']?.['post']?.responses ?? {}).sort()).toEqual(['201', '409', '413', '415', '422', '429', '500', '503']);
    expect(Object.keys(doc.paths['/api/availability']?.['get']?.responses ?? {}).sort()).toEqual(['200', '422', '429', '500', '503']);
    for (const p of Object.values(doc.paths)) for (const op of Object.values(p)) expect(op.summary).toBeTruthy();
  });
  it('contains no admin endpoints and no secrets, role names or real contact details', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/\/api\/admin/);
    expect(text).not.toMatch(/password|secret|token|newscafe_|postgres/i);
  });
  it('the committed backend/docs/openapi.json is up to date (run: node tools/build-openapi.ts --write)', () => {
    const committed = readFileSync(path.resolve(here, '../docs/openapi.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});

describe('OpenAPI description of the owner (admin) API', () => {
  const doc = buildAdminOpenApiDocument() as Doc;
  const ops = Object.entries(doc.paths).flatMap(([p, o]) => Object.entries(o).map(([m, x]) => ({ key: `${m.toUpperCase()} ${p}`, x })));
  it('documents every owner endpoint (17: the five second-factor routes are gone) with a summary and its error answers, and no public booking endpoints', () => {
    expect(ops).toHaveLength(17);
    for (const { key, x } of ops) { expect(x.summary, key).toBeTruthy(); expect(Object.keys(x.responses).length, key).toBeGreaterThan(1); }
    expect(Object.keys(doc.paths).every((p) => p.startsWith('/api/admin/'))).toBe(true);
  });
  it('contains no secrets, keys, role names or hashes', () => {
    expect(JSON.stringify(doc)).not.toMatch(/newscafe_|postgres|argon2id\$|hmac|aes-256|BEGIN /i);
  });
  it('the committed backend/docs/openapi-admin.json is up to date (run: node tools/build-openapi.ts --write)', () => {
    const committed = readFileSync(path.resolve(here, '../docs/openapi-admin.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});
