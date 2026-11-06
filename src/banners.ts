import { db } from './local-db';

/*
 * Notices admins set on Promoters → Banners: one for all promoters, at the top of their pages, and
 * one per event, on its dashboard card and event page. Plain text, shown only while there is any.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS event_banners (
    event_id   INTEGER PRIMARY KEY,
    message    TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const BANNER_MAX_LENGTH = 500;
const generalKey = 'generalBanner';

export function parseBanner(raw: unknown): string {
  return String(raw ?? '').replace(/\r\n?/g, '\n').trim().slice(0, BANNER_MAX_LENGTH).trim();
}

/** The notice for all promoters; '' when there is none. */
export function generalBanner(): string {
  return db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(generalKey)?.value ?? '';
}

/** Sets the notice for all promoters, or removes it with ''. */
export function setGeneralBanner(message: string) {
  if (!message) {
    db.query('DELETE FROM settings WHERE key = ?').run(generalKey);
    return;
  }
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(generalKey, message);
}

/** Every event's notice, by event id. */
export function allEventBanners(): Map<number, string> {
  const rows = db.query<{ event_id: number; message: string }, []>('SELECT event_id, message FROM event_banners').all();
  return new Map(rows.map((r) => [r.event_id, r.message]));
}

/** Sets an event's notice, or removes it with ''. */
export function setEventBanner(eventId: number, message: string, by: number) {
  if (!message) {
    db.query('DELETE FROM event_banners WHERE event_id = ?').run(eventId);
    return;
  }
  db.query(
    "INSERT INTO event_banners (event_id, message, updated_by) VALUES (?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET message = excluded.message, updated_by = excluded.updated_by, updated_at = datetime('now')",
  ).run(eventId, message, by);
}
