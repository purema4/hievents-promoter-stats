import postgres from 'postgres';

// The app's own connection is read-only, as in production; only the demo writes to its Hi.Events database.
export const writer = postgres(process.env.DEMO_DATABASE_URL!, { max: 2, onnotice: () => {} });

export type NewOrder = {
  eventId: number;
  promoCodeId: number | null;
  status: 'COMPLETED' | 'AWAITING_OFFLINE_PAYMENT' | 'CANCELLED';
  tickets: number;
  price: number; // one ticket at full price
  refunded?: number; // tickets refunded out of the order
  createdAt: Date;
  name: string;
};

const cents = (n: number) => Math.round(n * 100) / 100;
const CODE_DISCOUNT = 0.1;
const TAXES_AND_FEES = 1.15;

// Each event's ticket types, made the first time it sells: GA in two price tiers, and VIP.
type Types = { product: number; price: number }[];
const typesOf = new Map<number, Types>();
/** Forgets them, for a demo seeded again from empty. */
export const forgetTicketTypes = () => typesOf.clear();
async function ticketTypes(eventId: number): Promise<Types> {
  const known = typesOf.get(eventId);
  if (known) return known;
  const [ga] = await writer<{ id: string }[]>`INSERT INTO products (event_id, title) VALUES (${eventId}, 'GA') RETURNING id`;
  const [vip] = await writer<{ id: string }[]>`INSERT INTO products (event_id, title) VALUES (${eventId}, 'VIP') RETURNING id`;
  const prices = await writer<{ id: string; product_id: string }[]>`
    INSERT INTO product_prices (product_id, label) VALUES (${ga!.id}, 'Early bird'), (${ga!.id}, 'Regular'), (${vip!.id}, NULL)
    RETURNING id, product_id`;
  const types = prices.map((p) => ({ product: Number(p.product_id), price: Number(p.id) }));
  typesOf.set(eventId, types);
  return types;
}
/** Mostly regular GA, some early bird, about one VIP in seven. */
const typeFor = (types: Types, order: number, n: number) => {
  const pick = (order * 3 + n) % 7;
  return pick === 0 ? types[2]! : pick <= 2 ? types[0]! : types[1]!;
};

/** Adds orders the way Hi.Events records them: the order, its items and one attendee per ticket. */
export async function addOrders(orders: NewOrder[]) {
  for (let start = 0; start < orders.length; start += 400) {
    const batch = orders.slice(start, start + 400);
    const sold = batch.map((o) => cents(o.price * (o.promoCodeId ? 1 - CODE_DISCOUNT : 1)));
    const rows = await writer<{ id: string }[]>`
      INSERT INTO orders ${writer(
        batch.map((o, i) => {
          const gross = cents(sold[i]! * o.tickets * TAXES_AND_FEES);
          return {
            event_id: o.eventId,
            promo_code_id: o.promoCodeId,
            status: o.status,
            total_before_additions: cents(sold[i]! * o.tickets),
            total_gross: gross,
            total_refunded: cents((gross * (o.refunded ?? 0)) / o.tickets),
            first_name: o.name,
            email: `${o.name.toLowerCase()}@example.com`,
            created_at: o.createdAt,
          };
        }),
      )}
      RETURNING id`;
    const ids = rows.map((r) => Number(r.id));
    for (const o of batch) await ticketTypes(o.eventId);
    await writer`INSERT INTO order_items ${writer(
      batch.map((o, i) => ({
        order_id: ids[i]!,
        item_name: 'General admission',
        quantity: o.tickets,
        price: sold[i]!,
        price_before_discount: o.promoCodeId ? o.price : null,
      })),
    )}`;
    await writer`INSERT INTO attendees ${writer(
      batch.flatMap((o, i) =>
        Array.from({ length: o.tickets }, (_, n) => ({
          order_id: ids[i]!,
          event_id: o.eventId,
          product_id: typeFor(typesOf.get(o.eventId)!, ids[i]!, n).product,
          product_price_id: typeFor(typesOf.get(o.eventId)!, ids[i]!, n).price,
          status: o.status === 'CANCELLED' || n < (o.refunded ?? 0) ? 'CANCELLED' : o.status === 'COMPLETED' ? 'ACTIVE' : 'AWAITING_PAYMENT',
        })),
      ),
    )}`;
  }
  await writer`
    UPDATE promo_codes pc SET order_usage_count =
      (SELECT count(*) FROM orders o WHERE o.promo_code_id = pc.id AND o.status <> 'CANCELLED')`;
}

export type OpenEvent = { promoCodeId: number; eventId: number; title: string; price: number };

/** The next published event one of these codes works for, with its ticket price. */
export async function nextEvent(codes: string[]): Promise<OpenEvent | null> {
  if (codes.length === 0) return null;
  const rows = await writer<OpenEvent[]>`
    SELECT pc.id::int AS "promoCodeId", e.id::int AS "eventId", e.title,
      coalesce((SELECT max(oi.price_before_discount) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.event_id = e.id), 30)::float AS price
    FROM promo_codes pc
    JOIN events e ON e.id = pc.event_id AND e.status = 'LIVE'
    JOIN event_occurrences eo ON eo.event_id = e.id
    WHERE lower(pc.code) = ANY(${codes}) AND eo.start_date > now()
    ORDER BY eo.start_date
    LIMIT 1`;
  return rows[0] ?? null;
}
