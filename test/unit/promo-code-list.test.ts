import { describe, expect, test } from 'bun:test';
import type { PromoCodeListing } from '../../src/hievents';
import { codesHref, codesPerPage, filterCodes, parseCodeFilter } from '../../src/promo-code-list';

const now = Date.parse('2026-10-19T12:00:00Z');
const day = 86_400_000;

function code(code: string, title: string, inDays: number | null): PromoCodeListing {
  const at = inDays === null ? null : new Date(now + inDays * day);
  return { code, event_title: title, event_start: at, event_end: at, event_timezone: 'America/Toronto', order_usage_count: 0 };
}

// Like the query: newest events first.
const codes = [
  code('NOVA', 'Secret Afterparty', 20),
  code('DJMAX', 'Warehouse Night', 17),
  code('LUNA', 'Warehouse Night', 17),
  code('DJMAX', 'Summer Rooftop', -70),
];
const owners = new Map([['djmax', ['Maya']]]);
const all = parseCodeFilter({});

describe('promo code list', () => {
  test('defaults: upcoming events, assigned or not, soonest first', () => {
    expect(all).toEqual({ q: '', show: 'all', when: 'upcoming', page: 1 });
    const r = filterCodes(codes, owners, all, now);
    expect(r.rows.map((c) => `${c.code} ${c.event_title}`)).toEqual(['LUNA Warehouse Night', 'DJMAX Warehouse Night', 'NOVA Secret Afterparty']);
    expect(r.rows.find((c) => c.code === 'DJMAX')!.owners).toEqual(['Maya']);
    expect(r).toMatchObject({ total: 3, page: 1, pages: 1 });
  });

  test('past or all events, newest first', () => {
    expect(filterCodes(codes, owners, { ...all, when: 'past' }, now).rows.map((c) => c.event_title)).toEqual(['Summer Rooftop']);
    expect(filterCodes(codes, owners, { ...all, when: 'all' }, now).total).toBe(4);
  });

  test('an event without dates counts as upcoming', () => {
    expect(filterCodes([code('TBA', 'Someday', null)], owners, all, now).total).toBe(1);
    expect(filterCodes([code('TBA', 'Someday', null)], owners, { ...all, when: 'past' }, now).total).toBe(0);
  });

  test('assigned or not', () => {
    expect(filterCodes(codes, owners, { ...all, show: 'unassigned' }, now).rows.map((c) => c.code)).toEqual(['LUNA', 'NOVA']);
    expect(filterCodes(codes, owners, { ...all, show: 'assigned', when: 'all' }, now).total).toBe(2);
  });

  test('search on the code, the event and the promoter, any case', () => {
    expect(filterCodes(codes, owners, { ...all, q: 'luna' }, now).total).toBe(1);
    expect(filterCodes(codes, owners, { ...all, q: 'WAREHOUSE' }, now).total).toBe(2);
    expect(filterCodes(codes, owners, { ...all, q: 'maya', when: 'all' }, now).total).toBe(2);
    expect(filterCodes(codes, owners, { ...all, q: 'nobody here' }, now)).toMatchObject({ total: 0, pages: 1, rows: [] });
  });

  test('pages', () => {
    const many = Array.from({ length: codesPerPage * 2 + 3 }, (_, i) => code(`C${i}`, 'Big night', 10));
    const page = (n: number) => filterCodes(many, owners, { ...all, page: n }, now);
    expect(page(1)).toMatchObject({ total: codesPerPage * 2 + 3, page: 1, pages: 3 });
    expect(page(1).rows).toHaveLength(codesPerPage);
    expect(page(3).rows).toHaveLength(3);
    // Past the last page: the last page.
    expect(page(99)).toMatchObject({ page: 3 });
  });

  test('unknown or odd query values fall back to the defaults', () => {
    expect(parseCodeFilter({ show: 'everything', when: 'yesterday', page: '-4', q: `  ${'x'.repeat(300)}  ` })).toEqual({
      q: 'x'.repeat(100),
      show: 'all',
      when: 'upcoming',
      page: 1,
    });
    expect(parseCodeFilter({ page: '2.7' }).page).toBe(2);
    expect(parseCodeFilter({ page: 'abc' }).page).toBe(1);
  });

  test('links keep the filter and leave out the defaults', () => {
    expect(codesHref(all)).toBe('/admin/codes');
    expect(codesHref({ q: 'dj max', show: 'unassigned', when: 'past', page: 1 }, { page: 2 })).toBe('/admin/codes?q=dj+max&show=unassigned&when=past&page=2');
  });
});
