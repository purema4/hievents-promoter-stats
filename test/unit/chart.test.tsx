import { describe, expect, test } from 'bun:test';
import { parseRange, rangeBounds, SalesChart } from '../../src/chart';
import type { DailySales } from '../../src/hievents';

const sale = (day: string, tickets: number, fullPrice: string): DailySales => ({ day, currency: 'CAD', tickets, full_price: fullPrice });

function daysBefore(end: string, n: number): string {
  return new Date(new Date(`${end}T00:00:00Z`).getTime() - n * 86400_000).toISOString().slice(0, 10);
}

describe('rangeBounds', () => {
  const end = '2026-10-14';
  test('fixed ranges end today and include it', () => {
    expect(rangeBounds('7', [], end)).toEqual({ from: '2026-10-08', to: end });
    expect(rangeBounds('30', [], end)).toEqual({ from: '2026-09-15', to: end });
    expect(rangeBounds('90', [], end)).toEqual({ from: '2026-07-17', to: end });
  });

  test('ranges cross month and year boundaries', () => {
    expect(rangeBounds('7', [], '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
    expect(rangeBounds('30', [], '2026-01-10')).toEqual({ from: '2025-12-12', to: '2026-01-10' });
  });

  test('"all" starts at the first sale', () => {
    expect(rangeBounds('all', [sale('2026-01-05', 1, '25.00'), sale('2026-03-01', 2, '50.00')], end)).toEqual({ from: '2026-01-05', to: end });
    expect(rangeBounds('all', [], end)).toEqual({ from: end, to: end });
  });

  test('"all" reaches a sale dated after today', () => {
    expect(rangeBounds('all', [sale('2026-10-01', 1, '25.00'), sale('2026-10-20', 1, '25.00')], end)).toEqual({ from: '2026-10-01', to: '2026-10-20' });
  });

  test('parseRange only accepts the known ranges', () => {
    expect(parseRange('7', '30')).toBe('7');
    expect(parseRange('all', '30')).toBe('all');
    expect(parseRange('365', '30')).toBe('30');
    expect(parseRange(undefined, 'all')).toBe('all');
  });
});

const render = (props: Partial<Parameters<typeof SalesChart>[0]> & { daily: DailySales[] }) =>
  String(<SalesChart title="Tickets" percent={10} range="all" basePath="/" currency="CAD" end="2026-10-14" {...props} />);
const columns = (html: string) => (html.match(/class="col"/g) ?? []).length;

describe('SalesChart', () => {
  test('one bar per day up to 120 days', () => {
    const html = render({ daily: [sale(daysBefore('2026-10-14', 119), 2, '50.00'), sale('2026-10-14', 1, '25.00')] });
    expect(columns(html)).toBe(120);
    expect(html).not.toContain('per week');
    expect(html).toContain('<th>Day</th>');
  });

  test('weekly bars for longer periods', () => {
    const html = render({ daily: [sale(daysBefore('2026-10-14', 120), 2, '50.00'), sale('2026-10-14', 1, '25.00')] });
    expect(columns(html)).toBe(Math.ceil(121 / 7));
    expect(html).toContain('3 tickets, per week'); // the total still counts every ticket
    expect(html).toContain('<th>Week</th>');
  });

  test('a week adds up the days in it, and commission is per bucket', () => {
    const daily = [sale('2026-01-01', 2, '50.00'), sale('2026-01-03', 3, '75.00'), sale('2026-10-14', 1, '25.00')];
    const html = render({ daily });
    // 2026-01-01 to 2026-01-07 is the first bucket: 5 tickets, $125 at 10%.
    expect(html).toMatch(/<td>Jan 1 – Jan 7<\/td><td class="num">5<\/td><td class="num">\$12\.50<\/td>/);
  });

  test('daily bars show each day and its commission', () => {
    const html = render({ range: '7', daily: [sale('2026-10-10', 3, '75.00')] });
    expect(columns(html)).toBe(7);
    expect(html).toMatch(/<td>Oct 10<\/td><td class="num">3<\/td><td class="num">\$7\.50<\/td>/);
  });

  test('sales outside the period are not counted', () => {
    const html = render({ range: '7', daily: [sale('2026-09-01', 4, '100.00'), sale('2026-10-13', 1, '25.00')] });
    expect(html).toContain('1 ticket');
    expect(html).not.toContain('5 tickets');
  });

  test('an empty period says so', () => {
    expect(render({ range: '30', daily: [] })).toContain('No tickets sold in this period.');
  });
});
