import { commissionLine, eventCommissionsOf, setRuleLine, usualCommission } from './rules';
import { db, type User } from './local-db';
import type { EventRule, LegacyRate } from './money';

/*
 * Commission set by admins for one promoter on one event (on Pay & rewards → Commissions): another
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

/** A promoter's usual rate and their event rates, as the rules give them (null: a custom rule). */
export function rateFor(user: User): LegacyRate {
  const events = new Map([...eventCommissionsOf(user.id)].map(([id, s]) => [id, s.rule]));
  return { usual: usualCommission(user.id).rule, events };
}

/** Sets a promoter's rate for an event, or back to their usual rate with null. */
export function setEventRule(userId: number, eventId: number, rule: EventRule | null, by: number | null = null) {
  // The rule is what counts; this table only remembers how the rate was entered.
  setRuleLine('promoter_event', { userId, eventId }, 'commission', rule ? commissionLine(rule) : null, by);
  if (!rule) {
    db.query('DELETE FROM event_commissions WHERE user_id = ? AND event_id = ?').run(userId, eventId);
    return;
  }
  db.query(
    'INSERT INTO event_commissions (user_id, event_id, kind, value) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, event_id) DO UPDATE SET kind = excluded.kind, value = excluded.value',
  ).run(userId, eventId, rule.kind, rule.value);
}
