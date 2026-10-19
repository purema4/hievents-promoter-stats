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

// Rounded once per (code, event) row; every total is a sum of these, so the numbers always agree.
export function commissionCents(fullPrice: string, percent: number): number {
  return Math.round(Number(fullPrice) * percent);
}

/*
 * A promoter's commission: their usual percentage, except on events where an admin set another one,
 * either another percentage or a flat amount per ticket sold.
 */
export type EventRule = { kind: 'percent' | 'flat'; value: number }; // a percentage, or cents per ticket
export type Rate = { percent: number; events: Map<number, EventRule> };

export const asRate = (rate: Rate | number): Rate => (typeof rate === 'number' ? { percent: rate, events: new Map() } : rate);

/** Commission on sales for one event (or none known): full price × the rate, or tickets × the flat amount. */
export function commissionOn(rate: Rate | number, eventId: number | undefined, fullPrice: string, tickets: number): number {
  const r = asRate(rate);
  const rule = eventId === undefined ? undefined : r.events.get(eventId);
  if (rule?.kind === 'flat') return Math.round(rule.value) * tickets;
  return commissionCents(fullPrice, rule?.kind === 'percent' ? rule.value : r.percent);
}

export function describeRule(rule: EventRule, currency: string): string {
  return rule.kind === 'flat' ? `${formatMoney(rule.value, currency)} per ticket` : formatPercent(rule.value);
}

/** "10%", or "10%, other rates on some events" for a promoter with event rates. */
export function describeRate(rate: Rate | number, eventIds?: number[]): string {
  const r = asRate(rate);
  const others = eventIds ? eventIds.some((id) => r.events.has(id)) : r.events.size > 0;
  return others ? `${formatPercent(r.percent)}, other rates on some events` : formatPercent(r.percent);
}

export type Totals = {
  currency: string;
  fullPrice: number;
  paid: number;
  commission: number;
  tickets: number;
  pending: number;
  orders: number;
};

// Events can be in different currencies, so money is always totalled per currency.
export function totalsByCurrency(rows: CodeStats[], rate: Rate | number): Totals[] {
  const totals = new Map<string, Totals>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { currency: r.currency, fullPrice: 0, paid: 0, commission: 0, tickets: 0, pending: 0, orders: 0 };
    t.fullPrice += toCents(r.full_price);
    t.paid += toCents(r.paid);
    t.commission += commissionOn(rate, r.event_id, r.full_price, r.tickets_sold);
    t.tickets += r.tickets_sold;
    t.pending += r.tickets_pending;
    t.orders += r.orders;
    totals.set(r.currency, t);
  }
  return [...totals.values()];
}
