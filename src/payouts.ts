import { config } from './config';
import { moneyAdjustments } from './adjustments';
import { addColumn, db, type User } from './local-db';
import type { Totals } from './money';

db.exec(`
  CREATE TABLE IF NOT EXISTS payout_requests (
    id             INTEGER PRIMARY KEY,
    -- Kept when a promoter is deleted, so the payment history survives; the name and email are a snapshot.
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    promoter_name  TEXT NOT NULL,
    promoter_email TEXT NOT NULL,
    amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
    currency       TEXT NOT NULL,
    method         TEXT NOT NULL,
    details        TEXT,
    note           TEXT,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
    admin_note     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at   TEXT,
    processed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS payout_requests_user ON payout_requests (user_id, status);
`);
// Remembered so promoters do not retype their payment details every time.
addColumn('users', 'payout_method', 'TEXT');
addColumn('users', 'payout_details', 'TEXT');
addColumn('payout_requests', 'details', 'TEXT');

export type PayoutRequest = {
  id: number;
  user_id: number | null;
  promoter_name: string;
  promoter_email: string;
  amount_cents: number;
  currency: string;
  method: string;
  details: string | null;
  note: string | null;
  status: 'pending' | 'paid' | 'rejected';
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
};

export type Balance = {
  currency: string;
  fromSales: number; // commission on Hi.Events sales
  added: number; // money added (or removed) by admins
  earned: number; // fromSales + added
  paidOut: number;
  pending: number;
  available: number;
};

export function payoutsFor(userId: number): PayoutRequest[] {
  return db
    .query<PayoutRequest, [number]>('SELECT * FROM payout_requests WHERE user_id = ? ORDER BY id DESC')
    .all(userId);
}

export function listPayouts(status: 'pending' | 'done'): PayoutRequest[] {
  const where = status === 'pending' ? "status = 'pending'" : "status <> 'pending'";
  return db
    .query<PayoutRequest, []>(`SELECT * FROM payout_requests WHERE ${where} ORDER BY id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`)
    .all();
}

export function countPendingPayouts(): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM payout_requests WHERE status = 'pending'").get()!.n;
}

export function findPayout(id: number): PayoutRequest | null {
  return db.query<PayoutRequest, [number]>('SELECT * FROM payout_requests WHERE id = ?').get(id);
}

/**
 * Earned commission minus what has been paid out or is waiting to be. Refunds after a payout
 * can make it negative; that is shown as-is and nets out of the next payout.
 */
export function balances(userId: number, totals: Totals[]): Balance[] {
  const rows = db
    .query<{ currency: string; status: string; cents: number }, [number]>(
      "SELECT currency, status, sum(amount_cents) AS cents FROM payout_requests WHERE user_id = ? AND status <> 'rejected' GROUP BY currency, status",
    )
    .all(userId);
  const added = moneyAdjustments(userId);
  const currencies = new Set([...totals.map((t) => t.currency), ...rows.map((r) => r.currency), ...added.keys()]);
  return [...currencies].map((currency) => {
    const fromSales = totals.find((t) => t.currency === currency)?.commission ?? 0;
    const extra = added.get(currency) ?? 0;
    const earned = fromSales + extra;
    const paidOut = rows.find((r) => r.currency === currency && r.status === 'paid')?.cents ?? 0;
    const pending = rows.find((r) => r.currency === currency && r.status === 'pending')?.cents ?? 0;
    return { currency, fromSales, added: extra, earned, paidOut, pending, available: earned - paidOut - pending };
  });
}

export type RequestResult = 'ok' | 'invalid_amount' | 'too_much' | 'already_pending' | 'missing_method' | 'cash_step';

// The most that can be taken in cash: the available balance rounded down to a whole CASH_STEP.
export function cashAvailable(balance: Balance): number {
  return Math.max(0, Math.floor(balance.available / config.cashStepCents) * config.cashStepCents);
}

export function requestPayout(
  user: User,
  balance: Balance,
  input: { amountCents: number; method: string; details: string; note: string },
): RequestResult {
  if (!config.payoutMethods.includes(input.method)) return 'missing_method';
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'invalid_amount';
  if (input.method === config.cashMethod && input.amountCents % config.cashStepCents !== 0) return 'cash_step';
  // Checked and inserted in one transaction so a double submit cannot create two requests.
  return db.transaction((): RequestResult => {
    const open = db
      .query<{ n: number }, [number, string]>(
        "SELECT count(*) AS n FROM payout_requests WHERE user_id = ? AND currency = ? AND status = 'pending'",
      )
      .get(user.id, balance.currency)!.n;
    if (open > 0) return 'already_pending';
    if (input.amountCents > balance.available) return 'too_much';
    db.query(
      'INSERT INTO payout_requests (user_id, promoter_name, promoter_email, amount_cents, currency, method, details, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(user.id, user.name, user.email, input.amountCents, balance.currency, input.method, input.details.trim() || null, input.note.trim() || null);
    db.query('UPDATE users SET payout_method = ?, payout_details = ? WHERE id = ?').run(input.method, input.details.trim() || null, user.id);
    return 'ok';
  })();
}

export function settlePayout(id: number, adminId: number, status: 'paid' | 'rejected', adminNote: string): boolean {
  const result = db
    .query(
      "UPDATE payout_requests SET status = ?, admin_note = ?, processed_at = datetime('now'), processed_by = ? WHERE id = ? AND status = 'pending'",
    )
    .run(status, adminNote.trim() || null, adminId, id);
  return result.changes === 1;
}
