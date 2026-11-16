// The owner signs in with e-mail and password ONLY (their decision, recorded in docs/SECURITY.md). These file-level checks stop the old
// authenticator / recovery-code machinery from creeping back in, and prove the backend neither requires, generates nor uses the old key.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const walk = (dir: string): string[] => readdirSync(path.join(root, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`; return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
});
const code = (s: string): string => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('no second factor in the owner API', () => {
  it('has no authenticator or recovery-code modules', () => {
    const files = walk('src').map((f) => path.basename(f));
    expect(files).not.toContain('totp.ts'); expect(files).not.toContain('recovery.ts');
  });
  it('the source never touches the authenticator or recovery-code data', () => {
    for (const f of walk('src').filter((x) => x.endsWith('.ts'))) {
      expect(code(read(f)), f).not.toMatch(/totp_secret_encrypted|totp_confirmed_at|totp_last_step|admin_recovery_codes|decryptSecret|encryptSecret|verifyTotp|otpauth|recovery_code|\/totp\/|login\/totp|login\/recovery/i);
    }
  });
  it('the old key is not required or used: the only mention in the source is the public process refusing to see it', () => {
    const hits = walk('src').filter((f) => f.endsWith('.ts')).flatMap((f) => read(f).split('\n').map((l, i) => ({ f, i: i + 1, l })).filter((x) => /TOTP/i.test(x.l)));
    expect(hits.map((h) => `${h.f}:${h.l.trim().slice(0, 60)}`)).toEqual([expect.stringContaining('src/config.ts:r.mustBeAbsent(')]);
    expect(code(read('src/config.ts'))).not.toMatch(/totpKey|need\('API_TOTP/);
  });
  it('the settings generator no longer writes the key, and the example file does not list it', () => {
    expect(read('scripts/gen-api-env.sh')).not.toMatch(/TOTP/);
    expect(read('env.admin.example')).not.toMatch(/TOTP/);
    expect(read('tools/build-openapi.ts')).not.toMatch(/TOTP/);
  });
  it('the published API description has no second-factor routes', () => {
    for (const f of ['docs/openapi-admin.json', 'docs/openapi.json']) {
      const paths = Object.keys((JSON.parse(read(f)) as { paths: Record<string, unknown> }).paths);
      expect(paths.filter((p) => /totp|recovery|enroll/i.test(p)), f).toEqual([]);
    }
    const admin = (JSON.parse(read('docs/openapi-admin.json')) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> }).paths['/api/admin/login']!['post']!;
    expect(Object.keys(admin.responses)).toContain('200');
  });
});
