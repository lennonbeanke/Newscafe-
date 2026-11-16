// One place that turns database / network failures into safe HTTP answers.
// Rules: never expose SQL text, database messages, hostnames or stack traces; never say "confirmed" unless the database
// committed; always tell the website when it should switch to "request a booking" mode (fallback: "request").
import type { PublicConfig } from './config.ts';

/** The database could not be reached or answered too slowly BEFORE our statement was sent: nothing was created. */
export class DbUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) { super('database unavailable'); this.name = 'DbUnavailable'; this.reason = reason; }
}
/** The statement was sent but the connection failed before we saw the answer: it may or may not have been committed. */
export class DbOutcomeUnknown extends Error {
  constructor() { super('database outcome unknown'); this.name = 'DbOutcomeUnknown'; }
}
/** The database is not the development database we expect (label mismatch). Refuse everything, fail closed. */
export class DbEnvironmentRefused extends Error {
  constructor() { super('database environment refused'); this.name = 'DbEnvironmentRefused'; }
}

export interface HttpFailure {
  readonly status: 400 | 404 | 405 | 409 | 413 | 415 | 422 | 429 | 500 | 503;
  readonly body: Record<string, unknown>;
  /** safe, non-personal label for the log */
  readonly logCode: string;
}

const MESSAGES: Record<string, string> = {
  not_configured: 'Online booking is not available yet.',
  no_availability: 'No table is available at that time.',
  party_size_not_allowed: 'That party size cannot be booked online.',
  outside_booking_window: 'That date or time is outside the booking window.',
  not_on_slot: 'Please choose one of the available booking times.',
  closed: 'We are not open for bookings at that time.',
  consent_required: 'Consent is required to make a booking.',
  invalid_input: 'Some details are not valid.',
  idempotency_conflict: 'That booking key was already used for a different request.',
  booking_unavailable: 'Online booking is temporarily unavailable. Please send a booking request or contact us.',
  outcome_unknown: 'We could not confirm whether your booking was saved. Please do not assume it was. Try again in a moment, or contact us.',
  internal_error: 'Something went wrong.',
  validation_failed: 'The request is not valid.',
  rate_limited: 'Too many requests. Please wait a moment.',
  payload_too_large: 'The request is too large.',
  unsupported_media_type: 'Send the request as application/json.',
  malformed_json: 'The request body is not valid JSON.',
  not_found: 'Not found.',
  method_not_allowed: 'Method not allowed.',
};

export function failure(code: keyof typeof MESSAGES & string, status: HttpFailure['status'], extra: Record<string, unknown> = {}, cfg?: Pick<PublicConfig, 'contact'>): HttpFailure {
  const body: Record<string, unknown> = { error: code, message: MESSAGES[code] ?? MESSAGES['internal_error'], ...extra };
  if (extra['fallback'] === 'request' && cfg) {
    const contact: Record<string, string> = {};
    if (cfg.contact.phone) contact['phone'] = cfg.contact.phone;
    if (cfg.contact.email) contact['email'] = cfg.contact.email;
    if (Object.keys(contact).length > 0) body['contact'] = contact;
  }
  return { status, body, logCode: code };
}

// pg gives system errors (ECONNREFUSED ...) and database errors (5-character SQLSTATE) the same `code` field.
export function sqlstateOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && code !== 'EPIPE' ? code : null;
}

/** Maps anything thrown while booking / reading availability to the answer we send. */
export function mapDbFailure(err: unknown, cfg: Pick<PublicConfig, 'contact'>): HttpFailure {
  if (err instanceof DbOutcomeUnknown) return failure('outcome_unknown', 503, { fallback: 'request', outcome: 'unknown', retry_with_same_key: true }, cfg);
  if (err instanceof DbUnavailable) return failure('booking_unavailable', 503, { fallback: 'request' }, cfg);
  if (err instanceof DbEnvironmentRefused) return failure('booking_unavailable', 503, { fallback: 'request' }, cfg);
  switch (sqlstateOf(err)) {
    case 'NC001': return failure('not_configured', 503, { fallback: 'request' }, cfg);
    case 'NC002': case '23P01': return failure('no_availability', 409);
    case 'NC004': return failure('party_size_not_allowed', 422);
    case 'NC005': return failure('outside_booking_window', 422);
    case 'NC006': return failure('not_on_slot', 422);
    case 'NC007': return failure('closed', 422);
    case 'NC008': return failure('consent_required', 422);
    case 'NC905': return failure('idempotency_conflict', 409);
    case '22023': case '22007': case '22008': case '22P02': case '22003': return failure('invalid_input', 422);
    // The database refused or aborted the statement (nothing was committed): busy / restarting / too slow.
    case '57014': case '55P03': case '53300': case '57P01': case '57P02': case '57P03': case '40001': case '40P01':
      return failure('booking_unavailable', 503, { fallback: 'request' }, cfg);
    default: return failure('internal_error', 500);
  }
}
