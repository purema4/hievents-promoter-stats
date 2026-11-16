import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Ticket rewards sent from Hi.Events through its API. A fake Hi.Events API runs in the test: it checks the
 * key, lists event 1's tickets and records each attendee the app creates.
 */
const API_KEY = 'hie_test-key-0123456789abcdef';

type Attendee = Record<string, unknown> & { event: number };

describeIntegration('ticket rewards sent from Hi.Events', () => {
  let server: Server;
  let admin: Client;
  let db: Database;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let fake: ReturnType<typeof Bun.serve>;
  // The fake's state, reset before each test.
  let products: { id: number; title: string; type: string; prices: { id: number }[] }[] = [];
  let attendees: Attendee[] = [];
  let failAfter = Infinity;
  let delayMs = 0;
  let badAuth = 0;

  beforeAll(async () => {
    fake = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        if (req.headers.get('authorization') !== `Bearer ${API_KEY}`) {
          badAuth++;
          return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
        }
        const path = new URL(req.url).pathname;
        let m = path.match(/^\/api\/events\/(\d+)\/products$/);
        if (m && req.method === 'GET') return Response.json({ data: m[1] === '1' ? products : [] });
        m = path.match(/^\/api\/events\/(\d+)\/occurrences$/);
        if (m && req.method === 'GET') return Response.json({ data: [{ id: 70 + Number(m[1]) }] });
        m = path.match(/^\/api\/events\/(\d+)\/attendees$/);
        if (m && req.method === 'POST') {
          if (delayMs) await Bun.sleep(delayMs);
          if (attendees.length >= failAfter) return Response.json({ message: 'The ticket is sold out.', errors: { product_id: ['The ticket is sold out.'] } }, { status: 422 });
          const body = (await req.json()) as Record<string, unknown>;
          attendees.push({ ...body, event: Number(m[1]) });
          return Response.json({ data: { id: 900 + attendees.length, short_id: `a-${attendees.length}`, ...body } }, { status: 201 });
        }
        return Response.json({ message: 'Not found' }, { status: 404 });
      },
    });
    server = await startServer({ HIEVENTS_API_URL: `http://127.0.0.1:${fake.port}/api`, HIEVENTS_API_KEY: API_KEY });
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.exec('PRAGMA busy_timeout = 5000');
    db.query("INSERT INTO reward_types (key, label_en, label_fr) VALUES ('vip_tickets', 'VIP', 'VIP')").run();
    db.query("INSERT INTO reward_types (key, label_en, label_fr, guest_list) VALUES ('ga_list', 'GA list', 'Liste GA', 1)").run();
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
    fake?.stop(true);
  });
  beforeEach(() => {
    products = [{ id: 101, title: 'GL GA', type: 'FREE', prices: [{ id: 201 }] }];
    attendees = [];
    failAfter = Infinity;
    delayMs = 0;
  });

  /** A waiting ticket request for Maya, as the checkout would leave it. */
  function request(quantity: number, type: string | null, details = maya.name, eventId: number | null = 1): string {
    const row = db
      .query<{ id: number }, [number, string, string, number | null, number, string, string | null, string | null]>(
        `INSERT INTO reward_requests (user_id, promoter_name, promoter_email, kind, event_id, event_title, quantity, details, reward_type, reward_label, source_event_id, source_event_title)
         VALUES (?, ?, ?, 'ticket', ?, 'Warehouse Night', ?, ?, ?, ?, 1, 'Warehouse Night') RETURNING id`,
      )
      .get(maya.id, maya.name, maya.email, eventId, quantity, details, type, type === 'vip_tickets' ? 'VIP' : type ? 'GA list' : null)!;
    return String(row.id);
  }
  const status = (id: string) => db.query<{ status: string }, [string]>('SELECT status FROM reward_requests WHERE id = ?').get(id)!.status;
  const card = async (id: string) => {
    const page = await admin.page('/admin/payouts');
    const at = page.indexOf(`action="/admin/rewards/${id}/fulfil"`);
    return text(page.slice(at, page.indexOf('</tr>', at)));
  };
  const give = (id: string, send = true) => admin.post(`/admin/rewards/${id}/fulfil`, { admin_note: '', ...(send ? { send_tickets: '1' } : {}) });

  test('giving free tickets sends them from Hi.Events on GL GA, to the promoter', async () => {
    const id = request(2, null);
    expect(await card(id)).toContain(`Send 2 × GL GA from Hi.Events to ${maya.email}`);
    expect(location(await give(id))).toBe('/admin/payouts?ok=tickets_sent');
    expect(status(id)).toBe('fulfilled');
    expect(attendees).toHaveLength(2);
    expect(attendees[0]).toMatchObject({
      event: 1,
      product_id: 101,
      product_price_id: 201,
      event_occurrence_id: 71,
      email: maya.email,
      first_name: 'Maya',
      amount_paid: 0,
      send_confirmation_email: true,
      override_capacity: true,
    });
    // Given once: a second click sends nothing more.
    expect(location(await give(id))).toBe('/admin/payouts?error=payout_gone');
    expect(attendees).toHaveLength(2);
    expect(text(await maya.client.page('/payouts'))).toContain('Given');
  });

  test('a guest list puts the guests’ names on the tickets', async () => {
    const id = request(2, 'ga_list', 'Guest list: Ann Lee, Bob');
    expect(location(await give(id))).toBe('/admin/payouts?ok=tickets_sent');
    expect(attendees.map((a) => [a.first_name, a.last_name, a.product_id])).toEqual([
      ['Ann', 'Lee', 101],
      ['Bob', '', 101],
    ]);
  });

  test('a missing GL VIP ticket is named, and the request keeps waiting', async () => {
    const id = request(2, 'vip_tickets');
    expect(await card(id)).toContain('No “GL VIP” ticket in Warehouse Night');
    expect(location(await give(id))).toBe('/admin/payouts?error=ticket_missing');
    expect(status(id)).toBe('pending');
    expect(attendees).toHaveLength(0);

    // Created in Hi.Events: one goes out, the second fails; trying again sends only the one missing.
    products.push({ id: 102, title: 'gl vip ', type: 'PAID', prices: [{ id: 202 }] });
    failAfter = 1;
    expect(location(await give(id))).toBe('/admin/payouts?error=tickets_api');
    expect(await card(id)).toContain('Last try: Hi.Events answered 422: The ticket is sold out.');
    expect(status(id)).toBe('pending');
    expect(attendees).toHaveLength(1);
    expect(await card(id)).toContain('Send 1 × GL VIP from Hi.Events');
    expect(await card(id)).toContain('(1 already sent)');

    failAfter = Infinity;
    expect(location(await give(id))).toBe('/admin/payouts?ok=tickets_sent');
    expect(attendees.map((a) => a.product_id)).toEqual([102, 102]);
    expect(status(id)).toBe('fulfilled');
    expect(await admin.page('/admin/payouts?error=tickets_api&why=Pay+here')).not.toContain('Pay here');
  });

  test('unticked, it is only marked as given; deposits into the bank never call Hi.Events', async () => {
    const id = request(1, null);
    expect(location(await give(id, false))).toBe('/admin/payouts?ok=reward_fulfilled');
    const deposit = request(1, null, maya.name, null);
    expect(await card(deposit)).not.toContain('Hi.Events');
    expect(location(await give(deposit))).toBe('/admin/payouts?ok=reward_fulfilled');
    expect(attendees).toHaveLength(0);
  });

  test('two clicks at once send the tickets once', async () => {
    const id = request(2, null);
    delayMs = 300;
    const [a, b] = await Promise.all([give(id), give(id)]);
    expect([location(a), location(b)].sort()).toEqual(['/admin/payouts?error=tickets_busy', '/admin/payouts?ok=tickets_sent']);
    expect(attendees).toHaveLength(2);
  });

  test('the key stays on the server, and promoters cannot give rewards', async () => {
    const id = request(1, null);
    for (const path of ['/admin/payouts', '/admin/rules']) expect(await admin.page(path)).not.toContain(API_KEY);
    expect((await maya.client.post(`/admin/rewards/${id}/fulfil`, { send_tickets: '1' })).status).toBe(403);
    expect(attendees).toHaveLength(0);
    expect(status(id)).toBe('pending');
    expect(badAuth).toBe(0);
  });

  {
    const rpc = async (key: string, name: string, args: unknown) =>
      (
        (await (
          await fetch(`${server.url}/mcp`, {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
          })
        ).json()) as any
      ).result ?? { isError: true, notAllowed: true };
    const makeKey = async (client: Client) => {
      const res = await client.post('/account/api/keys', { name: `Key ${uid()}`, can_write: '1' });
      return (await res.text()).match(/value="(psk_[A-Za-z0-9_-]+)"/)![1]!;
    };

    test('the MCP settle_reward tool sends the tickets too, and says what is missing', async () => {
      const key = await makeKey(admin);
      const id = request(1, null);
      const given = await rpc(key, 'settle_reward', { reward_id: Number(id), action: 'given' });
      expect(given.isError).toBeUndefined();
      expect(given.structuredContent).toMatchObject({ tickets_sent: 1, reward: { status: 'given', tickets_sent: 1 } });
      expect(attendees).toHaveLength(1);

      const vip = request(1, 'vip_tickets');
      const missing = await rpc(key, 'settle_reward', { reward_id: Number(vip), action: 'given' });
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toContain('No ticket named "GL VIP" in Warehouse Night');
      expect(status(vip)).toBe('pending');
      // Handed out another way.
      expect((await rpc(key, 'settle_reward', { reward_id: Number(vip), action: 'given', send_tickets: false })).structuredContent.tickets_sent).toBe(0);
      expect(status(vip)).toBe('fulfilled');
      expect(attendees).toHaveLength(1);
    });

    test('a promoter’s key cannot settle rewards', async () => {
      const key = await makeKey(maya.client);
      const id = request(1, null);
      expect((await rpc(key, 'settle_reward', { reward_id: Number(id), action: 'given' })).isError).toBe(true);
      expect(status(id)).toBe('pending');
      expect(attendees).toHaveLength(0);
    });
  }
});
