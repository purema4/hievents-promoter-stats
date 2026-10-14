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
export function totalsByCurrency(rows: CodeStats[], percent: number): Totals[] {
  const totals = new Map<string, Totals>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { currency: r.currency, fullPrice: 0, paid: 0, commission: 0, tickets: 0, pending: 0, orders: 0 };
    t.fullPrice += toCents(r.full_price);
    t.paid += toCents(r.paid);
    t.commission += commissionCents(r.full_price, percent);
    t.tickets += r.tickets_sold;
    t.pending += r.tickets_pending;
    t.orders += r.orders;
    totals.set(r.currency, t);
  }
  return [...totals.values()];
}
