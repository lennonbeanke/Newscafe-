// Unit tests for the owner-login building blocks: Argon2id, the new-password rule, sessions, CSRF. (No second factor: see docs/SECURITY.md.)
import { describe, expect, it } from 'vitest';
import { checkNewPassword, hashPassword, MAX_PASSWORD_LENGTH, MIN_NEW_PASSWORD_LENGTH, needsRehash, parseParams, verifyPassword } from '../src/auth/password.ts';
import { clearCookie, COOKIE_NAME, csrfFor, hashToken, newToken, readCookie, safeEqual, sessionCookie, TOKEN_PATTERN } from '../src/auth/session.ts';

const WEAK = { memoryCost: 8192, timeCost: 1, parallelism: 1 };

describe('passwords (Argon2id)', () => {
  it('hashes with Argon2id and a fresh salt each time, and verifies', async () => {
    const a = await hashPassword('correct horse battery staple', WEAK); const b = await hashPassword('correct horse battery staple', WEAK);
    expect(a.startsWith('$argon2id$v=19$m=8192,t=1,p=1$')).toBe(true);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(a, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(a, '')).toBe(false);
  });
  it('never throws on junk and never matches it', async () => {
    for (const junk of ['', 'not a hash', '$argon2id$garbage', '$2b$10$abcdefghijklmnopqrstuv']) expect(await verifyPassword(junk, 'x')).toBe(false);
  });
  it('the production setting is 64 MiB x 3 passes and weaker stored hashes are flagged for re-hashing', async () => {
    const strong = { memoryCost: 65536, timeCost: 3, parallelism: 1 };
    const weak = await hashPassword('pw-pw-pw-pw-pw', WEAK);
    expect(parseParams(weak)).toEqual(WEAK);
    expect(needsRehash(weak, strong)).toBe(true);
    expect(needsRehash(weak, WEAK)).toBe(false);
    expect(needsRehash('$argon2i$v=19$m=65536,t=3,p=1$x$y', strong)).toBe(true);
  });
});

describe('the password rule for NEW owner accounts', () => {
  it('needs at least 12 characters', () => {
    expect(MIN_NEW_PASSWORD_LENGTH).toBe(12);
    expect(checkNewPassword('x'.repeat(11))).toMatch(/at least 12 characters/);
    expect(checkNewPassword('')).toMatch(/at least 12/);
    expect(checkNewPassword('admin@1234')).toMatch(/at least 12/);          // the kind of password the rule exists to stop
    expect(checkNewPassword('x'.repeat(12))).toBeNull();
    expect(checkNewPassword('correct horse battery staple')).toBeNull();
  });
  it('may not be longer than the sign-in form accepts (128), or contain control characters', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128);
    expect(checkNewPassword('x'.repeat(128))).toBeNull();
    expect(checkNewPassword('x'.repeat(129))).toMatch(/at most 128/);
    for (const bad of ['abcdefghijkl\u0000', 'abcdefghijkl\n', 'abc\tdefghijklm']) expect(checkNewPassword(bad)).toMatch(/not allowed/);
  });
  it('may not be the e-mail address itself', () => {
    expect(checkNewPassword('owner@newscafe.co.za', 'owner@newscafe.co.za')).toMatch(/e-mail address/);
    expect(checkNewPassword('  OWNER@newscafe.co.za ', 'owner@newscafe.co.za')).toMatch(/e-mail address/);
    expect(checkNewPassword('owner@newscafe.co.za!', 'owner@newscafe.co.za')).toBeNull();
  });
  it('is NOT applied when signing in: an older, shorter password keeps working', async () => {
    const stored = await hashPassword('admin@1234', WEAK);
    expect(await verifyPassword(stored, 'admin@1234')).toBe(true);
  });
  it('a generated development owner password (24 random characters) passes the rule', () => {
    expect(checkNewPassword('AbCdEf-GhJkLm-NpQrSt-UvWxYz')).toBeNull();
  });
});

describe('session tokens, cookies and CSRF', () => {
  it('tokens are 256-bit random; only a SHA-256 hash is stored', () => {
    const t = newToken();
    expect(t).toMatch(TOKEN_PATTERN); expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toHaveLength(32); expect(hashToken(t).toString('hex')).not.toContain(t);
    expect(hashToken(t).equals(hashToken(t))).toBe(true);
  });
  it('the CSRF token is bound to the session and the server key', () => {
    const k1 = Buffer.alloc(32, 1); const k2 = Buffer.alloc(32, 2); const t = newToken(); const u = newToken();
    expect(csrfFor(k1, t)).toBe(csrfFor(k1, t)); expect(csrfFor(k1, t)).not.toBe(csrfFor(k1, u)); expect(csrfFor(k1, t)).not.toBe(csrfFor(k2, t));
    expect(csrfFor(k1, t)).not.toContain(t);
  });
  it('the cookie is HttpOnly, SameSite=Strict, scoped to the admin path, with a lifetime', () => {
    const t = newToken(); const c = sessionCookie(t, 3600, false);
    expect(c).toContain(`${COOKIE_NAME}=${t}`); expect(c).toContain('HttpOnly'); expect(c).toContain('SameSite=Strict'); expect(c).toContain('Path=/api/admin'); expect(c).toContain('Max-Age=3600');
    expect(c).not.toContain('Secure'); expect(sessionCookie(t, 1, true)).toContain('; Secure');
    expect(clearCookie(false)).toMatch(/Max-Age=0/);
  });
  it('reads only a well-formed token of the right cookie', () => {
    const t = newToken();
    expect(readCookie(`a=1; ${COOKIE_NAME}=${t}; b=2`)).toBe(t);
    for (const bad of [undefined, '', 'a=1', `${COOKIE_NAME}=short`, `${COOKIE_NAME}=${t}x`, `x${COOKIE_NAME}=${t}`, `${COOKIE_NAME}=${'!'.repeat(43)}`]) expect(readCookie(bad)).toBeNull();
  });
  it('safeEqual compares in constant time and rejects different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'abcd')).toBe(false); expect(safeEqual('', '')).toBe(true);
  });
});
