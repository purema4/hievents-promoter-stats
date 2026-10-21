import { addColumn, db } from './local-db';

/*
 * Access for programs: API keys a person makes on Account → API & Claude, and apps (like Claude) they
 * connect by signing in and approving them (OAuth, see api.ts). Either way the program acts as that
 * person and sees what they see; a key or connection only changes things when it was allowed to.
 * Only hashes are stored, so a copy of the database cannot be used to call the API.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    redirect_uris TEXT NOT NULL, -- JSON array
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    can_write    INTEGER NOT NULL DEFAULT 0,
    token_hash   TEXT NOT NULL UNIQUE,
    -- The last characters of a key, so its owner can tell their keys apart.
    hint         TEXT NOT NULL,
    -- Connected apps only: their client, a short-lived access token and the refresh token that renews it.
    client_id    TEXT REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    expires_at   INTEGER,
    refresh_hash TEXT UNIQUE,
    refresh_expires_at INTEGER,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash      TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri   TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    can_write      INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL
  );
`);

// The refresh token a connection had before its last refresh: if it shows up again, someone copied it.
addColumn('api_tokens', 'old_refresh_hash', 'TEXT');

export const KEY_PREFIX = 'psk_';
export const MAX_KEYS = 10;
const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 60 * 86400;
const CODE_SECONDS = 600;

const now = () => Math.floor(Date.now() / 1000);
export const hashSecret = (secret: string) => new Bun.CryptoHasher('sha256').update(secret).digest('hex');
const randomSecret = (bytes = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');

export type ApiToken = {
  id: number;
  user_id: number;
  name: string;
  can_write: number;
  hint: string;
  client_id: string | null;
  expires_at: number | null;
  refresh_expires_at: number | null;
  created_at: number;
  last_used_at: number | null;
};

const columns = 'id, user_id, name, can_write, hint, client_id, expires_at, refresh_expires_at, created_at, last_used_at';

// --- API keys ---------------------------------------------------------------------------------------

/** How long a new key works, in days; null never expires. */
export const KEY_DAYS = [30, 90, 365, null] as const;
export type KeyDays = (typeof KEY_DAYS)[number];

