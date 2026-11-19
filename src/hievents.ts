import postgres from 'postgres';
import { config } from './config';

// Read-only access to the Hi.Events database. Only the columns granted in sql/readonly-role.sql are used.
export const sql = postgres(config.hieventsDatabaseUrl, {
  max: 5,
  idle_timeout: 60,
  connection: { default_transaction_read_only: true, application_name: 'promoter-stats', statement_timeout: 10000 },
});

// Hi.Events records which model an image belongs to by class name.
const EVENT_ENTITY = 'HiEvents\\DomainObjects\\EventDomainObject';

const coverPath = () => sql`
  (SELECT i.path FROM images i
   WHERE i.entity_id = e.id AND i.entity_type = ${EVENT_ENTITY} AND i.type = 'EVENT_COVER' AND i.deleted_at IS NULL
   ORDER BY i.id DESC LIMIT 1)
`;

export async function eventCoverPath(eventId: number): Promise<string | null> {
  const rows = await sql<{ path: string | null }[]>`
    SELECT ${coverPath()} AS path FROM events e WHERE e.id = ${eventId} AND e.deleted_at IS NULL ${accountFilter()}
  `;
  return rows[0]?.path ?? null;
}

export type CodeStats = {
  promo_code_id: number;
  code: string;
  event_id: number;
  event_title: string;
  event_start: Date | null;
  event_end: Date | null;
  event_dates: number;
  event_timezone: string | null;
  has_cover: boolean;
  /** Not published yet in Hi.Events (DRAFT): no link to share. False when the status cannot be read. */
  draft: boolean;
  currency: string;
  tickets_sold: number;
  tickets_pending: number;
  orders: number;
  // What the tickets and products are worth at full price, before the promo code. Commission is based on this.
  full_price: string;
  // What customers actually paid, after promo codes and discounts.
  paid: string;
};

// Dates live in event_occurrences (an event can have several); events.start_date is a legacy fallback.
const eventDates = () => sql`
  LEFT JOIN LATERAL (
    SELECT min(eo.start_date) AS first_start,
           max(coalesce(eo.end_date, eo.start_date)) AS last_end,
           count(*)::int AS dates
    FROM event_occurrences eo
    WHERE eo.event_id = e.id AND eo.deleted_at IS NULL
  ) occ ON true
`;

// Without HIEVENTS_ACCOUNT_IDS, events from every account are visible.
const accountFilter = () => (config.accountIds.length ? sql`AND e.account_id = ANY(${config.accountIds})` : sql``);

// Shared building blocks: the promoter's codes, their orders and the value of each order.
// Refunds are recorded against the gross total, so they reduce both amounts proportionally,
// the same way Hi.Events adjusts its own statistics.
const codeOrderCtes = (codes: string[], eventId?: number) => sql`
  codes AS (
    -- Soft-deleted codes stay in so past sales do not disappear when a code is removed.
    SELECT pc.id, pc.code, pc.event_id
    FROM promo_codes pc
    JOIN events e ON e.id = pc.event_id AND e.deleted_at IS NULL
    WHERE lower(pc.code) = ANY(${codes}) ${accountFilter()}
      ${eventId === undefined ? sql`` : sql`AND e.id = ${eventId}`}
  ),
  code_orders AS (
    SELECT o.id, o.promo_code_id, o.status, o.created_at, o.total_before_additions,
      CASE WHEN o.total_gross > 0 THEN greatest(0, 1 - o.total_refunded / o.total_gross) ELSE 1 END AS kept
    FROM orders o
    WHERE o.promo_code_id IN (SELECT id FROM codes)
      AND o.deleted_at IS NULL
      AND o.status IN ('COMPLETED', 'AWAITING_OFFLINE_PAYMENT')
  ),
  order_values AS (
    -- price_before_discount is only set on items a discount applied to.
    SELECT oi.order_id, sum(oi.quantity * coalesce(oi.price_before_discount, oi.price)) AS full_price
    FROM order_items oi
    WHERE oi.order_id IN (SELECT id FROM code_orders) AND oi.deleted_at IS NULL
    GROUP BY oi.order_id
  ),
  order_tickets AS (
    SELECT a.order_id, count(*)::int AS n
    FROM attendees a
    WHERE a.event_id IN (SELECT event_id FROM codes)
      AND a.order_id IN (SELECT id FROM code_orders)
      AND a.deleted_at IS NULL
      AND a.status <> 'CANCELLED'
    GROUP BY a.order_id
  )
`;

