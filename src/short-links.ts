import { config } from './config';
import { db, type User } from './local-db';
import { eventLink, slugify } from './links';

/*
 * Short links through Kutt (KUTT_URL and KUTT_API_KEY). Each promoter link (promoter, event, promo
 * code) gets one short link the first time a page shows it; it is saved here and reused. When the
 * long link changes (the link format, the alias or the event title), the short link is pointed at
 * the new address, so links already shared keep working. Kutt also counts the clicks. Without Kutt,
 * or while it does not answer, pages show the long links.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS short_links (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id   INTEGER NOT NULL,
    code       TEXT NOT NULL,
    target     TEXT NOT NULL,  -- the long link it leads to
    kutt_id    TEXT NOT NULL,
    short_url  TEXT NOT NULL,
    clicks     INTEGER,        -- as counted by Kutt
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, event_id, code)
  );
`);

type Row = { target: string; kutt_id: string; short_url: string; clicks: number | null };
type EventRef = { id: number; title: string };

const REQUEST_TIMEOUT = 5000;
// After Kutt fails as a whole (down, wrong key), it is left alone for a while instead of slowing every page.
const PAUSE = 5 * 60 * 1000;
// A link Kutt refused is tried again after this long.
const RETRY = 5 * 60 * 1000;
const MAX_RESPONSE = 1024 * 1024;

const kuttUrl = /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(config.kutt.url) ? config.kutt.url : '';
if (config.kutt.url && !kuttUrl) console.warn('KUTT_URL is not a valid http(s) address; short links are off.');

export function kuttEnabled(): boolean {
  return !!(kuttUrl && config.kutt.apiKey);
}

class KuttError extends Error {
  constructor(
    message: string,
    /** True when the problem is this one link (an address taken, a target refused), not Kutt as a whole. */
    readonly perLink = false,
  ) {
    super(message);
  }
}

let pausedUntil = 0;
let lastError: { at: Date; message: string } | null = null;

function outage(message: string): KuttError {
  pausedUntil = Date.now() + PAUSE;
  lastError = { at: new Date(), message };
  console.warn(`Kutt: ${message}; short links paused for ${PAUSE / 60000} minutes.`);
  return new KuttError(message);
}

async function kutt(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<unknown> {
  if (Date.now() < pausedUntil) throw new KuttError('paused');
  let res: Response;
  try {
    res = await fetch(`${kuttUrl}/api/v2${path}`, {
      method,
      headers: { 'X-API-KEY': config.kutt.apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      // Never followed: the API key would go along to wherever the redirect points.
      redirect: 'manual',
    });
  } catch (err) {
    throw outage((err as Error).name === 'TimeoutError' ? 'no answer in time' : 'could not connect');
  }
  if (res.status >= 300 && res.status < 400) throw outage(`answered with a redirect (${res.status}); check KUTT_URL`);
  const text = await readCapped(res);
  if (text === null) throw outage('answered with too much data');
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // handled below
  }
  if (res.ok) return json;
  const reason = typeof (json as { error?: unknown } | null)?.error === 'string' ? (json as { error: string }).error.slice(0, 200) : '';
  // Kutt reports these with 400 or, for some, 500; they are about the request, not about Kutt.
  if (res.status === 400 || /already in use|not found|should at least update/i.test(reason)) throw new KuttError(reason || `HTTP ${res.status}`, true);
  if (res.status === 401) throw outage('the API key was refused; check KUTT_API_KEY');
  throw outage(`answered ${res.status}${reason ? `: ${reason}` : ''}`);
}

/** The body as text, or null past MAX_RESPONSE bytes (stops reading there). */
async function readCapped(res: Response): Promise<string | null> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_RESPONSE) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
};

type KuttLink = { id: string; link: string; clicks: number | null };

const clickCount = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** The parts of Kutt's answer that are used, checked: an id, and a short link that is a plain web address. */
export function readLink(value: unknown): KuttLink | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = typeof v.id === 'string' && /^[0-9a-f-]{36}$/i.test(v.id) ? v.id : null;
  const link = typeof v.link === 'string' && v.link.length <= 300 && safeUrl(v.link) ? v.link : null;
  return id && link ? { id, link, clicks: clickCount(v.visit_count) } : null;
}

function parseLink(value: unknown): KuttLink {
  const link = readLink(value);
  if (!link) throw outage('answered with something that is not a link');
  return link;
}

/** A readable short address, like "halloween-blood-rave-djmax": the event's first words and the alias. */
export function shortAddress(eventTitle: string, alias: string, attempt = 1): string {
  const slug = slugify(eventTitle);
  let event = '';
  for (const word of slug.split('-').filter(Boolean)) {
    if ((event ? event.length + 1 : 0) + word.length > 24) break;
    event = event ? `${event}-${word}` : word;
  }
  event ||= slug.slice(0, 24).replace(/-+$/, '') || 'event';
  // Kutt allows letters, digits, "-" and "_", 64 at most.
  const who = alias.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
  const base = who ? `${event}-${who}` : event;
  return attempt > 1 ? `${base}-${attempt}` : base;
}

function find(userId: number, eventId: number, code: string): Row | null {
  return db.query<Row, [number, number, string]>('SELECT target, kutt_id, short_url, clicks FROM short_links WHERE user_id = ? AND event_id = ? AND code = ?').get(userId, eventId, code);
}

function save(userId: number, eventId: number, code: string, target: string, link: KuttLink) {
  db.query(
    `INSERT INTO short_links (user_id, event_id, code, target, kutt_id, short_url, clicks) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, event_id, code) DO UPDATE SET target = excluded.target, kutt_id = excluded.kutt_id,
       short_url = excluded.short_url, clicks = coalesce(excluded.clicks, short_links.clicks)`,
  ).run(userId, eventId, code, target, link.id, link.link, link.clicks);
}

