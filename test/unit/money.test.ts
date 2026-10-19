import { describe, expect, test } from 'bun:test';
import type { CodeStats } from '../../src/hievents';
import { commissionCents, commissionOn, describeRate, formatMoney, formatPercent, toCents, totalsByCurrency, usualCommissionOn, type Rate } from '../../src/money';

function row(overrides: Partial<CodeStats>): CodeStats {
  return {
    promo_code_id: 1,
    code: 'djmax',
    event_id: 1,
    event_title: 'Warehouse Night',
    event_start: null,
    event_end: null,
    event_dates: 1,
    event_timezone: 'America/Toronto',
    has_cover: false,
    currency: 'CAD',
    tickets_sold: 0,
    tickets_pending: 0,
    orders: 0,
    full_price: '0.00',
    paid: '0.00',
    ...overrides,
  };
}

describe('commissionCents', () => {
  test('is the full price times the rate, in cents', () => {
    expect(commissionCents('285.00', 10)).toBe(2850);
    expect(commissionCents('10.00', 10)).toBe(100);
    expect(commissionCents('100.00', 12.5)).toBe(1250);
    expect(commissionCents('0.00', 10)).toBe(0);
  });

  test('rounds to the nearest cent', () => {
    expect(commissionCents('0.15', 10)).toBe(2); // 1.5 cents
    expect(commissionCents('0.14', 10)).toBe(1); // 1.4 cents
    expect(commissionCents('33.33', 15)).toBe(500); // 499.95 cents
  });

  test('a 0% rate earns nothing and 100% earns everything', () => {
    expect(commissionCents('49.99', 0)).toBe(0);
    expect(commissionCents('49.99', 100)).toBe(4999);
  });
});

describe('totalsByCurrency', () => {
  test('adds up every row of a currency', () => {
    const totals = totalsByCurrency(
      [
        row({ event_id: 1, full_price: '100.00', paid: '90.00', tickets_sold: 4, tickets_pending: 1, orders: 3 }),
        row({ event_id: 2, full_price: '10.00', paid: '9.00', tickets_sold: 1, orders: 1 }),
      ],
      10,
    );
    expect(totals).toEqual([{ currency: 'CAD', fullPrice: 11000, paid: 9900, commission: 1100, tickets: 5, pending: 1, orders: 4 }]);
  });

  test('keeps currencies apart', () => {
    const totals = totalsByCurrency([row({ currency: 'CAD', full_price: '50.00' }), row({ currency: 'USD', full_price: '20.00' })], 10);
    expect(totals.map((t) => [t.currency, t.fullPrice, t.commission])).toEqual([
      ['CAD', 5000, 500],
      ['USD', 2000, 200],
    ]);
  });

  test('rounds commission per row, so the total equals the sum of the rows shown', () => {
    // 1.5 cents per row: rounded per row it is 2 + 2, not round(3.0) = 3.
    const rows = [row({ event_id: 1, full_price: '0.15' }), row({ event_id: 2, full_price: '0.15' })];
    const [total] = totalsByCurrency(rows, 10);
    expect(total!.commission).toBe(4);
    expect(total!.commission).toBe(rows.reduce((sum, r) => sum + commissionCents(r.full_price, 10), 0));
  });

  test('no rows, no totals', () => {
    expect(totalsByCurrency([], 10)).toEqual([]);
  });
});

describe('formatting', () => {
  test('formatMoney uses the currency', () => {
    expect(formatMoney(2850, 'CAD')).toBe('$28.50');
    expect(formatMoney(0, 'CAD')).toBe('$0.00');
    expect(formatMoney(123456, 'CAD')).toBe('$1,234.56');
    expect(formatMoney(-500, 'CAD')).toBe('-$5.00');
    expect(formatMoney(1000, 'EUR')).toBe('€10.00');
  });

  test('formatMoney falls back to plain text for an unknown currency code', () => {
    expect(formatMoney(1050, 'NOPE')).toBe('10.50 NOPE');
  });

  test('formatPercent drops useless decimals', () => {
    expect(formatPercent(10)).toBe('10%');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatPercent(33.333333)).toBe('33.33%');
  });

  test('toCents', () => {
    expect(toCents('28.50')).toBe(2850);
    expect(toCents(9)).toBe(900);
    expect(toCents('0.07')).toBe(7);
  });
});

describe('usual rate: a percentage or a flat amount per ticket', () => {
  const flat: Rate = { usual: { kind: 'flat', value: 200 }, events: new Map() };

  test('a flat usual rate pays per ticket, never a percentage on top', () => {
    expect(commissionOn(flat, 1, '100.00', 4)).toBe(800);
    expect(commissionOn(flat, undefined, '100.00', 4)).toBe(800);
    expect(totalsByCurrency([row({ event_id: 1, tickets_sold: 4, full_price: '100.00' })], flat)[0]!.commission).toBe(800);
  });

  test('an event rate replaces the usual one, either way round', () => {
    const mixed: Rate = { usual: { kind: 'flat', value: 200 }, events: new Map([[1, { kind: 'percent', value: 10 }]]) };
    expect(commissionOn(mixed, 1, '100.00', 4)).toBe(1000);
    expect(commissionOn(mixed, 2, '100.00', 4)).toBe(800);
    const percent: Rate = { usual: { kind: 'percent', value: 10 }, events: new Map([[1, { kind: 'flat', value: 300 }]]) };
    expect(commissionOn(percent, 1, '100.00', 4)).toBe(1200);
    expect(commissionOn(percent, 2, '100.00', 4)).toBe(1000);
  });

  test('sales outside Hi.Events: tickets × the flat amount, or the sales total × the percentage', () => {
    expect(usualCommissionOn({ kind: 'flat', value: 250 }, 30_000, 12)).toBe(3000);
    expect(usualCommissionOn({ kind: 'percent', value: 10 }, 30_000, 12)).toBe(3000);
    // Taken back.
    expect(usualCommissionOn({ kind: 'flat', value: 250 }, -10_000, -2)).toBe(-500);
  });

  test('described for admins', () => {
    expect(describeRate(flat)).toBe('$2.00 per ticket');
    expect(describeRate(10)).toBe('10%');
    expect(describeRate({ ...flat, events: new Map([[1, { kind: 'percent', value: 5 }]]) })).toBe('$2.00 per ticket, other rates on some events');
  });
});
