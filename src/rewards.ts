import { freeTicketBonus, merchBonus, outsideTickets } from './adjustments';
import { addColumn, db, type User } from './local-db';
import type { EventSummary } from './promoter-views';
import { earnedOn, labelOf, nextOn, rewardRules, type Next } from './reward-rules';

db.exec(`
  CREATE TABLE IF NOT EXISTS reward_requests (
    id             INTEGER PRIMARY KEY,
    -- Kept when a promoter is deleted; the name and email are a snapshot, like payouts.
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    promoter_name  TEXT NOT NULL,
    promoter_email TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('ticket', 'merch')),
    event_id       INTEGER,
    event_title    TEXT,
    quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    details        TEXT,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'rejected')),
    admin_note     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at   TEXT,
    processed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS reward_requests_user ON reward_requests (user_id, kind, status);
`);
addColumn('reward_requests', 'details', 'TEXT');

export type RewardRequest = {
  id: number;
  user_id: number | null;
  promoter_name: string;
  promoter_email: string;
  kind: 'ticket' | 'merch';
  event_id: number | null;
  event_title: string | null;
  quantity: number;
  details: string | null;
  status: 'pending' | 'fulfilled' | 'rejected';
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
};

// --- The rules (set by admins, see reward-rules.ts) -----------------------------------------

export { levelFor, type Level } from './reward-rules';

export const freeTicketsEarned = (sold: number) => earnedOn(rewardRules().tickets, sold);
export const merchEarned = (totalSold: number) => earnedOn(rewardRules().merch, totalSold);
/** Sales to the next free ticket for an event; null when there are no more to earn. */
export const salesToNextFreeTicket = (sold: number) => nextOn(rewardRules().tickets, sold)?.in ?? null;
export const salesToNextMerch = (totalSold: number) => nextOn(rewardRules().merch, totalSold)?.in ?? null;

// --- What a promoter can request now ---------------------------------------------------------

export type TicketReward = {
  event: EventSummary;
  earned: number; // from sales plus what admins gave or took back
  bonus: number; // the admin part of earned
  used: number; // requested or given, not declined
  available: number;
  nextIn: number | null; // sales to the next one; null when the rules give no more
  progress: number; // percent of the way to the next one
};

export type Rewards = {
  totalSold: number; // Hi.Events sales plus tickets sold outside it, entered by admins
  outsideSold: number;
  tickets: TicketReward[]; // upcoming events only: a free ticket for a past event is no use
  merch: {
    earned: number;
    bonus: number;
    used: number;
    available: number;
    nextIn: number | null;
    progress: number;
    /** What the next merch milestone gives, like "Hoodie"; '' when it has no name. */
    nextLabel: string;
    /** The name of the item waiting to be requested, when the milestone has one. */
    readyLabel: string;
  };
};

const isUpcoming = (e: EventSummary) => !e.end || e.end.getTime() >= Date.now();

export function rewardsFor(userId: number, events: EventSummary[]): Rewards {
  const used = db
    .query<{ kind: string; event_id: number | null; n: number }, [number]>(
      "SELECT kind, event_id, sum(quantity) AS n FROM reward_requests WHERE user_id = ? AND status <> 'rejected' GROUP BY kind, event_id",
    )
    .all(userId);
  const usedTickets = (eventId: number) => used.find((u) => u.kind === 'ticket' && u.event_id === eventId)?.n ?? 0;
  const outsideSold = outsideTickets(userId);
  const totalSold = events.reduce((sum, e) => sum + e.tickets, 0) + outsideSold;
  const merchUsed = used.filter((u) => u.kind === 'merch').reduce((sum, u) => sum + u.n, 0);
  const extraMerch = merchBonus(userId);
  const merch = Math.max(0, merchEarned(totalSold) + extraMerch);
  const extraTickets = freeTicketBonus(userId);
  const rules = rewardRules();
  const nextMerch: Next | null = nextOn(rules.merch, totalSold);
  return {
    totalSold,
    outsideSold,
    tickets: events.filter(isUpcoming).map((event) => {
      const bonus = extraTickets.get(event.id) ?? 0;
      const earned = Math.max(0, freeTicketsEarned(event.tickets) + bonus);
      const usedHere = usedTickets(event.id);
      const next = nextOn(rules.tickets, event.tickets);
      return {
        event,
        earned,
        bonus,
        used: usedHere,
        available: Math.max(0, earned - usedHere),
        nextIn: next?.in ?? null,
        progress: next?.progress ?? 100,
      };
    }),
    merch: {
      earned: merch,
      bonus: extraMerch,
      used: merchUsed,
      available: Math.max(0, merch - merchUsed),
      nextIn: nextMerch?.in ?? null,
      progress: nextMerch?.progress ?? 100,
      nextLabel: nextMerch?.label ?? '',
      readyLabel: merch > merchUsed ? labelOf(rules.merch, merchUsed + 1) : '',
    },
  };
}

export type RewardResult = 'ok' | 'not_available' | 'missing_details';

export function requestReward(
  user: User,
  rewards: Rewards,
  input: { kind: 'ticket' | 'merch'; eventId?: number; quantity: number; details: string },
): RewardResult {
  const details = input.details.trim();
  if (input.kind === 'merch' && !details) return 'missing_details';
  const ticket = input.kind === 'ticket' ? rewards.tickets.find((t) => t.event.id === input.eventId) : undefined;
  if (input.kind === 'ticket' && !ticket) return 'not_available';
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return 'not_available';
  // Re-counted inside the transaction so two quick submits cannot claim the same reward twice.
  return db.transaction((): RewardResult => {
    const fresh = rewardsFor(user.id, ticket ? [ticket.event] : []);
    const available = input.kind === 'ticket' ? (fresh.tickets[0]?.available ?? 0) : Math.max(0, rewards.merch.earned - fresh.merch.used);
    if (input.quantity > available) return 'not_available';
    db.query(
      'INSERT INTO reward_requests (user_id, promoter_name, promoter_email, kind, event_id, event_title, quantity, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      user.id,
      user.name,
      user.email,
      input.kind,
      ticket?.event.id ?? null,
      ticket?.event.title ?? null,
      input.quantity,
      details || null,
    );
    return 'ok';
  })();
}

export function rewardRequestsFor(userId: number): RewardRequest[] {
  return db.query<RewardRequest, [number]>('SELECT * FROM reward_requests WHERE user_id = ? ORDER BY id DESC').all(userId);
}

export function listRewardRequests(status: 'pending' | 'done'): RewardRequest[] {
  const where = status === 'pending' ? "status = 'pending'" : "status <> 'pending'";
  return db
    .query<RewardRequest, []>(`SELECT * FROM reward_requests WHERE ${where} ORDER BY id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`)
    .all();
}

export function countPendingRewards(): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM reward_requests WHERE status = 'pending'").get()!.n;
}

export function findRewardRequest(id: number): RewardRequest | null {
  return db.query<RewardRequest, [number]>('SELECT * FROM reward_requests WHERE id = ?').get(id);
}

export function settleReward(id: number, adminId: number, status: 'fulfilled' | 'rejected', adminNote: string): boolean {
  return (
    db
      .query(
        "UPDATE reward_requests SET status = ?, admin_note = ?, processed_at = datetime('now'), processed_by = ? WHERE id = ? AND status = 'pending'",
      )
      .run(status, adminNote.trim() || null, adminId, id).changes === 1
  );
}

export function describeReward(r: RewardRequest): string {
  return r.kind === 'merch' ? 'Merch' : `${r.quantity} free ${r.quantity === 1 ? 'ticket' : 'tickets'} for ${r.event_title}`;
}
