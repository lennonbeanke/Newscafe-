// Request / response shapes for the owner (admin) API. Strict: unknown fields are rejected; text is trimmed and length-capped.
import { z } from '@hono/zod-openapi';

const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const NO_CONTROL_STRICT = /^[^\u0000-\u001f\u007f]*$/;
const text = (max: number, o: { min?: number; multiline?: boolean } = {}) =>
  z.string().trim().min(o.min ?? 0).max(max).regex(o.multiline ? NO_CONTROL : NO_CONTROL_STRICT, 'control characters are not allowed');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); }, 'not a real date');
const phone = z.string().trim().regex(/^[0-9+() -]{5,30}$/, 'not a valid phone number');

export const LoginBody = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).strict().openapi('LoginBody');

export const IdParam = z.object({ id: z.uuid() });
export const ReservationStatus = z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']);
export const ListQuery = z.object({
  from: date.optional(), to: date.optional(), status: ReservationStatus.optional(),
  q: text(100, { min: 1 }).optional(), include_test: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export const CancelBody = z.object({ reason: text(300).optional() }).strict().openapi('CancelBody');
export const StaffCreateBody = z.object({
  party_size: z.number().int().min(1).max(99), starts_at: z.iso.datetime({ offset: true }), name: text(100, { min: 1 }),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email().max(254).optional()),
  phone: z.preprocess((v) => (v === '' ? undefined : v), phone.optional()),
  notes: text(500, { multiline: true }).optional(),
  source: z.enum(['phone', 'walk_in', 'admin']), is_test: z.boolean().optional(),
}).strict().refine((b) => b.email !== undefined || b.phone !== undefined, { message: 'an e-mail address or a phone number is required', path: ['email'] }).openapi('StaffCreateBody');
export const MoveBody = z.object({
  starts_at: z.iso.datetime({ offset: true }).optional(), party_size: z.number().int().min(1).max(99).optional(),
  duration_minutes: z.number().int().min(15).max(720).optional(), table_id: z.uuid().optional(),
}).strict().refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'nothing to change' }).openapi('MoveBody');
export const EditBody = z.object({
  guest_name: text(100, { min: 1 }).optional(), guest_email: z.email().max(254).nullable().optional(),
  guest_phone: phone.nullable().optional(), notes: text(500, { multiline: true }).nullable().optional(),
}).strict().refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'nothing to change' }).openapi('EditBody');
export const AuditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().positive().optional() }).strict();

export const AdminError = z.object({
  error: z.string(), message: z.string(), request_id: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
}).openapi('AdminError');
const loose = z.record(z.string(), z.unknown());
export const SignedIn = z.object({ signed_in: z.literal(true), csrf_token: z.string(), user: z.object({ email: z.string(), role: z.string() }), session_expires_at: z.string() }).openapi('SignedIn');
export const Me = z.object({ user: z.object({ email: z.string(), role: z.string() }), csrf_token: z.string(), session_expires_at: z.string(), idle_timeout_seconds: z.number().int() }).openapi('Me');
export const ReservationOut = z.object({ reservation: loose }).openapi('ReservationOut');
export const ReservationList = z.object({ items: z.array(loose), has_more: z.boolean() }).openapi('ReservationList');
export const Rows = z.object({ items: z.array(loose) }).openapi('Rows');
export const Row = z.object({ item: loose.nullable() }).openapi('Row');