/**
 * One row per (promo code, event). A ticket is an attendee that has not been cancelled, so partial
 * refunds that cancel attendees are excluded. Orders awaiting offline payment are reported as pending
 * and earn nothing until they are paid.
 */
export async function statsForCodes(codes: string[]): Promise<CodeStats[]> {
  if (codes.length === 0) return [];
  const draft = (await canReadStatus()) ? sql`e.status = 'DRAFT'` : sql`false`;
  return sql<CodeStats[]>`
    WITH ${codeOrderCtes(codes)}
    SELECT
      -- bigint ids arrive as strings unless cast.
      c.id::int AS promo_code_id,
      c.code,
      e.id::int AS event_id,
      e.title AS event_title,
      coalesce(occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS event_start,
      coalesce(occ.last_end, occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS event_end,
      coalesce(occ.dates, 0) AS event_dates,
      e.timezone AS event_timezone,
      ${config.imageBaseUrl ? sql`${coverPath()} IS NOT NULL` : sql`false`} AS has_cover,
      ${draft} AS draft,
      e.currency,
      coalesce(sum(t.n) FILTER (WHERE o.status = 'COMPLETED'), 0)::int AS tickets_sold,
      coalesce(sum(t.n) FILTER (WHERE o.status = 'AWAITING_OFFLINE_PAYMENT'), 0)::int AS tickets_pending,
      count(o.id) FILTER (WHERE o.status = 'COMPLETED')::int AS orders,
      round(coalesce(sum(v.full_price * o.kept) FILTER (WHERE o.status = 'COMPLETED'), 0), 2)::text AS full_price,
      round(coalesce(sum(o.total_before_additions * o.kept) FILTER (WHERE o.status = 'COMPLETED'), 0), 2)::text AS paid
    FROM codes c
    JOIN events e ON e.id = c.event_id
    ${eventDates()}
    LEFT JOIN code_orders o ON o.promo_code_id = c.id
    LEFT JOIN order_values v ON v.order_id = o.id
    LEFT JOIN order_tickets t ON t.order_id = o.id
    GROUP BY c.id, c.code, e.id, occ.first_start, occ.last_end, occ.dates
    ORDER BY coalesce(occ.first_start, e.start_date) DESC NULLS LAST, c.code
  `;
}

// One row per day and event (an event can have its own commission rate).
export type DailySales = { day: string; currency: string; tickets: number; full_price: string; event_id?: number };

/** Completed sales per calendar day (in APP_TIMEZONE), by the day the order was placed. */
export async function dailyForCodes(codes: string[], eventId?: number): Promise<DailySales[]> {
  if (codes.length === 0) return [];
  return sql<DailySales[]>`
    WITH ${codeOrderCtes(codes, eventId)}
    SELECT
      to_char((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${config.timezone}, 'YYYY-MM-DD') AS day,
      e.currency,
      e.id::int AS event_id,
      coalesce(sum(t.n), 0)::int AS tickets,
      round(coalesce(sum(v.full_price * o.kept), 0), 2)::text AS full_price
    FROM code_orders o
    JOIN codes c ON c.id = o.promo_code_id
    JOIN events e ON e.id = c.event_id
    LEFT JOIN order_values v ON v.order_id = o.id
    LEFT JOIN order_tickets t ON t.order_id = o.id
    WHERE o.status = 'COMPLETED'
    GROUP BY 1, 2, 3
    ORDER BY 1, 3
  `;
}

/** Tickets sold with these codes, by event and ticket type ("GA", "VIP – Early bird"); '' when the type is unknown. */
export type TicketTypeSales = { event_id: number; type: string; tickets: number; pending: number };

export async function ticketTypesForCodes(codes: string[], eventId?: number): Promise<TicketTypeSales[]> {
  // A role set up before this cannot read the ticket types: no breakdown then, rather than an error.
  if (codes.length === 0 || !(await canReadTicketTypes())) return [];
  // A ticket is an attendee, as in statsForCodes; its type is its product, and the price tier when it has a name.
  return sql<TicketTypeSales[]>`
    WITH ${codeOrderCtes(codes, eventId)}
    SELECT
      a.event_id::int AS event_id,
      coalesce(p.title || coalesce(' – ' || nullif(pp.label, ''), ''), '') AS type,
      count(*) FILTER (WHERE o.status = 'COMPLETED')::int AS tickets,
      count(*) FILTER (WHERE o.status = 'AWAITING_OFFLINE_PAYMENT')::int AS pending
    FROM code_orders o
    JOIN attendees a ON a.order_id = o.id AND a.event_id IN (SELECT event_id FROM codes)
      AND a.deleted_at IS NULL AND a.status <> 'CANCELLED'
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN product_prices pp ON pp.id = a.product_price_id
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC, 2
  `;
}