async function sync(user: User, event: EventRef, code: string, target: string) {
  const row = find(user.id, event.id, code);
  if (row?.target === target) return;
  if (row) {
    try {
      save(user.id, event.id, code, target, parseLink(await kutt('PATCH', `/links/${row.kutt_id}`, { target })));
      return;
    } catch (err) {
      if (!(err instanceof KuttError && err.perLink)) throw err;
      if (/should at least update/i.test(err.message)) {
        db.query('UPDATE short_links SET target = ? WHERE user_id = ? AND event_id = ? AND code = ?').run(target, user.id, event.id, code);
        return;
      }
      if (!/not found/i.test(err.message)) throw err;
      // Deleted in Kutt: a new one is made below.
    }
  }
  const description = `${user.alias ?? ''} · ${event.title} · ${code}`.slice(0, 200);
  // "reuse" returns the link this account already has for the same address, if any.
  const create = (customurl?: string) => kutt('POST', '/links', { target, reuse: true, description, ...(customurl ? { customurl } : {}) });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      save(user.id, event.id, code, target, parseLink(await create(shortAddress(event.title, user.alias ?? '', attempt))));
      return;
    } catch (err) {
      if (!(err instanceof KuttError && err.perLink)) throw err;
      if (!/already in use/i.test(err.message)) break; // the address itself was refused: Kutt picks one
    }
  }
  save(user.id, event.id, code, target, parseLink(await create()));
}

const running = new Map<string, Promise<void>>();
const refusedUntil = new Map<string, number>();

function ensure(user: User, event: EventRef, code: string, target: string): Promise<void> {
  const key = `${user.id}:${event.id}:${code}`;
  if ((refusedUntil.get(key) ?? 0) > Date.now()) return Promise.resolve();
  const existing = running.get(key);
  if (existing) return existing;
  const job = sync(user, event, code, target)
    .catch((err: unknown) => {
      if (err instanceof KuttError && err.perLink) {
        refusedUntil.set(key, Date.now() + RETRY);
        console.warn(`Kutt refused the short link for event ${event.id}, code ${code}: ${err.message}`);
      } else if (!(err instanceof KuttError)) {
        console.error('Short link failed:', err);
      }
    })
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

let clicksAt = 0;
let clicksRun: Promise<void> | null = null;

/** Click counts for every saved short link, read from Kutt's list of this account's links. */
function refreshClicks(): Promise<void> {
  if (clicksRun) return clicksRun;
  clicksAt = Date.now();
  clicksRun = (async () => {
    const update = db.query('UPDATE short_links SET clicks = ? WHERE kutt_id = ?');
    for (let skip = 0, page = 0; page < 100; skip += 50, page++) {
      const body = (await kutt('GET', `/links?limit=50&skip=${skip}`)) as { total?: unknown; data?: unknown } | null;
      const links = Array.isArray(body?.data) ? body.data : [];
      db.transaction(() => {
        for (const item of links as Record<string, unknown>[]) {
          const clicks = clickCount(item?.visit_count);
          if (typeof item?.id === 'string' && clicks !== null) update.run(clicks, item.id);
        }
      })();
      if (links.length < 50 || typeof body?.total !== 'number' || skip + 50 >= body.total) break;
    }
  })()
    .catch((err: unknown) => {
      if (!(err instanceof KuttError)) console.error('Reading click counts failed:', err);
    })
    .finally(() => {
      clicksRun = null;
    });
  return clicksRun;
}

/**
 * Makes or updates the short links a page is about to show, and refreshes click counts when they
 * are old. Waits at most `waitMs`, so a slow Kutt never holds a page up; the rest finish in the
 * background and show on the next visit.
 */
export async function prepareShortLinks(user: User, links: { event: EventRef; code: string }[], waitMs = 2500) {
  if (!kuttEnabled() || Date.now() < pausedUntil) return;
  const jobs: Promise<void>[] = [];
  for (const { event, code } of links) {
    const target = eventLink(event, code, user.alias);
    if (target && find(user.id, event.id, code)?.target !== target) jobs.push(ensure(user, event, code, target));
  }
  if (Date.now() - clicksAt >= config.kutt.clicksMinutes * 60 * 1000 && db.query('SELECT 1 FROM short_links LIMIT 1').get()) jobs.push(refreshClicks());
  if (jobs.length) await Promise.race([Promise.allSettled(jobs), Bun.sleep(waitMs)]);
}

/** The link a promoter shares: the short link when there is an up-to-date one, otherwise the long link. */
export function shareLink(user: User, event: EventRef, code: string): string | null {
  const long = eventLink(event, code, user.alias);
  if (!long || !kuttEnabled()) return long;
  const row = find(user.id, event.id, code);
  return row?.target === long ? row.short_url : long;
}

/** Clicks on a promoter's short link, as Kutt counts them; null when there is none (yet). */
export function linkClicks(user: User, event: EventRef, code: string): number | null {
  if (!kuttEnabled()) return null;
  const row = find(user.id, event.id, code);
  return row && row.target === eventLink(event, code, user.alias) ? row.clicks : null;
}

export function shortLinkStatus(): { enabled: boolean; host: string; count: number; lastError: { at: Date; message: string } | null } {
  let host = '';
  try {
    host = kuttUrl ? new URL(kuttUrl).host : '';
  } catch {
    // not set
  }
  const count = db.query<{ n: number }, []>('SELECT count(*) AS n FROM short_links').get()!.n;
  return { enabled: kuttEnabled(), host, count, lastError };
}
