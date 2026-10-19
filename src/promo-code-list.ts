import type { PromoCodeListing } from './hievents';

/*
 * Promoters → Promo codes: every promo code in Hi.Events, searched, filtered and paged on the server
 * (plain links and a GET form, so it works without scripts under the strict CSP).
 */
export const codesPerPage = 25;

export type CodeFilter = {
  q: string; // code, event or promoter name
  show: 'all' | 'assigned' | 'unassigned';
  when: 'upcoming' | 'past' | 'all';
  page: number;
};

export function parseCodeFilter(query: Record<string, string | undefined>): CodeFilter {
  const pick = <T extends string>(value: string | undefined, options: readonly T[], fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;
  return {
    q: String(query.q ?? '').trim().slice(0, 100),
    show: pick(query.show, ['all', 'assigned', 'unassigned'] as const, 'all'),
    when: pick(query.when, ['upcoming', 'past', 'all'] as const, 'upcoming'),
    page: Math.max(1, Math.floor(Number(query.page)) || 1),
  };
}

export type CodeRow = PromoCodeListing & { owners: string[] };
export type CodePage = { rows: CodeRow[]; total: number; page: number; pages: number };

/** The codes matching the filter, one page of them. Upcoming events soonest first, others newest first. */
export function filterCodes(codes: PromoCodeListing[], owners: Map<string, string[]>, f: CodeFilter, now = Date.now()): CodePage {
  const q = f.q.toLowerCase();
  // An event without dates counts as upcoming, like everywhere else.
  const over = (c: PromoCodeListing) => !!c.event_end && c.event_end.getTime() < now;
  let rows: CodeRow[] = codes
    .map((c) => ({ ...c, owners: owners.get(c.code.toLowerCase()) ?? [] }))
    .filter((c) => (f.when === 'all' ? true : f.when === 'past' ? over(c) : !over(c)))
    .filter((c) => (f.show === 'all' ? true : f.show === 'assigned' ? c.owners.length > 0 : c.owners.length === 0))
    .filter((c) => !q || [c.code, c.event_title, ...c.owners].some((text) => text.toLowerCase().includes(q)));
  if (f.when === 'upcoming') rows = rows.reverse();
  const pages = Math.max(1, Math.ceil(rows.length / codesPerPage));
  const page = Math.min(f.page, pages);
  return { rows: rows.slice((page - 1) * codesPerPage, page * codesPerPage), total: rows.length, page, pages };
}

/** The page's address with some of the filter changed; defaults are left out. */
export function codesHref(f: CodeFilter, change: Partial<CodeFilter> = {}): string {
  const next = { ...f, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.show !== 'all') params.set('show', next.show);
  if (next.when !== 'upcoming') params.set('when', next.when);
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return `/admin/codes${query ? `?${query}` : ''}`;
}
