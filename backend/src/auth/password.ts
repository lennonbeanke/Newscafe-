// Owner passwords: Argon2id only (PHC string with its own random salt). Only the hash is ever stored.
import { hash, verify } from '@node-rs/argon2';
import type { Argon2Params } from '../config.ts';

export async function hashPassword(password: string, p: Argon2Params): Promise<string> {
  // @node-rs/argon2 defaults to Argon2id; the format check below makes that a hard guarantee.
  const h = await hash(password, { memoryCost: p.memoryCost, timeCost: p.timeCost, parallelism: p.parallelism, outputLen: 32 });
  if (!h.startsWith('$argon2id$')) throw new Error('unexpected password hash algorithm');
  return h;
}

/** false for a wrong password AND for anything that is not a valid hash (never throws). */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try { return await verify(stored, password); } catch { return false; }
}

export function parseParams(stored: string): Argon2Params | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  return m ? { memoryCost: Number(m[1]), timeCost: Number(m[2]), parallelism: Number(m[3]) } : null;
}

/** True when a stored hash is weaker than the current settings (it is then re-hashed at the next successful login). */
export function needsRehash(stored: string, p: Argon2Params): boolean {
  const q = parseParams(stored);
  return q === null || q.memoryCost < p.memoryCost || q.timeCost < p.timeCost || q.parallelism < p.parallelism;
}

/** The shortest password a NEW owner account may have. Existing passwords are never checked against this (sign-in accepts whatever was set). */
export const MIN_NEW_PASSWORD_LENGTH = 12;
/** The sign-in form accepts up to 128 characters (see LoginBody), so a new password may not be longer than that. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Rules for the password of a newly created owner account: 12 to 128 characters, no control characters, and not the e-mail address itself.
 * Returns what is wrong in plain words, or null when the password is acceptable. Used by tools/create-owner.ts and by any future owner-creation or
 * password-change path; it is deliberately NOT applied at sign-in.
 */
export function checkNewPassword(password: string, email?: string): string | null {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) return `the password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters long`;
  if (password.length > MAX_PASSWORD_LENGTH) return `the password may be at most ${MAX_PASSWORD_LENGTH} characters long`;
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'the password contains characters that are not allowed';
  if (email !== undefined && password.trim().toLowerCase() === email.trim().toLowerCase()) return 'the password must not be the e-mail address';
  return null;
}
