import { randomInt } from 'node:crypto';
import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from './config';
import { getConnInfo } from 'hono/bun';
import { addColumn, db, findUser, findUserByEmail, type User } from './local-db';
import { notify } from './notifications';
import { alertUser } from './alert-prefs';
import { isTeamLead } from './teams';

// What each signed-in device looks like, for Account → Security.
addColumn('sessions', 'created_at', 'INTEGER');
addColumn('sessions', 'last_seen_at', 'INTEGER');
addColumn('sessions', 'device', 'TEXT');
addColumn('sessions', 'ip', 'TEXT');
addColumn('sessions', 'is_app', 'INTEGER NOT NULL DEFAULT 0');
// Kept on the account for the admin dashboard, since sessions are deleted when they end or expire.
addColumn('users', 'last_login_at', 'INTEGER');
addColumn('users', 'last_seen_at', 'INTEGER');
// Accounts from before these columns: filled from the sessions and sign-in links still around.
db.exec(`
  UPDATE users SET last_login_at = (
    SELECT max(t) FROM (
      SELECT max(created_at) AS t FROM sessions WHERE user_id = users.id
      UNION ALL SELECT max(used_at) FROM login_tokens WHERE user_id = users.id))
  WHERE last_login_at IS NULL;
  UPDATE users SET last_seen_at = (SELECT max(last_seen_at) FROM sessions WHERE user_id = users.id)
  WHERE last_seen_at IS NULL;
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS known_devices (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device     TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    PRIMARY KEY (user_id, device)
  );
`);

