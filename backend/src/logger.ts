// Structured JSON logging that cannot leak personal data or secrets: only an allow-list of field names is ever written,
// values are short scalars, and anything that looks like an e-mail address is masked as a second line of defence.
// Request bodies, headers, cookies, query strings, names, e-mails, phones, notes, tokens and keys are never passed in.
export type Fields = Record<string, string | number | boolean | null | undefined>;

const ALLOWED = new Set([
  'request_id', 'method', 'route', 'status', 'duration_ms', 'code', 'error_class', 'outcome', 'reason',
  'booking', 'cache', 'count', 'port', 'env', 'pool', 'problems', 'signal',
]);
const EMAIL_LIKE = /[^\s@"']+@[^\s@"']+/g;
const LONG_DIGITS = /\+?\d[\d ()-]{7,}\d/g;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

export function createLogger(write: (line: string) => void = (line) => { process.stdout.write(line + '\n'); }): Logger {
  const emit = (level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}): void => {
    const out: Record<string, unknown> = { t: new Date().toISOString(), level, event: String(event).slice(0, 60) };
    for (const [k, v] of Object.entries(fields)) {
      if (!ALLOWED.has(k) || v === undefined) continue;
      // request_id is a server-generated UUID (never client text), so it is kept intact; every other text value is masked.
      out[k] = typeof v === 'string' ? (k === 'request_id' ? v.slice(0, 40) : v.slice(0, 120).replace(EMAIL_LIKE, '[masked]').replace(LONG_DIGITS, '[masked]')) : v;
    }
    write(JSON.stringify(out));
  };
  return {
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
