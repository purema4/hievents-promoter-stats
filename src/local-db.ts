import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

// Promoter accounts, their promo codes and sessions live here, not in Hi.Events.
mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(join(config.dataDir, 'promoters.sqlite'), { create: true, strict: true });

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    -- Promoters sign in with emailed links and have no password. Only the bootstrap admin needs one.
    password_hash TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    -- NULL means the default COMMISSION_PERCENT applies.
    commission_percent REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS promoter_codes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code    TEXT NOT NULL,
    PRIMARY KEY (user_id, code)
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

// Columns added after the first release.
export function addColumn(table: string, column: string, type: string) {
  if (!db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
// The 6-digit code that goes with each sign-in link.
addColumn('login_tokens', 'code_hash', 'TEXT');
// The browser or installed app that asked for the link waits for it to be opened (see auth.ts).
addColumn('login_tokens', 'wait_hash', 'TEXT');
addColumn('login_tokens', 'requested_from', 'TEXT');
addColumn('login_tokens', 'created_at', 'INTEGER');
addColumn('login_tokens', 'approved_at', 'INTEGER');
addColumn('login_tokens', 'exchanged_at', 'INTEGER');
// Set when a promoter finishes or skips the welcome steps shown on their first sign-in.
addColumn('users', 'onboarded_at', 'INTEGER');

export function markOnboarded(id: number) {
  db.query('UPDATE users SET onboarded_at = coalesce(onboarded_at, ?) WHERE id = ?').run(Math.floor(Date.now() / 1000), id);
}

// Set the first time the promoter opens the installed app, so the install banner stops showing.
addColumn('users', 'app_installed_at', 'INTEGER');

export function markAppInstalled(id: number) {
  db.query('UPDATE users SET app_installed_at = coalesce(app_installed_at, ?) WHERE id = ?').run(Math.floor(Date.now() / 1000), id);
}

// Profile details promoters fill in themselves, and their theme choice.
for (const column of ['first_name', 'last_name', 'phone', 'city', 'instagram', 'theme', 'payout_method', 'payout_details']) {
  addColumn('users', column, 'TEXT');
}

export function updateProfile(
  id: number,
  input: Record<'first_name' | 'last_name' | 'phone' | 'city' | 'instagram' | 'payout_method' | 'payout_details' | 'theme', string | null>,
) {
  db.query(
    'UPDATE users SET first_name = ?, last_name = ?, phone = ?, city = ?, instagram = ?, payout_method = ?, payout_details = ?, theme = ? WHERE id = ?',
  ).run(input.first_name, input.last_name, input.phone, input.city, input.instagram, input.payout_method, input.payout_details, input.theme, id);
  // The display name follows the first and last name once they are filled in.
  const full = [input.first_name, input.last_name].filter(Boolean).join(' ');
  if (full) db.query('UPDATE users SET name = ? WHERE id = ?').run(full, id);
}

export type User = {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  is_admin: number;
  commission_percent: number | null;
  payout_method?: string | null;
  payout_details?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  instagram?: string | null;
  theme?: 'system' | 'light' | 'dark' | null;
  avatar_type?: string | null;
  avatar_source?: 'upload' | 'instagram' | null;
  avatar_for?: string | null;
  avatar_checked_at?: number | null;
  app_installed_at?: number | null;
  onboarded_at?: number | null;
  last_login_at?: number | null;
  last_seen_at?: number | null;
  alias?: string | null;
  page_hidden_at?: number | null;
  totp_secret?: string | null;
  totp_pending?: string | null;
  totp_enabled_at?: number | null;
  totp_last_step?: number | null;
  created_at: string;
};

export function findUserByEmail(email: string): User | null {
  return db.query<User, [string]>('SELECT * FROM users WHERE email = ?').get(email.trim());
}

export function findUser(id: number): User | null {
  return db.query<User, [number]>('SELECT * FROM users WHERE id = ?').get(id);
}

export function listUsers(): (User & { codes: string[] })[] {
  const users = db.query<User, []>('SELECT * FROM users ORDER BY is_admin DESC, name COLLATE NOCASE').all();
  return users.map((u) => ({ ...u, codes: codesFor(u.id) }));
}

export async function createUser(input: {
  email: string;
  name: string;
  password?: string;
  isAdmin: boolean;
  commissionPercent?: number | null;
}): Promise<number> {
  const hash = input.password ? await Bun.password.hash(input.password) : null;
  const row = db
    .query<{ id: number }, [string, string, string | null, number, number | null]>(
      'INSERT INTO users (email, name, password_hash, is_admin, commission_percent) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
    .get(input.email.trim(), input.name.trim(), hash, input.isAdmin ? 1 : 0, input.commissionPercent ?? null);
  return row!.id;
}

export function updateUser(id: number, input: { name: string; email: string; isAdmin: boolean; commissionPercent: number | null }) {
  db.query('UPDATE users SET name = ?, email = ?, is_admin = ?, commission_percent = ? WHERE id = ?').run(
    input.name.trim(),
    input.email.trim(),
    input.isAdmin ? 1 : 0,
    input.commissionPercent,
    id,
  );
}

export function commissionPercentFor(user: User): number {
  return user.commission_percent ?? config.commissionPercent;
}

export async function setPassword(id: number, password: string) {
  const hash = await Bun.password.hash(password);
  db.query('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  // Changing a password signs the user out everywhere.
  db.query('DELETE FROM sessions WHERE user_id = ?').run(id);
}

export function deleteUser(id: number) {
  db.query('DELETE FROM users WHERE id = ?').run(id);
}

export function countAdmins(): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM users WHERE is_admin = 1').get()!.n;
}

// Codes are stored lower-cased and matched case-insensitively against Hi.Events.
export function normalizeCodes(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
}

export function codesFor(userId: number): string[] {
  return db
    .query<{ code: string }, [number]>('SELECT code FROM promoter_codes WHERE user_id = ? ORDER BY code')
    .all(userId)
    .map((r) => r.code);
}

export function setCodes(userId: number, codes: string[]) {
  db.transaction(() => {
    db.query('DELETE FROM promoter_codes WHERE user_id = ?').run(userId);
    const insert = db.query('INSERT INTO promoter_codes (user_id, code) VALUES (?, ?)');
    for (const code of codes) insert.run(userId, code);
  })();
}

// Which promoter(s) each code is assigned to, for the admin overview.
export function codeOwners(): Map<string, string[]> {
  const rows = db
    .query<{ code: string; name: string }, []>(
      'SELECT pc.code, u.name FROM promoter_codes pc JOIN users u ON u.id = pc.user_id ORDER BY u.name',
    )
    .all();
  const owners = new Map<string, string[]>();
  for (const row of rows) owners.set(row.code, [...(owners.get(row.code) ?? []), row.name]);
  return owners;
}
