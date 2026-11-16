// The only place that talks to PostgreSQL. ONE connection pool per process, using the single database login that process was
// given. This module is role-agnostic: there is no parameter, setting or code path to ask for a different login.
// Safety properties implemented here:
//   * every statement is parameterised; no string building of SQL anywhere in the API
//   * a connection failure BEFORE the statement is sent  => DbUnavailable  (nothing was created)
//   * a connection failure AFTER the statement was sent   => DbOutcomeUnknown (may or may not have committed)
//   * after a failure the API fails fast for a few seconds, then tries again (no timers, no background polling)
//   * the database must label itself 'development' (checked once per process) or every call is refused
import pg from 'pg';
import type { Tuning } from './config.ts';
import { DbEnvironmentRefused, DbOutcomeUnknown, DbUnavailable, sqlstateOf } from './errors.ts';
import type { Logger } from './logger.ts';

export interface DbOptions {
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string;
  readonly tuning: Tuning;
  /** a statement that returns one row with column "env": how this process reads the environment label with ITS role */
  readonly envProbe: string;
}
export interface DbStats { queries: number; connectFailures: number; unknownOutcomes: number }
export interface Queryable { query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<R>> }

export class Db implements Queryable {
  private readonly pool: pg.Pool;
  private readonly opts: DbOptions;
  private readonly log: Logger;
  private readonly now: () => number;
  private downUntil = 0;
  private envState: 'unchecked' | 'ok' | 'refused' = 'unchecked';
  private envCheck: Promise<void> | null = null;
  readonly stats: DbStats = { queries: 0, connectFailures: 0, unknownOutcomes: 0 };

  constructor(opts: DbOptions, log: Logger, now: () => number = Date.now) {
    this.opts = opts; this.log = log; this.now = now;
    this.pool = new pg.Pool({
      host: opts.host, port: opts.port, database: opts.database, user: opts.user, password: opts.password,
      connectionTimeoutMillis: opts.tuning.dbConnectTimeoutMs,
      query_timeout: opts.tuning.dbQueryTimeoutMs,
      idleTimeoutMillis: 10_000,
      max: opts.tuning.poolMax,
      ssl: false,
      application_name: 'newscafe-api',
    });
    // An idle connection dying must never crash the process.
    this.pool.on('error', () => { this.log.warn('db_pool_error'); });
  }

  /** True while we are failing fast after a connection problem. */
  get coolingDown(): boolean { return this.now() < this.downUntil; }
  private markDown(): void { this.downUntil = this.now() + this.opts.tuning.dbCooldownMs; }

  /** Confirms once that this is the development database. Fails closed on a mismatch. */
  private async ensureEnvironment(): Promise<void> {
    if (this.envState === 'ok') return;
    if (this.envState === 'refused') throw new DbEnvironmentRefused();
    this.envCheck ??= (async () => {
      let client: pg.PoolClient;
      try { client = await this.pool.connect(); } catch { this.stats.connectFailures++; this.markDown(); throw new DbUnavailable('connect'); }
      const swallow = (): void => { /* reported through the query result */ };
      client.on('error', swallow);
      try {
        const r = await client.query<{ env: string }>(this.opts.envProbe);
        if (r.rows[0]?.env !== 'development') {
          this.envState = 'refused';
          this.log.error('db_environment_refused', { reason: 'label_mismatch' });
          client.removeListener('error', swallow); client.release();
          throw new DbEnvironmentRefused();
        }
        this.envState = 'ok';
        client.removeListener('error', swallow); client.release();
      } catch (e) {
        if (e instanceof DbEnvironmentRefused) throw e;
        client.release(true);
        this.markDown();
        throw new DbUnavailable('env_check');
      }
    })().finally(() => { this.envCheck = null; });
    await this.envCheck;
  }

  private async acquire(skipCooldown: boolean): Promise<{ client: pg.PoolClient; done: (destroy: boolean) => void }> {
    if (this.coolingDown && !skipCooldown) throw new DbUnavailable('cooldown');
    await this.ensureEnvironment();
    let client: pg.PoolClient;
    try { client = await this.pool.connect(); } catch { this.stats.connectFailures++; this.markDown(); throw new DbUnavailable('connect'); }
    // While a client is checked out the pool does not listen for its errors. If the connection dies mid-query, pg can emit a
    // second 'error' event after the query already failed; with no listener that would crash the whole process.
    const swallow = (): void => { /* the failure is reported through the query result */ };
    client.on('error', swallow);
    // A reused client gets the listener removed again (no build-up); a destroyed one keeps it so late socket errors stay harmless.
    const done = (destroy: boolean): void => { if (!destroy) client.removeListener('error', swallow); client.release(destroy); };
    return { client, done };
  }

  /** Classifies a failure that happened AFTER a statement was sent. */
  private afterSend(err: unknown, done: (destroy: boolean) => void): never {
    const state = sqlstateOf(err);
    if (state !== null && !state.startsWith('08')) { done(false); throw err; }   // the database answered with an error: nothing committed
    done(true);                     // connection is suspect: drop it
    this.markDown();
    this.stats.unknownOutcomes++;
    throw new DbOutcomeUnknown();   // sent, but we never saw the outcome
  }

  /** Runs one parameterised statement (its own transaction). */
  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: readonly unknown[] = [], options: { skipCooldown?: boolean } = {}): Promise<pg.QueryResult<R>> {
    const { client, done } = await this.acquire(options.skipCooldown ?? false);
    try {
      this.stats.queries++;
      const result = await client.query<R>({ text, values: [...values] });
      done(false);
      return result;
    } catch (err) { return this.afterSend(err, done); }
  }

  /**
   * Runs several statements in ONE transaction (BEGIN ... COMMIT). Any error rolls everything back. If the connection is lost
   * before the outcome is known the result is DbOutcomeUnknown and the connection is dropped (the server rolls back on its own).
   */
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const { client, done } = await this.acquire(false);
    const q: Queryable = { query: (text, values = []) => { this.stats.queries++; return client.query({ text, values: [...values] }) as never; } };
    try {
      await client.query('BEGIN');
      const out = await fn(q);
      await client.query('COMMIT');
      done(false);
      return out;
    } catch (err) {
      const state = sqlstateOf(err);
      if (state !== null && !state.startsWith('08')) {
        try { await client.query('ROLLBACK'); done(false); } catch { done(true); }
        throw err;
      }
      return this.afterSend(err, done);
    }
  }

  async close(): Promise<void> { await Promise.allSettled([this.pool.end()]); }
}