/** Makes a key and returns it: this is the only time it can be shown. Null when the person has too many. */
export function createKey(userId: number, name: string, canWrite: boolean, days: KeyDays): { key: string; id: number } | null {
  const keys = db
    .query<{ n: number }, [number, number]>('SELECT count(*) AS n FROM api_tokens WHERE user_id = ? AND client_id IS NULL AND (expires_at IS NULL OR expires_at > ?)')
    .get(userId, now())!.n;
  if (keys >= MAX_KEYS) return null;
  const key = KEY_PREFIX + randomSecret();
  const row = db
    .query<{ id: number }, [number, string, number, string, string, number | null, number]>(
      'INSERT INTO api_tokens (user_id, name, can_write, token_hash, hint, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .get(userId, name, canWrite ? 1 : 0, hashSecret(key), key.slice(-4), days ? now() + days * 86400 : null, now());
  return { key, id: row!.id };
}

/** A person's keys and connected apps, newest first. */
export function tokensFor(userId: number): ApiToken[] {
  return db
    .query<ApiToken, [number, number, number]>(
      `SELECT ${columns} FROM api_tokens WHERE user_id = ?
       AND CASE WHEN client_id IS NULL THEN expires_at IS NULL OR expires_at > ? ELSE refresh_expires_at > ? END ORDER BY id DESC`,
    )
    .all(userId, now(), now());
}

// Only ever the person's own: the user id is part of every delete.
export function revokeToken(userId: number, id: number): boolean {
  return db.query('DELETE FROM api_tokens WHERE user_id = ? AND id = ?').run(userId, id).changes === 1;
}

export function revokeAllTokens(userId: number): number {
  return db.query('DELETE FROM api_tokens WHERE user_id = ?').run(userId).changes;
}

/** The key or access token a request carries, when it is valid. Keeps "last used" to the nearest few minutes. */
export function findToken(secret: string): ApiToken | null {
  const token = db
    .query<ApiToken, [string, number]>(`SELECT ${columns} FROM api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)`)
    .get(hashSecret(secret), now());
  if (token && (!token.last_used_at || now() - token.last_used_at > 300)) {
    db.query('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), token.id);
  }
  return token;
}

// --- Connected apps (OAuth) -------------------------------------------------------------------------

export type OAuthClient = { client_id: string; name: string; redirect_uris: string[] };

/** Only https addresses, or http on this computer (Claude Code and other local apps). */
export function isRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 500) return false;
  try {
    const url = new URL(raw);
    if (url.hash || url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

/** Apps registered but not connected yet: anyone can register, so their number is capped. */
export function waitingClients(): number {
  return db
    .query<{ n: number }, []>(
      'SELECT count(*) AS n FROM oauth_clients WHERE client_id NOT IN (SELECT client_id FROM api_tokens WHERE client_id IS NOT NULL)',
    )
    .get()!.n;
}

export function registerClient(name: string, redirectUris: string[]): OAuthClient {
  const client = { client_id: randomSecret(16), name, redirect_uris: redirectUris };
  db.query('INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)').run(
    client.client_id,
    name,
    JSON.stringify(redirectUris),
    now(),
  );
  return client;
}

export function findClient(clientId: string): OAuthClient | null {
  const row = db.query<{ client_id: string; name: string; redirect_uris: string }, [string]>('SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?').get(clientId);
  return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] } : null;
}

export function createCode(input: { clientId: string; userId: number; redirectUri: string; codeChallenge: string; canWrite: boolean }): string {
  const code = randomSecret();
  db.query(
    'INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, can_write, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(hashSecret(code), input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.canWrite ? 1 : 0, now() + CODE_SECONDS);
  return code;
}

export type TokenPair = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string };

const scopeOf = (canWrite: number) => (canWrite ? 'read write' : 'read');

/** Spends a sign-in code (once, before it expires, with the PKCE verifier) for the app's first tokens. */
export function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }): TokenPair | null {
  const row = db
    .query<{ user_id: number; redirect_uri: string; code_challenge: string; can_write: number }, [string, string, number]>(
      'DELETE FROM oauth_codes WHERE code_hash = ? AND client_id = ? AND expires_at > ? RETURNING user_id, redirect_uri, code_challenge, can_write',
    )
    .get(hashSecret(input.code), input.clientId, now());
  if (!row || row.redirect_uri !== input.redirectUri) return null;
  const challenge = new Bun.CryptoHasher('sha256').update(input.verifier).digest('base64url');
  if (challenge !== row.code_challenge) return null;
  const client = findClient(input.clientId)!;
  const access = randomSecret();
  const refresh = randomSecret();
  db.query(
    'INSERT INTO api_tokens (user_id, name, can_write, token_hash, hint, client_id, expires_at, refresh_hash, refresh_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.user_id, client.name, row.can_write, hashSecret(access), '', client.client_id, now() + ACCESS_SECONDS, hashSecret(refresh), now() + REFRESH_SECONDS, now());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: scopeOf(row.can_write) };
}

/**
 * New tokens for a connected app; the refresh token is replaced, so each one works once. A refresh token
 * that was already used means two copies exist (one was stolen): the connection is ended for both.
 */
export function refreshTokens(refreshToken: string, clientId: string): TokenPair | 'reused' | null {
  const access = randomSecret();
  const refresh = randomSecret();
  const presented = hashSecret(refreshToken);
  const row = db
    .query<{ can_write: number }, [string, number, string, number, string, string, number]>(
      `UPDATE api_tokens SET old_refresh_hash = refresh_hash, token_hash = ?, expires_at = ?, refresh_hash = ?, refresh_expires_at = ?
       WHERE refresh_hash = ? AND client_id = ? AND refresh_expires_at > ? RETURNING can_write`,
    )
    .get(hashSecret(access), now() + ACCESS_SECONDS, hashSecret(refresh), now() + REFRESH_SECONDS, presented, clientId, now());
  if (row) return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: scopeOf(row.can_write) };
  return db.query('DELETE FROM api_tokens WHERE old_refresh_hash = ? AND client_id IS NOT NULL').run(presented).changes ? 'reused' : null;
}

/** Ends a connection from the app's side, by either of its tokens. */
export function revokeBySecret(secret: string) {
  const hash = hashSecret(secret);
  db.query('DELETE FROM api_tokens WHERE client_id IS NOT NULL AND (token_hash = ? OR refresh_hash = ?)').run(hash, hash);
}

/** Expired codes and connections, and registered apps nobody connected within a day. */
export function purgeApiTokens() {
  db.query('DELETE FROM oauth_codes WHERE expires_at < ?').run(now());
  db.query('DELETE FROM api_tokens WHERE refresh_expires_at < ?').run(now());
  db.query('DELETE FROM api_tokens WHERE client_id IS NULL AND expires_at < ?').run(now());
  db.query(
    'DELETE FROM oauth_clients WHERE created_at < ? AND client_id NOT IN (SELECT client_id FROM api_tokens WHERE client_id IS NOT NULL) AND client_id NOT IN (SELECT client_id FROM oauth_codes)',
  ).run(now() - 86400);
}
