/*
 * Ticket rewards sent from Hi.Events. Giving a ticket request adds one attendee per ticket to the event,
 * on the reward type's ticket (GL GA, GL VIP…), and Hi.Events emails each ticket. Tickets go to the
 * promoter's email; a guest list's tickets carry the guests' names. Each attendee made is kept, so
 * trying again after an error sends only the tickets still missing.
 *
 * Off unless HIEVENTS_API_KEY is set (with HIEVENTS_API_URL or HIEVENTS_PUBLIC_URL).
 */
import { config } from './config';
import { db, findUser } from './local-db';
import type { RewardRequest } from './rewards';
import { rewardTypeOf, ticketProductFor } from './rules';

db.exec(`
  CREATE TABLE IF NOT EXISTS reward_tickets (
    id          INTEGER PRIMARY KEY,
    request_id  INTEGER NOT NULL REFERENCES reward_requests(id) ON DELETE CASCADE,
    attendee_id INTEGER NOT NULL,
    short_id    TEXT,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS reward_tickets_request ON reward_tickets (request_id);
`);

export const ticketsApiOn = () => !!(config.hieventsApi.url && config.hieventsApi.key);

/** A request whose tickets Hi.Events can send: tickets for an event, not a deposit into the bank. */
export const sendsTickets = (r: RewardRequest) => ticketsApiOn() && r.kind === 'ticket' && r.event_id !== null;

export class HieventsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.hieventsApi.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.hieventsApi.key}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      // The key must not follow a redirect to another host.
      redirect: 'error',
    });
  } catch (err) {
    throw new HieventsApiError(`Hi.Events did not answer (${(err as Error).message})`, 0);
  }
  const text = (await res.text()).slice(0, 1_000_000);
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON (a proxy error page): the status says enough.
  }
  if (!res.ok) {
    const errors = json.errors && typeof json.errors === 'object' ? Object.values(json.errors as Record<string, string[]>).flat().join(' ') : '';
    throw new HieventsApiError(`Hi.Events answered ${res.status}: ${errors || String(json.message ?? res.statusText)}`.slice(0, 300), res.status);
  }
  return json as T;
}

type Product = { id: number; title: string; type?: string; prices?: { id: number }[] | null };

// An event's tickets change rarely; the requests page looks them up for each waiting request.
const productCache = new Map<number, { at: number; products: Product[] }>();

async function eventProducts(eventId: number, fresh = false): Promise<Product[]> {
  const hit = productCache.get(eventId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.products;
  const res = await api<{ data: Product[] }>('GET', `/events/${eventId}/products?per_page=100`);
  productCache.set(eventId, { at: Date.now(), products: res.data ?? [] });
  return res.data ?? [];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function findTicketProduct(eventId: number, title: string, fresh = false): Promise<Product | null> {
  return (await eventProducts(eventId, fresh)).find((p) => same(p.title, title)) ?? null;
}

// An event with one date: its occurrence. With several, Hi.Events is left to choose.
async function onlyOccurrence(eventId: number): Promise<number | undefined> {
  try {
    const res = await api<{ data: { id: number }[] }>('GET', `/events/${eventId}/occurrences?per_page=2`);
    return res.data?.length === 1 ? res.data[0]!.id : undefined;
  } catch {
    return undefined;
  }
}

export function sentTickets(requestId: number): { attendee_id: number; short_id: string | null; name: string; email: string }[] {
  return db.query<{ attendee_id: number; short_id: string | null; name: string; email: string }, [number]>(
    'SELECT attendee_id, short_id, name, email FROM reward_tickets WHERE request_id = ? ORDER BY id',
  ).all(requestId);
}

/** The names on the tickets: the guests of a guest list ("Guest list: Ann, Bob"), else the promoter. */
export function ticketNames(r: RewardRequest): string[] {
  const guestList = r.reward_type ? !!rewardTypeOf(r.reward_type)?.guest_list : false;
  const guests = guestList ? (r.details ?? '').replace(/^Guest list:\s*/i, '').split(/[,;\n]+/).map((g) => g.trim()).filter(Boolean) : [];
  return Array.from({ length: r.quantity }, (_, i) => guests[i] ?? r.promoter_name);
}

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts.shift() || 'Guest';
  return { first_name: first.slice(0, 40), last_name: parts.join(' ').slice(0, 40) };
}

// The last error sending a request's tickets, shown on its card until they are sent. Kept here rather
// than in the redirect, so a link can't put words on the admin page.
const lastErrors = new Map<number, string>();
export const lastTicketError = (requestId: number) => lastErrors.get(requestId);

export type TicketPlan =
  | { ok: true; product: string; email: string; toSend: number; sent: number; lastError?: string }
  | { ok: false; reason: 'missing_product'; product: string; eventId: number; eventTitle: string }
  | { ok: false; reason: 'api'; message: string };

/** What giving this request would send, for the requests page. */
export async function planTickets(r: RewardRequest, fresh = false): Promise<TicketPlan> {
  const product = ticketProductFor(r.reward_type);
  const sent = sentTickets(r.id).length;
  const email = (r.user_id ? findUser(r.user_id)?.email : null) ?? r.promoter_email;
  try {
    if (!(await findTicketProduct(r.event_id!, product, fresh))) {
      return { ok: false, reason: 'missing_product', product, eventId: r.event_id!, eventTitle: r.event_title ?? `#${r.event_id}` };
    }
  } catch (err) {
    return { ok: false, reason: 'api', message: (err as Error).message };
  }
  return { ok: true, product, email, toSend: Math.max(0, r.quantity - sent), sent, lastError: lastErrors.get(r.id) };
}

/**
 * Sends the request's tickets still missing. Resolves with the plan when all are sent; on an error, the
 * tickets made so far are kept and the error is returned.
 */
export async function sendRewardTickets(r: RewardRequest): Promise<TicketPlan> {
  const plan = await planTickets(r, true);
  if (!plan.ok) return plan;
  const product = (await findTicketProduct(r.event_id!, plan.product))!;
  const user = r.user_id ? findUser(r.user_id) : null;
  const locale = user?.lang === 'en' ? 'en' : 'fr';
  const occurrence = await onlyOccurrence(r.event_id!);
  const names = ticketNames(r).slice(plan.sent);
  for (const name of names) {
    try {
      const res = await api<{ data: { id: number; short_id?: string } }>('POST', `/events/${r.event_id}/attendees`, {
        product_id: product.id,
        ...(product.prices?.[0] ? { product_price_id: product.prices[0].id } : {}),
        ...(occurrence ? { event_occurrence_id: occurrence } : {}),
        email: plan.email,
        ...splitName(name),
        amount_paid: 0,
        send_confirmation_email: true,
        locale,
        override_capacity: true,
      });
      db.query('INSERT INTO reward_tickets (request_id, attendee_id, short_id, name, email) VALUES (?, ?, ?, ?, ?)').run(
        r.id,
        res.data.id,
        res.data.short_id ?? null,
        name,
        plan.email,
      );
    } catch (err) {
      lastErrors.set(r.id, (err as Error).message);
      return { ok: false, reason: 'api', message: (err as Error).message };
    }
  }
  lastErrors.delete(r.id);
  return { ...plan, toSend: 0, sent: r.quantity };
}
