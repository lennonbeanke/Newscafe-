// Owner reservation management: list/search, detail, history, staff booking, confirm/cancel/complete/no-show/reinstate, move, edit,
// audit log. Every change must record the signed-in owner as the actor and write its audit row in the SAME transaction.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditFor, Client, createOwner, makeAdminApp } from './helpers/admin.ts';
import type { TestAdminApp, TestOwner } from './helpers/admin.ts';
import { dateAt, ensureVenue, freshDay, makePending, rows, slotAt, su, VENUE, withActiveTables, withSettings } from './helpers/fixtures.ts';

let t: TestAdminApp; let owner: TestOwner; let c: Client;
beforeAll(async () => {
  await ensureVenue(); t = makeAdminApp(); owner = await createOwner(t);
  c = new Client(t.app); expect((await c.signIn(owner)).status).toBe(200);
});
afterAll(async () => { await t.close(); });
const j = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const res = (b: Record<string, any>): Record<string, any> => b['reservation'] as Record<string, any>;
const create = (day: number, over: Record<string, unknown> = {}, key?: string) =>
  c.req('POST', '/api/admin/reservations', { body: { party_size: 2, starts_at: slotAt(day, '19:00'), name: 'Staff Guest', phone: '+27 82 222 2222', source: 'phone', ...over }, headers: key ? { 'idempotency-key': key } : {} });
const act = (id: string, what: string, body?: unknown) => c.req('POST', `/api/admin/reservations/${id}/${what}`, body === undefined ? {} : { body });
const history = async (id: string) => (await j(await c.req('GET', `/api/admin/reservations/${id}/history`)))['items'] as Record<string, any>[];
const sqlOne = async <T>(q: string, p: unknown[] = []): Promise<T> => (await rows(q, p))[0] as T;

describe('staff booking', () => {
  it('creates a CONFIRMED reservation with the table, and records the signed-in owner as actor with an audit row', async () => {
    const day = freshDay();
    const r = await create(day, { email: 'walkin@example.com', notes: 'Birthday' });
    expect(r.status).toBe(201);
    const x = res(await j(r));
    expect(x).toMatchObject({ status: 'confirmed', source: 'phone', is_test: false, party_size: 2, duration_minutes: 90, guest_name: 'Staff Guest', guest_email: 'walkin@example.com', notes: 'Birthday', consent_at: null });
    expect(x['tables']).toHaveLength(1); expect(x['reference']).toMatch(/^[0-9A-F]{8}$/);
    const h = await history(x['id']);
    expect(h[0]).toMatchObject({ action: 'created', new_status: 'confirmed', actor: owner.id, actor_email: owner.email });
    const a = await rows<{ action: string; actor_id: string; ip_hash: string; after: any }>(`SELECT action, actor_id, ip_hash, after FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.create'`, [x['id']]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: 'reservation.create', actor_id: owner.id }); expect(a[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect({ ...a[0]!.after, starts_at: new Date(a[0]!.after.starts_at).toISOString() }).toEqual({ source: 'phone', party_size: 2, starts_at: new Date(slotAt(day, '19:00')).toISOString(), is_test: false });
  });
  it('can use a walk-in-only table and be flagged as a test booking; staff are not bound by opening hours', async () => {
    const day = freshDay();
    const r = await create(day, { source: 'walk_in', is_test: true, starts_at: slotAt(day, '03:30') });
    expect(r.status).toBe(201); expect(res(await j(r))).toMatchObject({ source: 'walk_in', is_test: true, status: 'confirmed' });
  });
  it('an Idempotency-Key makes a retry safe', async () => {
    const day = freshDay(); const key = randomUUID();
    const a = res(await j(await create(day, {}, key))); const b = res(await j(await create(day, {}, key)));
    expect(b['id']).toBe(a['id']);
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(1);
    expect((await create(day, {}, 'short')).status).toBe(422);
  });
  it('the source cannot be "web", and unknown / privileged fields are refused (an actor can never be supplied by the client)', async () => {
    const day = freshDay();
    for (const over of [{ source: 'web' }, { source: 'nonsense' }, { actor: owner.id }, { status: 'pending' }, { consent_at: new Date().toISOString() }, { location_id: VENUE }, { reference: 'AAAAAAAA' }, { email: undefined, phone: undefined }, { party_size: 0 }, { name: '' }]) {
      expect((await create(day, over)).status, JSON.stringify(over)).toBe(422);
    }
    expect((await c.req('POST', '/api/admin/reservations', { body: { party_size: 2, starts_at: slotAt(day, '19:00'), name: 'X', phone: '+27 82 222 2222', source: 'phone' }, headers: { 'x-actor': 'someone-else', 'x-actor-id': randomUUID() } })).status).toBe(201);
    const [e] = await rows<{ actor: string }>(`SELECT actor FROM reservation_events ORDER BY id DESC LIMIT 1`);
    expect(e!.actor).toBe(owner.id);                                              // headers claiming another actor are simply ignored
  });
  it('no table free -> 409 and nothing is written (no reservation, no history, no audit row)', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      expect((await create(day)).status).toBe(201);
      const before = { r: (await rows('SELECT 1 FROM reservations')).length, e: (await rows('SELECT 1 FROM reservation_events')).length, a: (await rows('SELECT 1 FROM audit_logs')).length };
      const r = await create(day, { name: 'Second Guest' });
      expect(r.status).toBe(409); expect((await j(r))['error']).toBe('no_availability');
      expect({ r: (await rows('SELECT 1 FROM reservations')).length, e: (await rows('SELECT 1 FROM reservation_events')).length, a: (await rows('SELECT 1 FROM audit_logs')).length }).toEqual(before);
    });
  });
  it('rules not configured -> 409 not_configured', async () => {
    await withSettings({ slot_interval_minutes: null }, async () => {
      const r = await create(freshDay()); expect(r.status).toBe(409); expect((await j(r))['error']).toBe('not_configured');
    });
  });
  it('a start time off the slot grid -> 422 not_on_slot', async () => {
    const day = freshDay();
    const r = await create(day, { starts_at: slotAt(day, '19:10') }); expect(r.status).toBe(422); expect((await j(r))['error']).toBe('not_on_slot');
  });
});

