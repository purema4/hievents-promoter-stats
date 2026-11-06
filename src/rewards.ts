import { freeTicketBonus, merchBonus, outsideTickets } from './adjustments';
import { addColumn, db, type User } from './local-db';
import type { EventSummary } from './promoter-views';
import type { Rate } from './money';
import { earnedOn, labelOf, nextOn, rewardRules, type Next } from './reward-rules';
import { listRewardTypes, type RewardType } from './rules';

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
// Free tickets are earned on one event. Asked for another event, they are rolled over: event_id is where
// they are used, source_event_id where they were earned. NULL for older requests, earned where used.
addColumn('reward_requests', 'source_event_id', 'INTEGER');
addColumn('reward_requests', 'source_event_title', 'TEXT');
// The reward type (VIP, GA list…; NULL for plain free tickets), its name when asked, and the rule
// versions that gave it, so a past request can be explained.
addColumn('reward_requests', 'reward_type', 'TEXT');
addColumn('reward_requests', 'reward_label', 'TEXT');
addColumn('reward_requests', 'rule_versions', 'TEXT');
/*
 * The bank. A promoter can ask to put rewards of an event in their bank (event_id NULL, source_event_id
 * the event): admins accept or decline, like any request. Accepted, they stay there whatever happens to
 * the event, with their type, until asked for an upcoming event (from_bank = 1, source_event_id NULL).
 */
addColumn('reward_requests', 'from_bank', 'INTEGER');

export const FREE_TICKETS = 'free_tickets';

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
  source_event_id: number | null;
  source_event_title: string | null;
  reward_type: string | null;
  reward_label: string | null;
  rule_versions: string | null;
  from_bank: number | null;
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
  type: RewardType;
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
  tickets: TicketReward[]; // per upcoming event and reward type: a free ticket for a past event is no use
  /** What is in the bank, by type: kept whatever happens to the events they came from. */
  bank: BankBalance[];
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

export type BankBalance = { type: RewardType; balance: number; pending: number };

/** Requested to go into the bank, still waiting for the team. */
export const isDeposit = (r: RewardRequest) => r.kind === 'ticket' && r.event_id === null && r.source_event_id !== null;

/** The bank, by reward type: accepted deposits, minus what was asked for out of it (not declined). */
export function bankFor(userId: number): Map<string, { balance: number; pending: number }> {
  const rows = db
    .query<{ type: string; banked: number; pending: number; out: number }, [number]>(
      `SELECT coalesce(reward_type, '${FREE_TICKETS}') AS type,
         sum(CASE WHEN event_id IS NULL AND source_event_id IS NOT NULL AND status = 'fulfilled' THEN quantity ELSE 0 END) AS banked,
         sum(CASE WHEN event_id IS NULL AND source_event_id IS NOT NULL AND status = 'pending' THEN quantity ELSE 0 END) AS pending,
         sum(CASE WHEN from_bank = 1 AND status <> 'rejected' THEN quantity ELSE 0 END) AS out
       FROM reward_requests WHERE user_id = ? AND kind = 'ticket' GROUP BY 1`,
    )
    .all(userId);
  return new Map(rows.map((r) => [r.type, { balance: r.banked - r.out, pending: r.pending }]));
}

const plainFreeTickets: RewardType = { key: FREE_TICKETS, label_en: 'Free tickets', label_fr: 'Billets gratuits' };

/** Requested or given rewards (not declined), by "kind:sourceEvent:type". */
function usedRewards(userId: number): Map<string, number> {
  const rows = db
    .query<{ kind: string; event_id: number | null; type: string; n: number }, [number]>(
      `SELECT kind, coalesce(source_event_id, event_id) AS event_id, coalesce(reward_type, '${FREE_TICKETS}') AS type, sum(quantity) AS n
       FROM reward_requests WHERE user_id = ? AND status <> 'rejected' AND from_bank IS NOT 1 GROUP BY 1, 2, 3`,
    )
    .all(userId);
  return new Map(rows.map((r) => [`${r.kind}:${r.event_id}:${r.type}`, r.n]));
}

