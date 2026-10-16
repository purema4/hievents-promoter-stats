import { commissionPercentFor, db, type User } from './local-db';
import type { EventRule, Rate } from './money';

/*
 * Commission set by admins for one promoter on one event (on Promoters → Commissions): another
 * percentage, or a flat amount per ticket sold. Everywhere else the promoter's usual rate applies.
 * Like the usual rate, a change applies to all the event's sales, earlier ones too.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS event_commissions (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('percent', 'flat')),
    value    REAL NOT NULL, -- a percentage, or cents per ticket
    PRIMARY KEY (user_id, event_id)
  );
`);

/** A promoter's usual rate and their event rates. */
export function rateFor(user: User): Rate {
  const rows = db
    .query<{ event_id: number } & EventRule, [number]>('SELECT event_id, kind, value FROM event_commissions WHERE user_id = ?')
    .all(user.id);
  return { percent: commissionPercentFor(user), events: new Map(rows.map((r) => [r.event_id, { kind: r.kind, value: r.value }])) };
}

/** Every event rate, by "userId:eventId". */
export function allEventRules(): Map<string, EventRule> {
  const rows = db.query<{ user_id: number; event_id: number } & EventRule, []>('SELECT user_id, event_id, kind, value FROM event_commissions').all();
  return new Map(rows.map((r) => [`${r.user_id}:${r.event_id}`, { kind: r.kind, value: r.value }]));
}

/** Sets a promoter's rate for an event, or back to their usual rate with null. */
export function setEventRule(userId: number, eventId: number, rule: EventRule | null) {
  if (!rule) {
    db.query('DELETE FROM event_commissions WHERE user_id = ? AND event_id = ?').run(userId, eventId);
    return;
  }
  db.query(
    'INSERT INTO event_commissions (user_id, event_id, kind, value) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, event_id) DO UPDATE SET kind = excluded.kind, value = excluded.value',
  ).run(userId, eventId, rule.kind, rule.value);
}