describe('status changes', () => {
  it('confirm -> complete, with each step recorded in the history and audit log under the owner', async () => {
    const id = await makePending(freshDay());
    expect(res(await j(await act(id, 'confirm')))['status']).toBe('confirmed');
    expect(res(await j(await act(id, 'complete')))['status']).toBe('completed');
    const h = await history(id);
    expect(h.map((e) => `${e['action']}:${e['old_status'] ?? ''}>${e['new_status'] ?? ''}`)).toEqual(['created:>pending', 'status_changed:pending>confirmed', 'status_changed:confirmed>completed']);
    expect(h.slice(1).every((e) => e['actor'] === owner.id && e['actor_email'] === owner.email)).toBe(true);
    expect(h[0]!['actor']).toBe('system');                                        // the guest's own request is "system", never the owner
    const a = await rows<{ action: string; before: any; after: any }>(`SELECT action, before, after FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.status' ORDER BY id`, [id]);
    expect(a.map((x) => x.action)).toEqual(['reservation.status', 'reservation.status']);
    expect(a[0]).toMatchObject({ before: { status: 'pending' }, after: { status: 'confirmed' } });
  });
  it('cancel (with a reason) releases the table; reinstate puts it back; no-show releases it again', async () => {
    const id = await makePending(freshDay(), { name: 'Cancel Guest' });
    await act(id, 'confirm');
    const tableOf = async () => ((await j(await c.req('GET', `/api/admin/reservations/${id}`)))['reservation']['tables'] as string[]);
    const original = await tableOf(); expect(original).toHaveLength(1);
    const cancelled = res(await j(await act(id, 'cancel', { reason: 'guest phoned' })));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancel_reason: 'guest phoned', tables: [] }); expect(cancelled['cancelled_at']).not.toBeNull();
    expect(res(await j(await act(id, 'reinstate')))).toMatchObject({ status: 'confirmed', cancel_reason: null, cancelled_at: null, tables: original });
    expect(res(await j(await act(id, 'no-show')))).toMatchObject({ status: 'no_show', tables: [] });
    expect(res(await j(await act(id, 'reinstate')))['status']).toBe('confirmed');
  });
  it('reinstating a reservation that was never confirmed returns it to pending', async () => {
    const id = await makePending(freshDay());
    await act(id, 'cancel');
    expect(res(await j(await act(id, 'reinstate')))['status']).toBe('pending');
  });
  it('reinstating onto a table that was taken meanwhile -> 409 table_taken and NOTHING changes', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      const a = res(await j(await create(day)))['id'] as string;
      await act(a, 'cancel');
      expect((await create(day, { name: 'Took The Table' })).status).toBe(201);
      const before = await history(a);
      const r = await act(a, 'reinstate');
      expect(r.status).toBe(409); expect((await j(r))['error']).toBe('table_taken');
      expect(res(await j(await c.req('GET', `/api/admin/reservations/${a}`)))).toMatchObject({ status: 'cancelled', tables: [] });
      expect(await history(a)).toHaveLength(before.length);
    });
  });
  it.each([['confirm', 'completed'], ['cancel', 'completed'], ['complete', 'pending'], ['no-show', 'pending'], ['reinstate', 'pending'], ['confirm', 'cancelled']])('%s is refused for a %s/other state with 409 and writes nothing', async (what, state) => {
    const id = await makePending(freshDay());
    if (state === 'completed') { await act(id, 'confirm'); await act(id, 'complete'); }
    if (state === 'cancelled') await act(id, 'cancel');
    const changes = async () => ({ h: (await history(id)).length, a: (await rows(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action NOT LIKE '%view'`, [id])).length });
    const before = await changes();
    const r = await act(id, what);
    expect(r.status).toBe(409); expect((await j(r))['error']).toBe('status_change_not_allowed');
    expect(await changes()).toEqual(before);
  });
  it('unknown id -> 404; malformed id -> 422; overlong reason -> 422', async () => {
    expect((await act(randomUUID(), 'confirm')).status).toBe(404);
    expect((await c.req('POST', '/api/admin/reservations/not-a-uuid/confirm', { body: {} })).status).toBe(422);
    expect((await c.req('GET', '/api/admin/reservations/not-a-uuid')).status).toBe(422);
    const id = await makePending(freshDay());
    expect((await act(id, 'cancel', { reason: 'x'.repeat(301) })).status).toBe(422);
    expect((await act(id, 'cancel', { reason: 'ok', extra: 1 })).status).toBe(422);
  });
});

describe('moving a reservation', () => {
  it('changes the time, keeps the same table when free, and records history + audit under the owner', async () => {
    const day = freshDay(); const id = res(await j(await create(day)))['id'] as string;
    const before = res(await j(await c.req('GET', `/api/admin/reservations/${id}`)));
    const r = await c.req('POST', `/api/admin/reservations/${id}/move`, { body: { starts_at: slotAt(day, '20:30') } });
    expect(r.status).toBe(200);
    const after = res(await j(r));
    expect(after['starts_at']).toBe(new Date(slotAt(day, '20:30')).toISOString()); expect(after['tables']).toEqual(before['tables']); expect(after['ends_at']).toBe(new Date(slotAt(day, '22:00')).toISOString());
    const h = await history(id);
    expect(h.some((e) => e['action'] === 'tables_changed' && e['actor'] === owner.id)).toBe(true);
    expect(h.some((e) => e['action'] === 'edited' && e['actor'] === owner.id && 'starts_at' in (e['changes'] ?? {}))).toBe(true);
    const a = await rows<{ action: string; before: any; after: any; actor_id: string }>(`SELECT action, before, after, actor_id FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.move'`, [id]);
    expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ actor_id: owner.id });
    expect(a[0]!.before).toMatchObject({ party_size: 2 }); expect(new Date(a[0]!.after.starts_at).toISOString()).toBe(new Date(slotAt(day, '20:30')).toISOString());
  });
  it('a bigger party moves to a bigger table (the owner\'s duration rules are re-applied; the test venue has one 90 minute rule)', async () => {
    const day = freshDay(); const id = res(await j(await create(day)))['id'] as string;
    const before = res(await j(await c.req('GET', `/api/admin/reservations/${id}`)))['tables'] as string[];
    const r = await c.req('POST', `/api/admin/reservations/${id}/move`, { body: { party_size: 3 } });
    expect(r.status).toBe(200); expect(res(await j(r))).toMatchObject({ party_size: 3, duration_minutes: 90 });
    expect(((res(await j(await c.req('GET', `/api/admin/reservations/${id}`)))['tables']) as string[])).not.toEqual(before);   // a 2-seat table cannot take 3
  });
  it('the owner can pick a table, and an explicit duration', async () => {
    const day = freshDay(); const id = res(await j(await create(day)))['id'] as string;
    const tables = (await j(await c.req('GET', '/api/admin/tables')))['items'] as Record<string, any>[];
    const target = tables.find((x) => x['label'] === 'T40')!;
    const r = await c.req('POST', `/api/admin/reservations/${id}/move`, { body: { table_id: target['id'], duration_minutes: 120 } });
    expect(r.status).toBe(200); expect(res(await j(r))).toMatchObject({ tables: ['T40'], duration_minutes: 120 });
  });
  it('into a full house -> 409 and the reservation, its table and its history are exactly as before', async () => {
    const day = freshDay();
    await withActiveTables(2, async () => {
      const a = res(await j(await create(day)))['id'] as string;
      await create(day, { name: 'Other' });
      const b = res(await j(await create(day, { starts_at: slotAt(day, '21:30'), name: 'Late' })))['id'] as string;
      await create(day, { starts_at: slotAt(day, '21:30'), name: 'Late 2' });
      const snapshot = JSON.stringify([res(await j(await c.req('GET', `/api/admin/reservations/${b}`))), (await history(b)).length]);
      const r = await c.req('POST', `/api/admin/reservations/${b}/move`, { body: { starts_at: slotAt(day, '19:00') } });
      expect(r.status).toBe(409); expect((await j(r))['error']).toBe('no_availability');
      expect(JSON.stringify([res(await j(await c.req('GET', `/api/admin/reservations/${b}`))), (await history(b)).length])).toBe(snapshot.replace(/"updated_at":"[^"]+"/, (m) => m));
      expect(a).toBeTruthy();
    });
  });
  it('refusals: nothing to change / off the slot grid / bad table / unknown reservation / finished reservation', async () => {
    const day = freshDay(); const id = res(await j(await create(day)))['id'] as string; const mv = (id2: string, b: unknown) => c.req('POST', `/api/admin/reservations/${id2}/move`, { body: b });
    expect((await mv(id, {})).status).toBe(422);
    expect((await mv(id, { starts_at: slotAt(day, '19:10') })).status).toBe(422);
    expect((await mv(id, { table_id: randomUUID() })).status).toBe(422);                       // a table that cannot seat this party
    expect((await mv(randomUUID(), { party_size: 3 })).status).toBe(404);
    expect((await mv(id, { duration_minutes: 5 })).status).toBe(422);
    expect((await mv(id, { starts_at: 'tomorrow' })).status).toBe(422);
    await act(id, 'complete');
    expect((await mv(id, { party_size: 3 })).status).toBe(409);
  });
});

describe('editing guest details', () => {
  it('changes only the supplied fields; null clears; the full change is in the history and the audit log lists field NAMES only', async () => {
    const id = res(await j(await create(freshDay(), { email: 'edit@example.com' })))['id'] as string;
    const r = await c.req('PATCH', `/api/admin/reservations/${id}`, { body: { guest_name: 'Renamed Person', notes: 'allergy: nuts' } });
    expect(r.status).toBe(200); expect(res(await j(r))).toMatchObject({ guest_name: 'Renamed Person', notes: 'allergy: nuts', guest_phone: '+27 82 222 2222', guest_email: 'edit@example.com' });
    expect(res(await j(await c.req('PATCH', `/api/admin/reservations/${id}`, { body: { guest_email: null, notes: null } })))).toMatchObject({ guest_email: null, notes: null });
    const h = await history(id);
    expect(h.filter((e) => e['action'] === 'edited' && e['actor'] === owner.id).length).toBe(2);
    expect(JSON.stringify(h)).toContain('Renamed Person');                                    // the append-only history holds the full change
    const a = await rows<{ after: any }>(`SELECT after FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.edit' ORDER BY id`, [id]);
    expect(a.map((x) => x.after)).toEqual([{ fields: ['guest_name', 'notes'] }, { fields: ['guest_email', 'notes'] }]);
    expect(JSON.stringify(a)).not.toMatch(/Renamed|allergy|edit@example/);                    // ...the audit log does not
  });
  it('cannot remove the last contact method; cannot touch status, times, party, tables, flags or ids', async () => {
    const id = res(await j(await create(freshDay(), { phone: '+27 82 555 5555', email: undefined })))['id'] as string;
    expect((await c.req('PATCH', `/api/admin/reservations/${id}`, { body: { guest_phone: null } })).status).toBe(422);
    for (const b of [{ status: 'cancelled' }, { starts_at: new Date().toISOString() }, { party_size: 9 }, { is_test: true }, { id: randomUUID() }, { source: 'web' }, { tables: ['T01'] }, {}, { guest_email: 'nope' }, { guest_name: '' }]) {
      expect((await c.req('PATCH', `/api/admin/reservations/${id}`, { body: b })).status, JSON.stringify(b)).toBe(422);
    }
    expect((await c.req('PATCH', `/api/admin/reservations/${randomUUID()}`, { body: { notes: 'x' } })).status).toBe(404);
  });
});

describe('list, search, detail, audit log, readiness, tables', () => {
  it('filters by local date range and status; hides test bookings unless asked; orders by time', async () => {
    const day = freshDay(); const d = dateAt(day);
    const a = await makePending(day, { name: 'Zed Late', at: '21:00' }); const b = await makePending(day, { name: 'Amy Early', at: '17:00' }); const tst = await makePending(day, { name: 'Test Booking', at: '18:00', test: true });
    await act(a, 'confirm');
    const q = async (qs: string) => ((await j(await c.req('GET', '/api/admin/reservations?' + qs)))['items'] as Record<string, any>[]).map((x) => x['id']);
    expect(await q(`from=${d}&to=${d}`)).toEqual([b, a]);                                       // ordered by start time; test booking hidden
    expect(await q(`from=${d}&to=${d}&include_test=true`)).toEqual([b, tst, a]);
    expect(await q(`from=${d}&to=${d}&status=confirmed`)).toEqual([a]);
    expect(await q(`from=${d}&to=${d}&status=cancelled`)).toEqual([]);
    expect(await q(`from=${dateAt(day + 1)}&to=${dateAt(day + 1)}`)).toEqual([]);
  });
  it('searches name, e-mail, phone and reference; % and _ are plain characters, not wildcards; injection is inert', async () => {
    const day = freshDay(); const d = dateAt(day);
    const pct = await makePending(day, { name: 'Per%cent Person', at: '17:00', email: 'pct@example.com', phone: '+27 83 000 0001' });
    const und = await makePending(day, { name: 'Under_score', at: '17:30', email: 'und@example.com', phone: '+27 83 000 0002' });
    const plain = await makePending(day, { name: 'Perkins Plain', at: '18:00', email: 'plain@example.com', phone: '+27 83 000 0003' });
    const q = async (s: string) => ((await j(await c.req('GET', `/api/admin/reservations?from=${d}&to=${d}&q=${encodeURIComponent(s)}`)))['items'] as Record<string, any>[]).map((x) => x['id']);
    expect(await q('Per%')).toEqual([pct]);                                                     // "Per%" does NOT match "Perkins"
    expect(await q('Under_')).toEqual([und]); expect(await q('Und__core')).toEqual([]);         // "_" is not a wildcard
    expect(await q('perkins')).toEqual([plain]); expect(await q('PLAIN@EXAMPLE')).toEqual([plain]);
    expect(await q('83 000 0002')).toEqual([und]);
    const ref = (await rows<{ reference: string }>('SELECT reference FROM reservations WHERE id = $1', [plain]))[0]!.reference;
    expect(await q(ref.toLowerCase())).toEqual([plain]);
    expect(await q("'; DROP TABLE reservations;--")).toEqual([]);
    expect((await rows("SELECT to_regclass('public.reservations') AS t"))[0]).toMatchObject({ t: 'reservations' });
  });
  it('paginates with limit/offset and says whether there is more; rejects bad filters', async () => {
    const day = freshDay(); const d = dateAt(day);
    const ids = []; for (const at of ['17:00', '17:30', '18:00']) ids.push(await makePending(day, { at, name: 'Page ' + at }));
    const page = async (limit: number, offset: number) => await j(await c.req('GET', `/api/admin/reservations?from=${d}&to=${d}&limit=${limit}&offset=${offset}`));
    const p1 = await page(2, 0); expect((p1['items'] as any[]).map((x) => x.id)).toEqual(ids.slice(0, 2)); expect(p1['has_more']).toBe(true);
    const p2 = await page(2, 2); expect((p2['items'] as any[]).map((x) => x.id)).toEqual(ids.slice(2)); expect(p2['has_more']).toBe(false);
    for (const bad of ['limit=0', 'limit=101', 'offset=-1', 'status=bogus', 'from=2026-13-01', 'q=', 'x=1', 'include_test=yes']) expect((await c.req('GET', '/api/admin/reservations?' + bad)).status, bad).toBe(422);
  });
  it('the detail view shows guest details and tables, and VIEWING it is audited (id and actor only)', async () => {
    const id = await makePending(freshDay(), { name: 'Viewed Guest', email: 'viewed@example.com' });
    const r = res(await j(await c.req('GET', `/api/admin/reservations/${id}`)));
    expect(r).toMatchObject({ guest_name: 'Viewed Guest', guest_email: 'viewed@example.com', status: 'pending', source: 'web' }); expect(r['consent_at']).not.toBeNull();
    const a = await rows<{ action: string; actor_id: string; after: unknown }>(`SELECT action, actor_id, after FROM audit_logs WHERE entity_id = $1`, [id]);
    expect(a).toEqual([{ action: 'reservation.view', actor_id: owner.id, after: null }]);
  });
  it('the audit log lists who did what, newest first, with paging, and never contains guest personal data', async () => {
    const guestName = 'Auditable Zebra-' + randomUUID().slice(0, 6); const email = `zebra-${randomUUID().slice(0, 6)}@example.com`;
    const day = freshDay(); const id = res(await j(await create(day, { name: guestName, email })))['id'] as string;
    await c.req('PATCH', `/api/admin/reservations/${id}`, { body: { guest_name: guestName + ' Jr' } });
    await act(id, 'cancel', { reason: 'testing' });
    const log = (await j(await c.req('GET', '/api/admin/audit-log?limit=3')))['items'] as Record<string, any>[];
    expect(log.map((x) => x['action'])).toEqual(['reservation.status', 'reservation.edit', 'reservation.create']);
    expect(log.every((x) => x['actor_id'] === owner.id && x['actor_email'] === owner.email)).toBe(true);
    const older = (await j(await c.req('GET', `/api/admin/audit-log?limit=2&before=${log[2]!['id']}`)))['items'] as Record<string, any>[];
    expect(older.every((x) => Number(x['id']) < Number(log[2]!['id']))).toBe(true);
    const everything = JSON.stringify((await j(await c.req('GET', '/api/admin/audit-log?limit=200')))['items']);
    for (const pii of [guestName, email, '+27 82 222 2222', 'testing']) expect(everything).not.toContain(pii);
    for (const bad of ['limit=0', 'limit=201', 'before=abc', 'before=-1', 'x=1']) expect((await c.req('GET', '/api/admin/audit-log?' + bad)).status, bad).toBe(422);
  });
  it('readiness and tables are read-only lists', async () => {
    const ready = (await j(await c.req('GET', '/api/admin/readiness')))['item'];
    expect(ready).toMatchObject({ has_tables: true, has_slot_interval: true });
    const tables = (await j(await c.req('GET', '/api/admin/tables')))['items'] as Record<string, any>[];
    expect(tables.length).toBe(44); expect(Object.keys(tables[0]!).sort()).toEqual(['id', 'is_active', 'label', 'max_covers', 'min_covers', 'online_bookable', 'section']);
  });
});

describe('the change and its audit record are ONE transaction', () => {
  it('if the audit record cannot be written, the reservation change does not happen either (and vice versa nothing is audited for a refused change)', async () => {
    const day = freshDay(); const id = await makePending(day); await act(id, 'confirm');
    const su1 = await su();
    try {
      await su1.query('REVOKE INSERT ON audit_logs FROM newscafe_definer');                    // sabotage: the audit insert will now fail inside the database function
      try {
        const create1 = await create(freshDay(), { name: 'Atomic Guest' });
        expect(create1.status).toBe(500);
        expect(await rows(`SELECT 1 FROM reservations WHERE guest_name = 'Atomic Guest'`)).toHaveLength(0);                       // no booking
        const cancel = await act(id, 'cancel');
        expect(cancel.status).toBe(500);
        expect((await sqlOne<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [id])).status).toBe('confirmed');   // still confirmed
        expect((await sqlOne<{ n: string }>(`SELECT count(*)::text AS n FROM reservation_events WHERE reservation_id = $1 AND new_status = 'cancelled'`, [id])).n).toBe('0');   // no history either
        const mv = await c.req('POST', `/api/admin/reservations/${id}/move`, { body: { party_size: 3 } });
        expect(mv.status).toBe(500);
        expect((await sqlOne<{ p: number }>('SELECT party_size AS p FROM reservations WHERE id = $1', [id])).p).toBe(2);
        expect((await sqlOne<{ n: string }>(`SELECT count(*)::text AS n FROM table_allocations WHERE reservation_id = $1 AND active`, [id])).n).toBe('1');
        const edit = await c.req('PATCH', `/api/admin/reservations/${id}`, { body: { notes: 'should not stick' } });
        expect(edit.status).toBe(500);
        expect((await sqlOne<{ n: string | null }>('SELECT notes AS n FROM reservations WHERE id = $1', [id])).n).toBeNull();
        expect(JSON.stringify(await j(cancel))).not.toMatch(/audit|permission|INSERT|newscafe_/i);   // and the failure message reveals nothing
      } finally { await su1.query('GRANT INSERT ON audit_logs TO newscafe_definer'); }
    } finally { await su1.end(); }
    expect((await act(id, 'cancel')).status).toBe(200);                                       // normal again
  });
});

