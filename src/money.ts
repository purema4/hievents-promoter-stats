import type { CodeStats } from './hievents';

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

/**
 * An amount typed in a form, in cents; NaN when it is not one. Accepts the ways people write money here:
 * 25, 25.50, 25,50, 310$, 310 $, $310, 1 234,50 $, 1,234.50, CAD 40.
 */
export function parseAmountCents(input: string): number {
  // Spaces (including the non-breaking ones French formatting uses), the dollar sign and the currency go.
  // Only at either end: 25$50 is not an amount.
  let raw = input.replace(/[\s\u00a0\u202f]/g, '').replace(/^(\$|CAD\$?)|(\$|CAD)$/gi, '');
  // With both separators, the comma groups thousands; alone, it is the decimal point.
  raw = raw.includes('.') ? raw.replace(/,(?=\d{3}(\D|$))/g, '') : raw.replace(',', '.');
  return /^[0-9]+(\.[0-9]{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : NaN;
}

// Rounded once per (code, event) row; every total is a sum of these, so the numbers always agree.
export function commissionCents(fullPrice: string, percent: number): number {
  return Math.round(Number(fullPrice) * percent);
}

// A percentage or a flat amount per ticket (cents): how commission was set before rules, and still how
// the Commissions page and the usual rate are entered. They are saved as rules (see rules.ts).
export type EventRule = { kind: 'percent' | 'flat'; value: number };
/** A promoter's usual rate and the rates set per event, as entered (for describing them). */
export type LegacyRate = { usual: EventRule; events: Map<number, EventRule> };

/** What the rules gave a promoter on one event (see earnings.ts). */
export type EventEarning = {
  commission: number; // cents, never negative
  bonus: number; // cents, kept apart from the commission
  merch: number;
  rewards: Record<string, number>; // reward type → how many
  /** For upcoming events: sales to the next reward of each type, and the way there (percent). */
  next: Record<string, { in: number; progress: number } | null>;
  versionIds: number[];
  errors: string[];
};

/**
 * A promoter's earnings, event by event, worked out by their rules. A bare number is a percentage of
 * full-price sales, rounded per code and event like before rules (tests and simple callers).
 */
export type Rate = {
  events: Map<number, EventEarning>;
  /** The rules engine was down: the numbers are the last ones known. */
  stale: boolean;
  /** Every rule version used, for keeping with a payout. */
  versionIds: number[];
  /** Team leads: what their team rule gave on their team's sales (commission and bonus), cents per currency. */
  team?: Map<string, number>;
  /** The same, event by event (cents, commission and bonus), with when the event starts. */
  teamByEvent?: Map<number, { currency: string; cents: number; start: Date | null }>;
};

const percentOn = (fullPrice: string | number, percent: number) => Math.round(Number(fullPrice) * percent);

/** Commission on one event's sales: the rules' amount, or the percentage of each row for a bare number. */
export function eventCommission(rate: Rate | number, eventId: number, rows: { full_price: string }[]): number {
  if (typeof rate === 'number') return rows.reduce((sum, r) => sum + percentOn(r.full_price, rate), 0);
  return rate.events.get(eventId)?.commission ?? 0;
}

export const eventBonus = (rate: Rate | number, eventId: number) => (typeof rate === 'number' ? 0 : (rate.events.get(eventId)?.bonus ?? 0));

/** Splits `total` cents by weight, so the parts always add up to it exactly (largest remainder). */
export function splitCents(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? weights.map((w) => (total * w) / sum) : weights.map(() => total / weights.length);
  const parts = shares.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = shares.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k]![1]]! += 1;
  return parts;
}

/**
 * An event's commission spread over parts of its sales (codes on the event page, days on charts): by
 * full-price sales, else by tickets. The parts of an event add up to its commission to the cent.
 */
export function splitCommission(rate: Rate | number, pieces: { event_id?: number; full_price: string; tickets: number }[]): number[] {
  if (typeof rate === 'number') return pieces.map((p) => percentOn(p.full_price, rate));
  const out = pieces.map(() => 0);
  const byEvent = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    if (p.event_id === undefined) return;
    byEvent.set(p.event_id, [...(byEvent.get(p.event_id) ?? []), i]);
  });
  for (const [eventId, indexes] of byEvent) {
    const total = rate.events.get(eventId)?.commission ?? 0;
    const bySales = indexes.map((i) => toCents(pieces[i]!.full_price));
    const weights = bySales.some((w) => w > 0) ? bySales : indexes.map((i) => pieces[i]!.tickets);
    splitCents(total, weights).forEach((cents, k) => (out[indexes[k]!] = cents));
  }
  return out;
}

/** Commission on sales outside Hi.Events, by the usual rate: the sales total × the percentage, or tickets × the flat amount. */
export function usualCommissionOn(rule: EventRule, salesCents: number, tickets: number): number {
  return rule.kind === 'flat' ? Math.round(rule.value) * tickets : Math.round((salesCents * rule.value) / 100);
}

export function describeRule(rule: EventRule, currency = 'CAD'): string {
  return rule.kind === 'flat' ? `${formatMoney(rule.value, currency)} per ticket` : formatPercent(rule.value);
}

/** "10%" or "$2.00 per ticket", plus ", other rates on some events" when the promoter has event rates. */
export function describeRate(rate: LegacyRate, eventIds?: number[]): string {
  const others = eventIds ? eventIds.some((id) => rate.events.has(id)) : rate.events.size > 0;
  return `${describeRule(rate.usual)}${others ? ', other rates on some events' : ''}`;
}

export type Totals = {
  currency: string;
  fullPrice: number;
  paid: number;
  commission: number;
  bonus: number;
  tickets: number;
  pending: number;
  orders: number;
};

// Events can be in different currencies, so money is always totalled per currency.
export function totalsByCurrency(rows: CodeStats[], rate: Rate | number): Totals[] {
  const totals = new Map<string, Totals>();
  const byEvent = new Map<string, CodeStats[]>();
  for (const r of rows) byEvent.set(`${r.event_id}:${r.currency}`, [...(byEvent.get(`${r.event_id}:${r.currency}`) ?? []), r]);
  for (const eventRows of byEvent.values()) {
    const { event_id: eventId, currency } = eventRows[0]!;
    const t = totals.get(currency) ?? { currency, fullPrice: 0, paid: 0, commission: 0, bonus: 0, tickets: 0, pending: 0, orders: 0 };
    for (const r of eventRows) {
      t.fullPrice += toCents(r.full_price);
      t.paid += toCents(r.paid);
      t.tickets += r.tickets_sold;
      t.pending += r.tickets_pending;
      t.orders += r.orders;
    }
    t.commission += eventCommission(rate, eventId, eventRows);
    t.bonus += eventBonus(rate, eventId);
    totals.set(currency, t);
  }
  return [...totals.values()];
}
