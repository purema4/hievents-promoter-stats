import { describe, expect, test } from 'bun:test';
import type { CodeStats } from '../../src/hievents';
import { commissionCents, parseAmountCents, describeRate, formatMoney, formatPercent, splitCents, splitCommission, toCents, totalsByCurrency, usualCommissionOn, type EventEarning, type LegacyRate, type Rate } from '../../src/money';

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
    draft: false,
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
    expect(totals).toEqual([{ currency: 'CAD', fullPrice: 11000, paid: 9900, commission: 1100, bonus: 0, tickets: 5, pending: 1, orders: 4 }]);
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

const earning = (commission: number, bonus = 0): EventEarning => ({ commission, bonus, merch: 0, rewards: {}, next: {}, versionIds: [1], errors: [] });
const rules = (events: [number, EventEarning][]): Rate => ({ events: new Map(events), stale: false, versionIds: [1] });

describe('with rules: each event gets what its rule gives', () => {
  test('totals add up the events, bonus kept apart', () => {
    const rate = rules([[1, earning(6000, 500)], [2, earning(0)]]);
    const totals = totalsByCurrency(
      [row({ event_id: 1, code: 'a', full_price: '100.00', tickets_sold: 10 }), row({ event_id: 1, code: 'b', full_price: '20.00', tickets_sold: 2 }), row({ event_id: 2, full_price: '10.00', tickets_sold: 1 })],
      rate,
    );
    expect(totals).toEqual([{ currency: 'CAD', fullPrice: 13000, paid: 0, commission: 6000, bonus: 500, tickets: 13, pending: 0, orders: 0 }]);
  });

  test("an event's commission is split over its codes or days to the cent", () => {
    const rate = rules([[1, earning(1000)], [2, earning(100)]]);
    const parts = splitCommission(rate, [
      { event_id: 1, full_price: '10.00', tickets: 1 },
      { event_id: 1, full_price: '10.00', tickets: 1 },
      { event_id: 1, full_price: '10.00', tickets: 1 },
      { event_id: 2, full_price: '0.00', tickets: 3 },
      { event_id: 2, full_price: '0.00', tickets: 0 },
    ]);
    expect(parts.slice(0, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts.slice(0, 3)).toEqual([334, 333, 333]);
    // No sales at full price (free tickets): split by tickets.
    expect(parts.slice(3)).toEqual([100, 0]);
    // A bare percentage keeps rounding each part on its own, like before rules.
    expect(splitCommission(10, [{ full_price: '0.15', tickets: 1 }])).toEqual([2]);
  });

  test('splitCents', () => {
    expect(splitCents(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitCents(0, [5, 5])).toEqual([0, 0]);
    expect(splitCents(7, [0, 0])).toEqual([4, 3]);
    expect(splitCents(5, [])).toEqual([]);
  });
});

describe('usual rate: a percentage or a flat amount per ticket', () => {
  const flat: LegacyRate = { usual: { kind: 'flat', value: 200 }, events: new Map() };

  test('sales outside Hi.Events: tickets × the flat amount, or the sales total × the percentage', () => {
    expect(usualCommissionOn({ kind: 'flat', value: 250 }, 30_000, 12)).toBe(3000);
    expect(usualCommissionOn({ kind: 'percent', value: 10 }, 30_000, 12)).toBe(3000);
    // Taken back.
    expect(usualCommissionOn({ kind: 'flat', value: 250 }, -10_000, -2)).toBe(-500);
  });

  test('described for admins', () => {
    expect(describeRate(flat)).toBe('$2.00 per ticket');
    expect(describeRate({ usual: { kind: 'percent', value: 10 }, events: new Map() })).toBe('10%');
    expect(describeRate({ ...flat, events: new Map([[1, { kind: 'percent', value: 5 }]]) })).toBe('$2.00 per ticket, other rates on some events');
  });
});

describe('parseAmountCents', () => {
  test('reads amounts the way people write them in Quebec and elsewhere', () => {
    for (const [typed, cents] of [
      ['25', 2500], ['25.50', 2550], ['25,50', 2550], ['25.5', 2550],
      ['310$', 31000], ['310 $', 31000], ['310 $', 31000], ['$310', 31000], ['$ 310.00', 31000],
      ['1 234,50 $', 123450], ['1 234,50 $', 123450], ['1,234.50', 123450], ['CAD 40', 4000], ['40 cad', 4000],
      [' 12 ', 1200],
    ] as const) expect([typed, parseAmountCents(typed)]).toEqual([typed, cents]);
  });

  test('refuses what is not an amount', () => {
    for (const typed of ['', '$', 'abc', '25.505', '-10', '1,234', '25$50', '3 cents', '1e3']) expect([typed, parseAmountCents(typed)]).toEqual([typed, NaN]);
  });
});
