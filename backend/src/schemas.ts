// Request / response shapes. Strict: unknown fields are rejected (so a client can never set status, source, is_test,
// consent time, ids or anything else we did not offer), text is trimmed and length-capped, control characters refused.
import { z } from '@hono/zod-openapi';

const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;       // newline and tab allowed (notes)
const NO_CONTROL_STRICT = /^[^\u0000-\u001f\u007f]*$/;                          // no newline/tab at all
const text = (max: number, opts: { min?: number; multiline?: boolean } = {}) =>
  z.string().trim().min(opts.min ?? 0).max(max).regex(opts.multiline ? NO_CONTROL : NO_CONTROL_STRICT, 'control characters are not allowed');

export const PartySize = z.coerce.number().int().min(1).max(99);

export const AvailabilityQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'not a real date').openapi({ example: '2026-12-04' }),
  party: PartySize.openapi({ example: 2 }),
}).strict();

export const IdempotencyHeader = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, '16-128 letters, digits, - or _').openapi({ example: 'b3a1f0e2-7c64-4e0f-9d55-2f6f1d1a7c11' }),
});

export const ReservationBody = z.object({
  party_size: z.number().int().min(1).max(99).openapi({ example: 2 }),
  starts_at: z.iso.datetime({ offset: true }).openapi({ example: '2026-12-04T19:00:00+02:00' }),
  name: text(100, { min: 1 }).openapi({ example: 'Test Guest' }),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email().max(254).optional()).openapi({ example: 'guest@example.com' }),
  phone: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.union([z.literal('').transform(() => undefined), z.string().regex(/^[0-9+() -]{5,30}$/, 'not a valid phone number')]).optional()).openapi({ example: '+27 82 000 0000' }),
  notes: text(500, { multiline: true }).optional().openapi({ example: 'Window seat please' }),
  consent: z.literal(true).openapi({ description: 'The guest agreed to the privacy notice.' }),
}).strict().refine((b) => b.email !== undefined || b.phone !== undefined, { message: 'an e-mail address or a phone number is required', path: ['email'] });

export const ErrorBody = z.object({
  error: z.string(),
  message: z.string(),
  request_id: z.string().optional(),
  fallback: z.literal('request').optional(),
  outcome: z.literal('unknown').optional(),
  retry_with_same_key: z.boolean().optional(),
  contact: z.object({ phone: z.string().optional(), email: z.string().optional() }).optional(),
  alternatives: z.array(z.string()).optional(),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
}).openapi('Error');

export const HealthBody = z.object({
  status: z.literal('ok'),
  booking: z.enum(['available', 'request_only']),
}).openapi('Health');

export const AvailabilityBody = z.object({
  date: z.string(),
  party: z.number().int(),
  slots: z.array(z.string()).openapi({ description: 'Start instants (UTC, ISO 8601) a guest could book.' }),
}).openapi('Availability');

export const ReservationCreated = z.object({
  reference: z.string(),
  status: z.enum(['pending', 'confirmed']),
  party_size: z.number().int(),
  starts_at: z.string(),
}).openapi('ReservationCreated');