/**
 * What a promoter can request. Ticket rewards come from each event's rule (a bare number rate stands
 * for the free-ticket track of Levels & rewards, as before rules); merch from the merch track plus any
 * merch the rules give.
 */
export function rewardsFor(userId: number, events: EventSummary[], rate: Rate | number = 0): Rewards {
  const used = usedRewards(userId);
  const outsideSold = outsideTickets(userId);
  const totalSold = events.reduce((sum, e) => sum + e.tickets, 0) + outsideSold;
  const merchUsed = [...used].filter(([k]) => k.startsWith('merch:')).reduce((sum, [, n]) => sum + n, 0);
  const extraMerch = merchBonus(userId);
  const fromRules = typeof rate === 'number' ? 0 : [...rate.events.values()].reduce((sum, e) => sum + e.merch, 0);
  const merch = Math.max(0, merchEarned(totalSold) + fromRules + extraMerch);
  const extraTickets = freeTicketBonus(userId);
  const rules = rewardRules();
  const nextMerch: Next | null = nextOn(rules.merch, totalSold);
  const types = new Map(listRewardTypes().map((t) => [t.key, t]));
  const order = [...types.keys()];

  const tickets: TicketReward[] = [];
  for (const event of events.filter(isUpcoming)) {
    const earning = typeof rate === 'number' ? null : rate.events.get(event.id);
    const counts: Record<string, number> = earning ? { ...earning.rewards } : { [FREE_TICKETS]: freeTicketsEarned(event.tickets) };
    for (const key of extraTickets.keys()) {
      const [id, type] = key.split(':') as [string, string];
      if (Number(id) === event.id && !(type in counts)) counts[type] = 0;
    }
    const keys = Object.keys(counts).sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    for (const key of keys) {
      const bonus = extraTickets.get(`${event.id}:${key}`) ?? 0;
      const earned = Math.max(0, counts[key]! + bonus);
      const usedHere = used.get(`ticket:${event.id}:${key}`) ?? 0;
      const next = earning ? (earning.next[key] ?? null) : (() => {
        const n = nextOn(rules.tickets, event.tickets);
        return n ? { in: n.in, progress: n.progress } : null;
      })();
      // A type a rule gives 0 of, with nothing given by hand or requested, is not worth a line.
      if (earned === 0 && usedHere === 0 && !next) continue;
      tickets.push({
        event,
        type: types.get(key) ?? (key === FREE_TICKETS ? plainFreeTickets : { key, label_en: key, label_fr: key }),
        earned,
        bonus,
        used: usedHere,
        available: Math.max(0, earned - usedHere),
        nextIn: next?.in ?? null,
        progress: next?.progress ?? 100,
      });
    }
  }
  const typeOf = (key: string) => types.get(key) ?? (key === FREE_TICKETS ? plainFreeTickets : { key, label_en: key, label_fr: key });
  const bank = [...bankFor(userId)]
    .filter(([, b]) => b.balance > 0 || b.pending > 0)
    .map(([key, b]) => ({ type: typeOf(key), ...b }))
    .sort((a, b) => (order.indexOf(a.type.key) + 1 || 999) - (order.indexOf(b.type.key) + 1 || 999));
  return {
    totalSold,
    outsideSold,
    tickets,
    bank,
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
  // eventId: the event the reward was earned on; rewardType: which reward (free tickets by default);
  // useFor: another upcoming event to roll it over to (older requests; the shop uses the bank);
  // toBank: put it in the bank; fromBank: take it out of the bank for this upcoming event;
  // ruleVersions: the rule versions that gave it.
  input: {
    kind: 'ticket' | 'merch';
    eventId?: number;
    rewardType?: string;
    useFor?: { id: number; title: string };
    toBank?: boolean;
    fromBank?: { id: number; title: string };
    quantity: number;
    details: string;
    ruleVersions?: number[];
  },
): RewardResult {
  const details = input.details.trim();
  if (input.kind === 'merch' && !details) return 'missing_details';
  const type = input.rewardType || FREE_TICKETS;
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return 'not_available';
  if (input.kind === 'ticket' && input.fromBank) {
    const event = input.fromBank;
    const label = rewards.bank.find((b) => b.type.key === type)?.type.label_en ?? null;
    return db.transaction((): RewardResult => {
      if (input.quantity > (bankFor(user.id).get(type)?.balance ?? 0)) return 'not_available';
      db.query(
        `INSERT INTO reward_requests (user_id, promoter_name, promoter_email, kind, event_id, event_title, quantity, details,
           reward_type, reward_label, from_bank) VALUES (?, ?, ?, 'ticket', ?, ?, ?, ?, ?, ?, 1)`,
      ).run(user.id, user.name, user.email, event.id, event.title, input.quantity, details || null, type !== FREE_TICKETS ? type : null, type !== FREE_TICKETS ? label : null);
      return 'ok';
    })();
  }
  const ticket = input.kind === 'ticket' ? rewards.tickets.find((t) => t.event.id === input.eventId && t.type.key === type) : undefined;
  if (input.kind === 'ticket' && !ticket) return 'not_available';
  const target = ticket && !input.toBank && input.useFor && input.useFor.id !== ticket.event.id ? input.useFor : null;
  const toBank = !!ticket && !!input.toBank;
  // Re-counted inside the transaction so two quick submits cannot claim the same reward twice.
  return db.transaction((): RewardResult => {
    const used = usedRewards(user.id);
    const available = ticket
      ? ticket.earned - (used.get(`ticket:${ticket.event.id}:${type}`) ?? 0)
      : rewards.merch.earned - [...used].filter(([k]) => k.startsWith('merch:')).reduce((sum, [, n]) => sum + n, 0);
    if (input.quantity > available) return 'not_available';
    db.query(
      `INSERT INTO reward_requests (user_id, promoter_name, promoter_email, kind, event_id, event_title, quantity, details,
         source_event_id, source_event_title, reward_type, reward_label, rule_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      user.id,
      user.name,
      user.email,
      input.kind,
      toBank ? null : (target?.id ?? ticket?.event.id ?? null),
      toBank ? null : (target?.title ?? ticket?.event.title ?? null),
      input.quantity,
      details || null,
      ticket?.event.id ?? null,
      ticket?.event.title ?? null,
      ticket && type !== FREE_TICKETS ? type : null,
      ticket && type !== FREE_TICKETS ? ticket.type.label_en : null,
      input.ruleVersions?.length ? JSON.stringify(input.ruleVersions) : null,
    );
    return 'ok';
  })();
}

export type RewardInput = Parameters<typeof requestReward>[2];

/**
 * A whole cart from the rewards shop: every item is requested, or none is. `failed` is the index of the
 * item that could not be, so the promoter can be told which one.
 */
export function requestRewards(user: User, rewards: Rewards, items: RewardInput[]): { result: RewardResult; failed?: number } {
  if (items.length === 0) return { result: 'not_available' };
  class Stop extends Error {
    constructor(
      readonly result: RewardResult,
      readonly index: number,
    ) {
      super(result);
    }
  }
  try {
    // Each item is counted again inside this one transaction, earlier items of the cart included.
    db.transaction(() => {
      items.forEach((item, i) => {
        const result = requestReward(user, rewards, item);
        if (result !== 'ok') throw new Stop(result, i);
      });
    })();
    return { result: 'ok' };
  } catch (err) {
    if (err instanceof Stop) return { result: err.result, failed: err.index };
    throw err;
  }
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

/** Free tickets asked for another event than the one they were earned on. */
export const isRollover = (r: RewardRequest) =>
  r.kind === 'ticket' && r.event_id !== null && r.source_event_id !== null && r.source_event_id !== r.event_id;

export function describeReward(r: RewardRequest): string {
  if (r.kind === 'merch') return 'Merch';
  const tickets = r.reward_type ? `${r.quantity} ${r.reward_label ?? r.reward_type}` : `${r.quantity} free ${r.quantity === 1 ? 'ticket' : 'tickets'}`;
  if (isDeposit(r)) return `${tickets} into the bank, from ${r.source_event_title}`;
  if (r.from_bank) return `${tickets} for ${r.event_title}, from the bank`;
  return isRollover(r) ? `${tickets} for ${r.event_title}, rolled over from ${r.source_event_title}` : `${tickets} for ${r.event_title}`;
}
