import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import QRCode from 'qrcode';
import { getBrand } from './brand';
import { config } from './config';
import { addColumn, db, type User } from './local-db';

/*
 * Two-step verification with an authenticator app (TOTP, RFC 6238: 6 digits, 30 seconds, SHA-1,
 * which is what Google Authenticator, 1Password, Authy and others expect). Signing in then takes
 * the usual link, code or password and a code from the app; recovery codes cover a lost phone.
 */
addColumn('users', 'totp_secret', 'TEXT');
addColumn('users', 'totp_pending', 'TEXT'); // set while the person is setting it up
addColumn('users', 'totp_enabled_at', 'INTEGER');
addColumn('users', 'totp_last_step', 'INTEGER'); // a code can be used only once
db.exec(`
  CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at   INTEGER,
    PRIMARY KEY (user_id, code_hash)
  );
  CREATE TABLE IF NOT EXISTS pending_signins (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    approve_row INTEGER
  );
`);

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const index = B32.indexOf(ch);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const step = () => Math.floor(Date.now() / 1000 / 30);

/** The matching time step for a code, allowing one step of clock drift either way. */
function matchStep(secretB32: string, code: string): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = step();
  for (const s of [now - 1, now, now + 1]) {
    const expected = Buffer.from(hotp(secret, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export const hasTwoFactor = (user: User) => !!user.totp_enabled_at && !!user.totp_secret;

// --- Setting it up ---------------------------------------------------------------------------

export function startSetup(userId: number): string {
  const secret = base32Encode(randomBytes(20));
  db.query('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, userId);
  return secret;
}

export async function setupQr(user: User, secret: string): Promise<{ uri: string; svg: string }> {
  const issuer = getBrand().name;
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  // Plain SVG shapes (no style attributes), so it shows under the strict CSP.
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { uri, svg };
}

/** Confirms the first code from the app; returns the recovery codes to show once. */
export function confirmSetup(user: User, code: string): string[] | null {
  if (!user.totp_pending) return null;
  const matched = matchStep(user.totp_pending, code.trim());
  if (matched === null) return null;
  db.query('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000),
    matched,
    user.id,
  );
  return newRecoveryCodes(user.id);
}

export function newRecoveryCodes(userId: number): string[] {
  const codes = Array.from({ length: 10 }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  db.transaction(() => {
    db.query('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    for (const code of codes) db.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)').run(userId, hash(code));
  })();
  return codes;
}

export function recoveryCodesLeft(userId: number): number {
  return db.query<{ n: number }, [number]>('SELECT count(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId)!.n;
}

export function disableTwoFactor(userId: number) {
  db.query('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?').run(userId);
  db.query('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
}

// Recovery codes are compared forgivingly (case, spaces and dashes do not matter).
const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text.toLowerCase().replace(/[\s-]/g, '')).digest('hex');
// Tickets are random tokens and compared exactly.
const tokenHash = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex');

/** A code from the app (each usable once) or an unused recovery code. */
export function verifySecondFactor(user: User, input: string): 'app' | 'recovery' | null {
  const code = input.trim().replace(/\s/g, '');
  if (user.totp_secret && /^[0-9]{6}$/.test(code)) {
    const matched = matchStep(user.totp_secret, code);
    if (matched === null) return null;
    // Checked against the stored step, not the one loaded with `user`: two requests carrying the same
    // code at the same time must not both succeed.
    const spent = db
      .query('UPDATE users SET totp_last_step = ? WHERE id = ? AND coalesce(totp_last_step, -1) < ?')
      .run(matched, user.id, matched);
    return spent.changes === 1 ? 'app' : null;
  }
  const used = db
    .query('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(Math.floor(Date.now() / 1000), user.id, hash(code));
  return used.changes === 1 ? 'recovery' : null;
}

// --- The second step of signing in -----------------------------------------------------------

const PENDING_COOKIE = config.cookieSecure ? '__Host-signin_2fa' : 'signin_2fa';
const PENDING_SECONDS = 10 * 60;

/** The first step succeeded; the browser now holds a short-lived ticket for the code page. */
export function startPendingSignIn(c: Context, userId: number, approveRow?: number) {
  const token = randomBytes(32).toString('base64url');
  db.query('INSERT INTO pending_signins (token_hash, user_id, expires_at, approve_row) VALUES (?, ?, ?, ?)').run(
    tokenHash(token),
    userId,
    Math.floor(Date.now() / 1000) + PENDING_SECONDS,
    approveRow ?? null,
  );
  setCookie(c, PENDING_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax', path: '/', maxAge: PENDING_SECONDS });
}

export type Pending = { userId: number; approveRow: number | null; attempts: number; tokenHash: string };

export function pendingSignIn(c: Context): Pending | null {
  const token = getCookie(c, PENDING_COOKIE);
  if (!token) return null;
  const row = db
    .query<{ user_id: number; approve_row: number | null; attempts: number; expires_at: number }, [string]>(
      'SELECT user_id, approve_row, attempts, expires_at FROM pending_signins WHERE token_hash = ?',
    )
    .get(tokenHash(token));
  if (!row || row.expires_at < Date.now() / 1000) return null;
  return { userId: row.user_id, approveRow: row.approve_row, attempts: row.attempts, tokenHash: tokenHash(token) };
}

// 5 wrong codes end the attempt; the person has to start signing in again.
export function failPendingSignIn(p: Pending): boolean {
  if (p.attempts + 1 >= 5) {
    db.query('DELETE FROM pending_signins WHERE token_hash = ?').run(p.tokenHash);
    return false;
  }
  db.query('UPDATE pending_signins SET attempts = attempts + 1 WHERE token_hash = ?').run(p.tokenHash);
  return true;
}

export function finishPendingSignIn(c: Context, p: Pending) {
  db.query('DELETE FROM pending_signins WHERE token_hash = ?').run(p.tokenHash);
  deleteCookie(c, PENDING_COOKIE, { path: '/', secure: config.cookieSecure });
}

export function purgePendingSignIns() {
  db.query('DELETE FROM pending_signins WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
}

// Exposed for tests of the algorithm against the RFC vectors.
export const _test = { hotp, base32Decode, base32Encode };
