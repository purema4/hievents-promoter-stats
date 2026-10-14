import { db, type User } from './local-db';

/*
 * Changes an admin makes by hand: money added or removed, sales from events outside Hi.Events,
 * and free tickets or merch given or taken back. Each one is a dated entry with a reason, so the
 * promoter's numbers stay explainable, and any entry can be undone.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS adjustments (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('money', 'tickets_sold', 'free_tickets', 'merch')),
    amount_cents INTEGER NOT NULL DEFAULT 0,  -- money
    quantity     INTEGER NOT NULL DEFAULT 0,  -- tickets sold, free tickets or merch items (negative takes back)
    currency     TEXT,
    event_id     INTEGER,                     -- the Hi.Events event, for free tickets
    label        TEXT NOT NULL,               -- what it is for, shown to the promoter
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS adjustments_user ON adjustments (user_id, kind);
`);

export type AdjustmentKind = 'money' | 'tickets_sold' | 'free_tickets' | 'merch';

export type Adjustment = {
  id: number;
  user_id: number;
  kind: AdjustmentKind;
  amount_cents: number;
  quantity: number;
  currency: string | null;
  event_id: number | null;
  label: string;
  created_by: number | null;
  created_at: string;
};

export function addAdjustment(
  admin: User,
  userId: number,
  entry: { kind: AdjustmentKind; amountCents?: number; quantity?: number; currency?: string; eventId?: number | null; label: string },
): number {
  return db
    .query<{ id: number }, [number, string, number, number, string | null, number | null, string, number]>(
      'INSERT INTO adjustments (user_id, kind, amount_cents, quantity, currency, event_id, label, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .get(
      userId,
      entry.kind,
      entry.amountCents ?? 0,
      entry.quantity ?? 0,
      entry.currency ?? null,
      entry.eventId ?? null,
      entry.label.trim().slice(0, 200),
      admin.id,
    )!.id;
}

export function hasAdjustments(userId: number): boolean {
  return !!db.query('SELECT 1 FROM adjustments WHERE user_id = ? LIMIT 1').get(userId);
}

export function adjustmentsFor(userId: number): Adjustment[] {
  return db.query<Adjustment, [number]>('SELECT * FROM adjustments WHERE user_id = ? ORDER BY id DESC').all(userId);
}

export function findAdjustment(id: number): Adjustment | null {
  return db.query<Adjustment, [number]>('SELECT * FROM adjustments WHERE id = ?').get(id);
}

export function removeAdjustment(id: number) {
  db.query('DELETE FROM adjustments WHERE id = ?').run(id);
}

/** Money added or removed by admins, per currency, in cents. */
export function moneyAdjustments(userId: number): Map<string, number> {
  const rows = db
    .query<{ currency: string; cents: number }, [number]>(
      "SELECT coalesce(currency, 'CAD') AS currency, sum(amount_cents) AS cents FROM adjustments WHERE user_id = ? AND kind = 'money' GROUP BY 1",
    )
    .all(userId);
  return new Map(rows.map((r) => [r.currency, r.cents]));
}

/** Tickets sold outside Hi.Events; with a date range, only the entries made in it (YYYY-MM-DD, in UTC). */
export function outsideTickets(userId: number, from?: string, to?: string): number {
  if (from && to) {
    return db
      .query<{ n: number | null }, [number, string, string]>(
        "SELECT sum(quantity) AS n FROM adjustments WHERE user_id = ? AND kind = 'tickets_sold' AND date(created_at) BETWEEN ? AND ?",
      )
      .get(userId, from, to)!.n ?? 0;
  }
  return db.query<{ n: number | null }, [number]>("SELECT sum(quantity) AS n FROM adjustments WHERE user_id = ? AND kind = 'tickets_sold'").get(userId)!.n ?? 0;
}

/** Money added in a date range (for the leaderboard), per currency. */
export function moneyAdjustmentsBetween(userId: number, from: string, to: string): number {
  return (
    db
      .query<{ cents: number | null }, [number, string, string]>(
        "SELECT sum(amount_cents) AS cents FROM adjustments WHERE user_id = ? AND kind = 'money' AND date(created_at) BETWEEN ? AND ?",
      )
      .get(userId, from, to)!.cents ?? 0
  );
}

/** Hand-entered sales and money per day they were entered (UTC), for the admin chart. */
export function adjustmentsByDay(userId: number): { day: string; tickets: number; cents: number }[] {
  return db
    .query<{ day: string; tickets: number; cents: number }, [number]>(
      "SELECT date(created_at) AS day, sum(CASE WHEN kind = 'tickets_sold' THEN quantity ELSE 0 END) AS tickets, sum(CASE WHEN kind = 'money' THEN amount_cents ELSE 0 END) AS cents FROM adjustments WHERE user_id = ? AND kind IN ('tickets_sold', 'money') GROUP BY 1",
    )
    .all(userId);
}

export function freeTicketBonus(userId: number): Map<number, number> {
  const rows = db
    .query<{ event_id: number; n: number }, [number]>(
      "SELECT event_id, sum(quantity) AS n FROM adjustments WHERE user_id = ? AND kind = 'free_tickets' AND event_id IS NOT NULL GROUP BY event_id",
    )
    .all(userId);
  return new Map(rows.map((r) => [r.event_id, r.n]));
}

export function merchBonus(userId: number): number {
  return db.query<{ n: number | null }, [number]>("SELECT sum(quantity) AS n FROM adjustments WHERE user_id = ? AND kind = 'merch'").get(userId)!.n ?? 0;
}

export function describeAdjustment(a: Adjustment, money: (cents: number, currency: string) => string): string {
  const signed = (n: number, one: string, many = `${one}s`) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${Math.abs(n) === 1 ? one : many}`;
  switch (a.kind) {
    case 'money':
      return `${a.amount_cents >= 0 ? '+' : '−'}${money(Math.abs(a.amount_cents), a.currency ?? 'CAD')}`;
    case 'tickets_sold':
      return `${signed(a.quantity, 'ticket')} sold`;
    case 'free_tickets':
      return signed(a.quantity, 'free ticket');
    case 'merch':
      return signed(a.quantity, 'merch item');
  }
}
