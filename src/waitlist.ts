/*
 * Waitlists. When a ticket sells out (or before its sale opens), Hi.Events lets people join its waitlist,
 * keeping the promo code of the link they came from; the order it makes when it offers a spot carries
 * that code, so the sale counts for the promoter like any other. A promoter's event link is therefore
 * also their waitlist link: this tells them when the waitlist is open, and how many joined with their code.
 *
 * Whether it is open comes from Hi.Events' public event data (the same its event page uses), so it follows
 * Hi.Events' own rules (tiers, sale dates, per-ticket waitlist switch). No key is needed.
 */
import { config } from './config';
import { t } from './i18n';
import type { WaitlistCounts } from './hievents';

export type WaitlistState = {
  /** Someone can join a ticket's waitlist now. */
  open: boolean;
  /** Every ticket on sale is sold out. */
  soldOut: boolean;
  /** No ticket can be bought right now: the waitlist is the only way in (sold out, or sales not open yet). */
  waitlistOnly: boolean;
  /** An open waitlist is for a ticket whose sale has not started. */
  beforeSale: boolean;
};

export type Waitlist = WaitlistState & Omit<WaitlistCounts, 'event_id'>;

type PublicProduct = {
  product_type?: string;
  is_sold_out?: boolean;
  is_available?: boolean;
  is_before_sale_start_date?: boolean;
  is_after_sale_end_date?: boolean;
  waitlist_enabled?: boolean | null;
};

/** The state from Hi.Events' public event: its ticket products, as its event page shows them. */
export function waitlistState(products: PublicProduct[]): WaitlistState {
  const tickets = products.filter((p) => (p.product_type ?? 'TICKET') === 'TICKET' && !p.is_after_sale_end_date);
  // As Hi.Events' event page: a ticket's waitlist is joinable when it is on and the ticket is sold out or not on sale yet.
  const joinable = tickets.filter((p) => !!p.waitlist_enabled && (p.is_sold_out || p.is_before_sale_start_date));
  return {
    open: joinable.length > 0,
    soldOut: tickets.length > 0 && tickets.every((p) => p.is_sold_out),
    waitlistOnly: joinable.length > 0 && tickets.every((p) => !p.is_available),
    beforeSale: joinable.length > 0 && joinable.every((p) => p.is_before_sale_start_date && !p.is_sold_out),
  };
}

const closed: WaitlistState = { open: false, soldOut: false, waitlistOnly: false, beforeSale: false };
const cache = new Map<number, { at: number; state: WaitlistState | null }>();
const TTL = 2 * 60 * 1000;

/** An event's waitlist state, or null when Hi.Events can't tell (not set up, a draft, or not answering). */
export async function eventWaitlist(eventId: number): Promise<WaitlistState | null> {
  if (!config.hieventsApi.url) return null;
  const hit = cache.get(eventId);
  if (hit && Date.now() - hit.at < TTL) return hit.state;
  let state: WaitlistState | null = null;
  try {
    const res = await fetch(`${config.hieventsApi.url}/public/events/${eventId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
      redirect: 'error',
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { product_categories?: { products?: PublicProduct[] }[] } };
      state = waitlistState((body.data?.product_categories ?? []).flatMap((c) => c.products ?? []));
    }
  } catch {
    // Not answering: no waitlist shown, tried again later.
  }
  if (cache.size > 500) cache.clear();
  cache.set(eventId, { at: Date.now(), state });
  return state;
}

/** The waitlist of each event, with the people who joined with these codes; only the events where there is something to say. */
export async function waitlistsFor(eventIds: number[], counts: WaitlistCounts[]): Promise<Map<number, Waitlist>> {
  const out = new Map<number, Waitlist>();
  const states = await Promise.all(eventIds.map(async (id) => [id, await eventWaitlist(id)] as const));
  for (const [id, state] of states) {
    const c = counts.find((x) => x.event_id === id);
    if (!state?.open && !state?.soldOut && !c) continue;
    out.set(id, { ...(state ?? closed), waiting: c?.waiting ?? 0, offered: c?.offered ?? 0, bought: c?.bought ?? 0 });
  }
  return out;
}

/** The chip on an event: "Sold out · waitlist open", "Waitlist open before sales"… or '' when there is nothing to say. */
export function waitlistLabel(w: WaitlistState): string {
  if (w.open && w.soldOut) return t('Sold out · waitlist open', 'Complet · liste d’attente ouverte');
  if (w.open && w.beforeSale) return t('Waitlist open before sales', 'Liste d’attente ouverte avant la vente');
  if (w.open) return t('Waitlist open on some tickets', 'Liste d’attente ouverte sur certains billets');
  if (w.soldOut) return t('Sold out', 'Complet');
  return '';
}
