// Session tokens, cookie handling and CSRF tokens. The browser holds a random 256-bit token in an HttpOnly cookie; the database
// holds only its SHA-256 hash, so a database leak cannot be replayed as a login.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'nc_admin_session';
export const COOKIE_PATH = '/api/admin';
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

/** CSRF token for a session: derived from the session token under a server key, so nothing extra is stored. */
export const csrfFor = (key: Buffer, token: string): string =>
  createHmac('sha256', key).update('newscafe:csrf:v1:' + token).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const ipHash = (key: Buffer, ip: string): string => createHmac('sha256', key).update('newscafe:ip:v1:' + ip).digest('hex').slice(0, 32);
export const attemptKey = (key: Buffer, ip: string, email: string): string =>
  createHmac('sha256', key).update('newscafe:attempt:v1:' + ip + '|' + email.trim().toLowerCase()).digest('hex');

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
export function readCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) {
      const v = part.slice(i + 1).trim();
      return TOKEN_PATTERN.test(v) ? v : null;
    }
  }
  return null;
}
