// Business-facing operations. All booking rules live in the database; this layer only calls the two public_* functions.
import type { PublicConfig } from './config.ts';
import type { Db } from './db.ts';
import { DbOutcomeUnknown, DbUnavailable } from './errors.ts';

export interface BookingInput {
  readonly partySize: number; readonly startsAt: string; readonly name: string;
  readonly email: string | undefined; readonly phone: string | undefined; readonly notes: string | undefined;
  readonly idempotencyKey: string;
}
export interface Created { reference: string; status: 'pending' | 'confirmed'; party_size: number; starts_at: string }

/** Local calendar date (YYYY-MM-DD) of an instant in the venue's time zone. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export class Services {
  private readonly cache = new Map<string, { at: number; slots: string[] }>();
  private readonly inflight = new Map<string, Promise<string[]>>();
  private health: { at: number; ok: boolean } | null = null;
  private healthInflight: Promise<boolean> | null = null;

  private readonly cfg: PublicConfig;
  private readonly db: Db;
  private readonly now: () => number;

  constructor(cfg: PublicConfig, db: Db, now: () => number = Date.now) { this.cfg = cfg; this.db = db; this.now = now; }

  /**
   * Is booking usable? Answered from a short cache; the database is only touched when someone asks AND the cached
   * answer is older than the TTL. There is no timer and no background polling (so a free scale-to-zero database can sleep).
   */
  async bookingAvailable(): Promise<boolean> {
    const t = this.now();
    const h = this.health;
    if (h && t - h.at < (h.ok ? this.cfg.tuning.healthOkTtlMs : this.cfg.tuning.healthDownTtlMs)) return h.ok;
    this.healthInflight ??= (async () => {
      let ok = false;
      try { await this.db.query('SELECT 1'); ok = true; } catch { ok = false; }
      this.health = { at: this.now(), ok };
      return ok;
    })().finally(() => { this.healthInflight = null; });
    return this.healthInflight;
  }

  /** Slots a web guest could book on a date for a party. Throws database errors (NC001, NC004, NC005 ...) to the caller. */
  async slots(date: string, party: number): Promise<{ slots: string[]; cached: boolean }> {
    const key = `${date}|${party}`;
    const ttl = this.cfg.tuning.availabilityTtlMs;
    const hit = this.cache.get(key);
    if (ttl > 0 && hit && this.now() - hit.at < ttl) return { slots: hit.slots, cached: true };
    let p = this.inflight.get(key);
    if (!p) {
      p = this.db.query<{ slot_start: Date }>('SELECT slot_start FROM public_available_slots($1::date, $2::int) ORDER BY slot_start', [date, party])
        .then((r) => r.rows.map((x) => x.slot_start.toISOString()))
        .finally(() => { this.inflight.delete(key); });
      this.inflight.set(key, p);
    }
    const slots = await p;
    if (ttl > 0) {
      this.cache.set(key, { at: this.now(), slots });
      if (this.cache.size > 500) { const first = this.cache.keys().next().value; if (first !== undefined) this.cache.delete(first); }
    }
    return { slots, cached: false };
  }

  /**
   * Saves a booking. If the first attempt ends with an UNKNOWN outcome (connection lost after the statement was sent) we try
   * once more on a fresh connection with the SAME idempotency key: if the first attempt had committed, the database hands back
   * that booking; if not, it is created now. If the retry cannot be confirmed either, the answer stays "outcome unknown".
   */
  async book(input: BookingInput): Promise<Created> {
    const sql = 'SELECT out_reference, out_status, out_party_size, out_starts_at FROM public_book_reservation($1::int, $2::timestamptz, $3::text, $4::text, $5::text, $6::text, $7::boolean, $8::text)';
    const args = [input.partySize, input.startsAt, input.name, input.email ?? null, input.phone ?? null, input.notes ?? null, true, input.idempotencyKey];
    type Row = { out_reference: string; out_status: 'pending' | 'confirmed'; out_party_size: number; out_starts_at: Date };
    let r;
    try {
      r = await this.db.query<Row>(sql, args);
    } catch (err) {
      if (!(err instanceof DbOutcomeUnknown)) throw err;
      try { r = await this.db.query<Row>(sql, args, { skipCooldown: true }); }
      catch (retryErr) {
        if (retryErr instanceof DbUnavailable || retryErr instanceof DbOutcomeUnknown) throw new DbOutcomeUnknown();   // first attempt still unresolved
        throw retryErr;                                                                                              // a definite database answer
      }
    }
    const row = r.rows[0];
    if (!row) throw new DbUnavailable('empty_result');   // cannot happen; refuse rather than guess
    this.cache.clear();                                    // availability just changed
    return { reference: row.out_reference, status: row.out_status, party_size: row.out_party_size, starts_at: row.out_starts_at.toISOString() };
  }

  /** Up to three nearby bookable times on the requested day (best effort; never throws). */
  async alternatives(startsAt: string, party: number): Promise<string[]> {
    try {
      const { slots } = await this.slots(localDate(startsAt, this.cfg.venueTimeZone), party);
      const target = new Date(startsAt).getTime();
      return [...slots].sort((a, b) => Math.abs(new Date(a).getTime() - target) - Math.abs(new Date(b).getTime() - target)).slice(0, 3).sort();
    } catch { return []; }
  }
}