export type PromoCodeListing = {
  code: string;
  event_title: string;
  event_start: Date | null;
  event_end: Date | null;
  event_timezone: string | null;
  order_usage_count: number;
};

// Every promo code in Hi.Events, newest events first, so the admin can see what exists and what is
// unassigned (Events → Promo codes searches, filters and pages through them).
export async function allPromoCodes(): Promise<PromoCodeListing[]> {
  return sql<PromoCodeListing[]>`
    SELECT pc.code, e.title AS event_title,
           coalesce(occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS event_start,
           coalesce(occ.last_end, occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS event_end,
           e.timezone AS event_timezone, pc.order_usage_count
    FROM promo_codes pc
    JOIN events e ON e.id = pc.event_id AND e.deleted_at IS NULL
    ${eventDates()}
    WHERE pc.deleted_at IS NULL ${accountFilter()}
    ORDER BY coalesce(occ.first_start, e.start_date) DESC NULLS LAST, lower(pc.code)
    LIMIT 10000
  `;
}

export type PageEvent = {
  event_id: number;
  title: string;
  start: Date | null;
  end: Date | null;
  dates: number;
  timezone: string | null;
  has_cover: boolean;
  // Hi.Events spells it as entered; the first of the promoter's codes for the event, alphabetically.
  code: string;
};

/*
 * Hi.Events marks events DRAFT, LIVE or ARCHIVED. Reading it needs `GRANT SELECT (status) ON events`
 * (in sql/readonly-role.sql since public pages were added); without it, every event with a code shows.
 */
let statusReadable: { value: boolean; at: number } | null = null;

async function canReadStatus(): Promise<boolean> {
  if (statusReadable && Date.now() - statusReadable.at < 10 * 60 * 1000) return statusReadable.value;
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
    ) AND has_column_privilege('public.events', 'status', 'SELECT') AS ok
  `.catch(() => [{ ok: false }]);
  statusReadable = { value: !!rows[0]?.ok, at: Date.now() };
  return statusReadable.value;
}

let typesReadable: { value: boolean; at: number } | null = null;

/** Whether the read-only role can read attendees' products and their names (granted in sql/readonly-role.sql). */
async function canReadTicketTypes(): Promise<boolean> {
  if (typesReadable && Date.now() - typesReadable.at < 10 * 60 * 1000) return typesReadable.value;
  const rows = await sql<{ ok: boolean }[]>`
    SELECT has_column_privilege('public.attendees', 'product_id', 'SELECT')
       AND has_column_privilege('public.attendees', 'product_price_id', 'SELECT')
       AND has_column_privilege('public.products', 'title', 'SELECT')
       AND has_column_privilege('public.product_prices', 'label', 'SELECT') AS ok
  `.catch(() => [{ ok: false }]);
  typesReadable = { value: !!rows[0]?.ok, at: Date.now() };
  return typesReadable.value;
}

let waitlistReadable: { value: boolean; at: number } | null = null;

/** Whether waitlist entries record their promo code (Hi.Events with it) and the read-only role may read them. */
async function canReadWaitlist(): Promise<boolean> {
  if (waitlistReadable && Date.now() - waitlistReadable.at < 10 * 60 * 1000) return waitlistReadable.value;
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'waitlist_entries' AND column_name = 'promo_code_id'
    ) AND has_column_privilege('public.waitlist_entries', 'promo_code_id', 'SELECT')
      AND has_column_privilege('public.waitlist_entries', 'status', 'SELECT') AS ok
  `.catch(() => [{ ok: false }]);
  waitlistReadable = { value: !!rows[0]?.ok, at: Date.now() };
  return waitlistReadable.value;
}

/** People on an event's waitlist who joined with one of these codes: waiting, offered a spot, or who bought it. */
export type WaitlistCounts = { event_id: number; waiting: number; offered: number; bought: number };

export async function waitlistForCodes(codes: string[], eventId?: number): Promise<WaitlistCounts[]> {
  if (codes.length === 0 || !(await canReadWaitlist())) return [];
  return sql<WaitlistCounts[]>`
    SELECT
      w.event_id::int AS event_id,
      count(*) FILTER (WHERE w.status = 'WAITING')::int AS waiting,
      count(*) FILTER (WHERE w.status = 'OFFERED')::int AS offered,
      count(*) FILTER (WHERE w.status = 'PURCHASED')::int AS bought
    FROM waitlist_entries w
    JOIN promo_codes pc ON pc.id = w.promo_code_id
    JOIN events e ON e.id = w.event_id AND e.deleted_at IS NULL
    WHERE lower(pc.code) = ANY(${codes}) AND w.deleted_at IS NULL ${accountFilter()}
      ${eventId === undefined ? sql`` : sql`AND w.event_id = ${eventId}`}
    GROUP BY 1
    HAVING count(*) FILTER (WHERE w.status IN ('WAITING', 'OFFERED', 'PURCHASED')) > 0
  `;
}