describe('simultaneous owner actions', () => {
  it('10 simultaneous confirmations of one pending booking: exactly one succeeds, one audit row, one history entry', async () => {
    const id = await makePending(freshDay());
    const rs = await Promise.all(Array.from({ length: 10 }, () => act(id, 'confirm')));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1); expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
    expect((await rows(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.status'`, [id]))).toHaveLength(1);
    expect((await history(id)).filter((e) => e['action'] === 'status_changed')).toHaveLength(1);
  });
  it('10 simultaneous staff bookings for the one free table: exactly one wins', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => create(day, { name: `Racer ${i}` })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1); expect(rs.filter((r) => r.status === 409)).toHaveLength(9);
    });
  });
  it('two reservations moved onto the same single table and time at once: exactly one wins and nobody is double booked', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      const a = res(await j(await create(day, { starts_at: slotAt(day, '17:00'), name: 'A' })))['id'] as string;
      const b = res(await j(await create(day, { starts_at: slotAt(day, '20:00'), name: 'B' })))['id'] as string;
      const rs = await Promise.all([a, b].map((id) => c.req('POST', `/api/admin/reservations/${id}/move`, { body: { starts_at: slotAt(day, '18:30') } })));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      const overlaps = await rows(`SELECT 1 FROM table_allocations x JOIN table_allocations y ON x.table_id = y.table_id AND x.id < y.id AND x.active AND y.active AND x.during && y.during`);
      expect(overlaps).toHaveLength(0);
    });
  });
  it('cancel and reinstate racing each other never corrupt the booking (consistent final state, table never double booked)', async () => {
    const day = freshDay(); const id = res(await j(await create(day)))['id'] as string;
    await Promise.all([act(id, 'cancel'), act(id, 'cancel'), act(id, 'reinstate'), act(id, 'cancel'), act(id, 'reinstate')]);
    const r = res(await j(await c.req('GET', `/api/admin/reservations/${id}`)));
    expect(['confirmed', 'cancelled']).toContain(r['status']);
    expect(r['status'] === 'confirmed' ? (r['tables'] as string[]).length : (r['tables'] as string[]).length).toBe(r['status'] === 'confirmed' ? 1 : 0);
  });
});
