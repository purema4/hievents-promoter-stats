import { db } from './local-db';

/*
 * A media drive per event (photos, videos, flyers): a public folder link an admin sets on Promoters →
 * Media drives. Promoters with a code on the event get a button to it on their dashboard and the event page.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS event_media (
    event_id   INTEGER PRIMARY KEY,
    url        TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Every event's media drive, by event id. */
export function allMediaDrives(): Map<number, string> {
  const rows = db.query<{ event_id: number; url: string }, []>('SELECT event_id, url FROM event_media').all();
  return new Map(rows.map((r) => [r.event_id, r.url]));
}

/** Sets an event's media drive, or removes it with null. */
export function setMediaDrive(eventId: number, url: string | null, by: number) {
  if (!url) {
    db.query('DELETE FROM event_media WHERE event_id = ?').run(eventId);
    return;
  }
  db.query(
    "INSERT INTO event_media (event_id, url, updated_by) VALUES (?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET url = excluded.url, updated_by = excluded.updated_by, updated_at = datetime('now')",
  ).run(eventId, url, by);
}

/** '' removes the drive; anything else must be an https link (Google Drive, Dropbox, …). */
export function parseMediaUrl(raw: unknown): string | null | 'invalid' {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  if (text.length > 2000) return 'invalid';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password ? url.href : 'invalid';
  } catch {
    return 'invalid';
  }
}