/** The upcoming events a promoter's public page lists: not ended, not deleted, and live when that is known. No sales figures. */
export type EventCode = { event_id: number; title: string; start: Date | null; timezone: string | null; currency: string; code: string };

/** Every promo code (lower-cased) on events that are not over, drafts included, for Pay & rewards → Commissions and Media drives. */
export async function currentEventCodes(): Promise<EventCode[]> {
  return sql<EventCode[]>`
    SELECT DISTINCT
      e.id::int AS event_id,
      e.title,
      coalesce(occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS "start",
      e.timezone,
      e.currency,
      lower(pc.code) AS code
    FROM promo_codes pc
    JOIN events e ON e.id = pc.event_id AND e.deleted_at IS NULL
    ${eventDates()}
    WHERE pc.deleted_at IS NULL ${accountFilter()}
      AND (coalesce(occ.last_end, occ.first_start, e.start_date) IS NULL
           OR coalesce(occ.last_end, occ.first_start, e.start_date) >= (now() AT TIME ZONE 'UTC'))
  `.then((rows) => rows.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.event_id - b.event_id));
}

export type EventCodeTickets = { event_id: number; code: string | null; tickets: number };

/** Tickets sold for whole events, by promo code (null: no code), with the same definition as the stats. */
export async function ticketsByEventAndCode(eventIds: number[]): Promise<EventCodeTickets[]> {
  if (eventIds.length === 0) return [];
  return sql<EventCodeTickets[]>`
    SELECT o.event_id::int AS event_id, lower(pc.code) AS code, count(a.id)::int AS tickets
    FROM orders o
    JOIN attendees a ON a.order_id = o.id AND a.deleted_at IS NULL AND a.status <> 'CANCELLED'
    LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
    WHERE o.event_id = ANY(${eventIds}) AND o.deleted_at IS NULL AND o.status = 'COMPLETED'
    GROUP BY 1, 2
  `;
}

export type TicketEvent = { id: number; title: string; start: Date | null; timezone: string | null };

/** Every published event that is not over, soonest first: the ones free tickets can be used on. */
export async function publishedUpcomingEvents(): Promise<TicketEvent[]> {
  const live = (await canReadStatus()) ? sql`AND e.status = 'LIVE'` : sql``;
  return sql<TicketEvent[]>`
    SELECT
      e.id::int AS id,
      e.title,
      coalesce(occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS "start",
      e.timezone
    FROM events e
    ${eventDates()}
    WHERE e.deleted_at IS NULL ${accountFilter()} ${live}
      AND (coalesce(occ.last_end, occ.first_start, e.start_date) IS NULL
           OR coalesce(occ.last_end, occ.first_start, e.start_date) >= (now() AT TIME ZONE 'UTC'))
  `.then((rows) => rows.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.id - b.id));
}

export async function upcomingEventsForCodes(codes: string[]): Promise<PageEvent[]> {
  if (codes.length === 0) return [];
  const live = (await canReadStatus()) ? sql`AND e.status = 'LIVE'` : sql``;
  return sql<PageEvent[]>`
    SELECT DISTINCT ON (e.id)
      e.id::int AS event_id,
      e.title,
      coalesce(occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS "start",
      coalesce(occ.last_end, occ.first_start, e.start_date) AT TIME ZONE 'UTC' AS "end",
      coalesce(occ.dates, 0) AS dates,
      e.timezone,
      ${config.imageBaseUrl ? sql`${coverPath()} IS NOT NULL` : sql`false`} AS has_cover,
      pc.code
    FROM promo_codes pc
    JOIN events e ON e.id = pc.event_id AND e.deleted_at IS NULL
    ${eventDates()}
    WHERE lower(pc.code) = ANY(${codes}) AND pc.deleted_at IS NULL ${accountFilter()} ${live}
      -- Like the dashboard: an event without dates counts as upcoming.
      AND (coalesce(occ.last_end, occ.first_start, e.start_date) IS NULL
           OR coalesce(occ.last_end, occ.first_start, e.start_date) >= (now() AT TIME ZONE 'UTC'))
    ORDER BY e.id, pc.code
  `.then((rows) => rows.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity)));
}