export function clientIp(c: Context): string | null {
  // Behind the proxy (ngrok, Caddy) the client is the first forwarded address.
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

// The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and Path=/,
// so a sibling subdomain cannot plant or overwrite it. Plain http (local testing) cannot use it.
const COOKIE = config.cookieSecure ? '__Host-promoter_session' : 'promoter_session';

function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export function startSession(c: Context, userId: number) {
  const token = randomToken();
  const maxAge = config.sessionDays * 86400;
  const now = Math.floor(Date.now() / 1000);
  const device = summarizeDevice(c.req.header('user-agent'));
  db.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, device, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, now + maxAge, now, now, device, clientIp(c));
  db.query('UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, userId);
  // A sign-in from a kind of device never seen for this account gets a heads-up.
  const known = db.query<{ device: string }, [number]>('SELECT device FROM known_devices WHERE user_id = ?').all(userId);
  if (!known.some((k) => k.device === device)) {
    db.query('INSERT INTO known_devices (user_id, device, first_seen) VALUES (?, ?, ?)').run(userId, device, now);
    if (known.length > 0) {
      const message = {
        title: 'New sign-in',
        body: `Your account was signed in on ${device}. If that was not you, sign it out under Security.`,
        link: '/account/security',
      };
      const user = findUser(userId);
      // Admins choose how they hear about it; promoters always get the app notification.
      if (user?.is_admin) alertUser(user, 'new_signin', message, { device, link: `${config.appUrl}/account/security` });
      else notify(userId, message);
    }
  }
  setCookie(c, COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax', path: '/', maxAge });
  // Signed in now, so this browser is no longer waiting for a link.
  if (getCookie(c, WAIT_COOKIE)) deleteCookie(c, WAIT_COOKIE, { path: '/', secure: config.cookieSecure });
}

export function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) db.query('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  // A __Host- cookie can only be cleared with the same Secure flag it was set with.
  deleteCookie(c, COOKIE, { path: '/', secure: config.cookieSecure });
}

// An admin viewing the app as a promoter: their own session points at the promoter for a while.
// The promoter's sessions are untouched, and the admin gets their own account back when they stop.
addColumn('sessions', 'impersonating_id', 'INTEGER');
addColumn('sessions', 'impersonating_at', 'INTEGER');
export const IMPERSONATION_MINUTES = 60;

/** Who can be viewed as: anyone but admins (and so never the admin themselves). */
export const canImpersonate = (target: User) => !target.is_admin;

export function startImpersonating(sessionId: number, targetId: number) {
  db.query('UPDATE sessions SET impersonating_id = ?, impersonating_at = ? WHERE rowid = ?').run(targetId, Math.floor(Date.now() / 1000), sessionId);
}

export function stopImpersonating(sessionId: number) {
  db.query('UPDATE sessions SET impersonating_id = NULL, impersonating_at = NULL WHERE rowid = ?').run(sessionId);
}

function currentSession(c: Context): { user: User; sessionId: number } | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const session = db
    .query<
      { rowid: number; user_id: number; expires_at: number; last_seen_at: number | null; impersonating_id: number | null; impersonating_at: number | null },
      [string]
    >('SELECT rowid, user_id, expires_at, last_seen_at, impersonating_id, impersonating_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  const now = Math.floor(Date.now() / 1000);
  if (!session || session.expires_at < now) return null;
  const user = findUser(session.user_id);
  if (!user) return null;
  // "Last active" is kept to the nearest few minutes rather than written on every request.
  if (!session.last_seen_at || now - session.last_seen_at > 300) {
    db.query('UPDATE sessions SET last_seen_at = ? WHERE rowid = ?').run(now, session.rowid);
    db.query('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id);
  }
  if (session.impersonating_id) {
    // Checked on every request: still an admin, still in time, and the promoter can still be viewed as.
    const target = findUser(session.impersonating_id);
    const fresh = now - (session.impersonating_at ?? 0) < IMPERSONATION_MINUTES * 60;
    if (user.is_admin && fresh && target && canImpersonate(target)) {
      return { user: { ...target, impersonator: { id: user.id, name: user.name, until: (session.impersonating_at ?? 0) + IMPERSONATION_MINUTES * 60 } }, sessionId: session.rowid };
    }
    stopImpersonating(session.rowid);
  }
  return { user, sessionId: session.rowid };
}

export function currentUser(c: Context): User | null {
  return currentSession(c)?.user ?? null;
}

export type Env = { Variables: { user: User; sessionId: number } };

export async function requireUser(c: Context<Env>, next: Next) {
  const session = currentSession(c);
  if (!session) return c.redirect('/login');
  c.set('user', session.user);
  c.set('sessionId', session.sessionId);
  await next();
}

export type DeviceSession = {
  rowid: number;
  device: string | null;
  ip: string | null;
  is_app: number;
  created_at: number | null;
  last_seen_at: number | null;
};

export function sessionsFor(userId: number): DeviceSession[] {
  return db
    .query<DeviceSession, [number, number]>(
      'SELECT rowid, device, ip, is_app, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY coalesce(last_seen_at, 0) DESC',
    )
    .all(userId, Math.floor(Date.now() / 1000));
}

// Only ever the person's own sessions: the user id is part of every delete.
export function revokeSession(userId: number, rowid: number): boolean {
  return db.query('DELETE FROM sessions WHERE user_id = ? AND rowid = ?').run(userId, rowid).changes === 1;
}

export function revokeOtherSessions(userId: number, keepRowid: number): number {
  return db.query('DELETE FROM sessions WHERE user_id = ? AND rowid <> ?').run(userId, keepRowid).changes;
}

export function markSessionApp(rowid: number) {
  db.query('UPDATE sessions SET is_app = 1 WHERE rowid = ?').run(rowid);
}

export async function requireAdmin(c: Context<Env>, next: Next) {
  if (!c.get('user').is_admin) return c.text('Forbidden', 403);
  await next();
}

export async function requireTeamLead(c: Context<Env>, next: Next) {
  if (!isTeamLead(c.get('user'))) return c.text('Forbidden', 403);
  await next();
}

// Lock an email out for 15 minutes after 5 failed attempts.
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

// Verifying against a dummy hash keeps response time the same for unknown emails.
const dummyHash = await Bun.password.hash('not-a-real-password');

export async function verifyLogin(email: string, password: string): Promise<User | 'locked' | null> {
  const key = email.trim().toLowerCase();
  const entry = failures.get(key);
  if (entry && entry.count >= MAX_FAILURES && entry.until > Date.now()) return 'locked';

  const user = findUserByEmail(key);
  const ok = await Bun.password.verify(password, user?.password_hash || dummyHash);
  if (user && ok) {
    failures.delete(key);
    return user;
  }
  const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
  // Anyone can post any text here: only plausible emails get a counter, so the map cannot be
  // filled with huge keys (expired entries are swept hourly in purgeExpiredSessions).
  if (key.length <= 254) failures.set(key, { count, until: Date.now() + LOCK_MS });
  return null;
}

// Single-use sign-in links, each with a 6-digit code for the installed app, where tapping an email
// link would open the browser instead. Only hashes are stored, so a copy of the database cannot be
// used to sign in. Using the link or the code spends both.
export function createLoginToken(
  userId: number,
  validSeconds: number,
  waiting?: { id: string; from: string },
): { token: string; code: string } {
  const token = randomToken();
  // randomInt draws without the slight bias a plain modulo of a random number would have.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Math.floor(Date.now() / 1000);
  db.query(
    'INSERT INTO login_tokens (token_hash, user_id, expires_at, code_hash, wait_hash, requested_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    hashToken(token),
    userId,
    now + validSeconds,
    hashToken(`${userId}:${code}`),
    waiting ? hashToken(waiting.id) : null,
    waiting?.from ?? null,
    now,
  );
  return { token, code };
}

export type ConsumedLink = {
  userId: number;
  // Set when another browser or the installed app asked for this link and is waiting for it.
  waitingElsewhere: { rowId: number; from: string | null; at: number } | null;
};

export function consumeLoginToken(token: string, c?: Context): ConsumedLink | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .query<{ rowid: number; user_id: number; wait_hash: string | null; requested_from: string | null; created_at: number | null }, [number, string, number]>(
      'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING rowid, user_id, wait_hash, requested_from, created_at',
    )
    .get(now, hashToken(token), now);
  if (!row) return null;
  // Opened in the browser that asked: it is signed in directly and its waiting page notices the session.
  const sameBrowser = !!row.wait_hash && !!c && hashToken(getCookie(c, WAIT_COOKIE) ?? '') === row.wait_hash;
  return {
    userId: row.user_id,
    waitingElsewhere:
      row.wait_hash && !sameBrowser ? { rowId: row.rowid, from: row.requested_from, at: row.created_at ?? now } : null,
  };
}

/*
 * Waiting sign-in. On a phone the installed app and the browser do not share cookies (on iPhone,
 * never), so the app cannot see a link tapped in Mail. When it asks for a link, the app gets a
 * random "wait" cookie and keeps asking the server whether the link was opened. If the link is
 * opened anywhere else, that browser is signed in and asked whether to also sign in the device that
 * asked. Approving lets the waiting app exchange its cookie for a session, once.
 */
const WAIT_COOKIE = config.cookieSecure ? '__Host-login_wait' : 'login_wait';
const APPROVE_WINDOW = 10 * 60;

export function startWaiting(c: Context): string {
  const id = randomToken();
  setCookie(c, WAIT_COOKIE, id, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: config.loginLinkMinutes * 60,
  });
  return id;
}

export function approveWaiting(rowId: number, userId: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .query(
      'UPDATE login_tokens SET approved_at = ? WHERE rowid = ? AND user_id = ? AND wait_hash IS NOT NULL AND approved_at IS NULL AND used_at > ?',
    )
    .run(now, rowId, userId, now - APPROVE_WINDOW);
  return result.changes === 1;
}

// Called by the waiting page. Returns the user to sign in once the link was opened and approved.
export function exchangeWaiting(c: Context): number | null {
  const id = getCookie(c, WAIT_COOKIE);
  if (!id) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .query<{ user_id: number }, [number, string, number]>(
      'UPDATE login_tokens SET exchanged_at = ? WHERE wait_hash = ? AND approved_at IS NOT NULL AND exchanged_at IS NULL AND approved_at > ? RETURNING user_id',
    )
    .get(now, hashToken(id), now - APPROVE_WINDOW);
  if (!row) return null;
  deleteCookie(c, WAIT_COOKIE, { path: '/', secure: config.cookieSecure });
  return row.user_id;
}

export function summarizeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${device} · ${browser}`;
}

// 5 wrong codes cancel every open link and code for that account, so guessing 1 in a million is hopeless.
const codeFailures = new Map<number, number>();

export function consumeLoginCode(email: string, code: string): number | null {
  const user = findUserByEmail(email);
  if (!user || !/^[0-9]{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .query<{ user_id: number }, [number, number, string, number]>(
      'UPDATE login_tokens SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id',
    )
    .get(now, user.id, hashToken(`${user.id}:${code}`), now);
  if (row) {
    codeFailures.delete(user.id);
    return row.user_id;
  }
  const failures = (codeFailures.get(user.id) ?? 0) + 1;
  if (failures >= 5) {
    db.query('DELETE FROM login_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
    codeFailures.delete(user.id);
  } else {
    codeFailures.set(user.id, failures);
  }
  return null;
}

// At most 3 emailed links per address every 15 minutes, so the form cannot be used to flood an inbox.
const linkRequests = new Map<string, number[]>();

export function allowLinkRequest(email: string): boolean {
  const key = email.trim().toLowerCase();
  const recent = (linkRequests.get(key) ?? []).filter((t) => t > Date.now() - LOCK_MS);
  if (recent.length >= 3) return false;
  linkRequests.set(key, [...recent, Date.now()]);
  return true;
}

// Used when an account's email changes: links already sent to the old address must stop working.
export function revokeAccess(userId: number) {
  db.query('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.query('DELETE FROM login_tokens WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions() {
  for (const [key, entry] of failures) if (entry.until < Date.now()) failures.delete(key);
  const now = Math.floor(Date.now() / 1000);
  db.query('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.query('DELETE FROM login_tokens WHERE expires_at < ?').run(now);
}
