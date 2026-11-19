import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Waitlists. From dev/seed.sql, Warehouse Night (event 1) has a waitlist: with DJMAX, 2 waiting, 1 offered a
 * spot, 1 bought and 1 who left; 1 with LUNA and 1 without a code. A fake Hi.Events public API says Warehouse
 * Night is sold out with its waitlist on, and Winter Opening (event 2) is on sale.
 */
describeIntegration('waitlists', () => {
  let server: Server;
  let admin: Client;
  let fake: ReturnType<typeof Bun.serve>;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let alias: string;
  let calls = 0;

  const product = (o: Record<string, unknown>) => ({ product_type: 'TICKET', is_sold_out: false, is_available: true, waitlist_enabled: true, ...o });

  beforeAll(async () => {
    fake = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        calls++;
        // Public: no key is ever sent.
        if (req.headers.get('authorization')) return new Response('no', { status: 400 });
        const id = new URL(req.url).pathname.match(/^\/api\/public\/events\/(\d+)$/)?.[1];
        if (id === '1') return Response.json({ data: { product_categories: [{ products: [product({ is_sold_out: true, is_available: false })] }] } });
        if (id === '2') return Response.json({ data: { product_categories: [{ products: [product({})] }] } });
        return Response.json({ message: 'Not found' }, { status: 404 });
      },
    });
    server = await startServer({ HIEVENTS_PUBLIC_URL: 'https://tickets.example.test', HIEVENTS_API_URL: `http://127.0.0.1:${fake.port}/api` });
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    alias = `maya-${uid()}`;
    const form = new FormData();
    form.set('alias', alias);
    form.set('theme', 'system');
    expect(location(await maya.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
    fake?.stop(true);
  });

  const card = (html: string, title: string) => {
    const page = text(html);
    const at = page.indexOf(title);
    return page.slice(at, at + 400);
  };

  test('the dashboard says the waitlist is open, and who joined with their code', async () => {
    const html = await maya.client.page('/');
    const warehouse = card(html, 'Warehouse Night');
    expect(warehouse).toContain('Sold out · waitlist open');
    expect(warehouse).toContain('Waitlist with your code: 2 waiting · 1 offered a spot · 1 bought');
    expect(card(html, 'Winter Opening')).not.toContain('waitlist');
  });

  test('the event page explains it, and the link stays the same', async () => {
    const html = await maya.client.page('/events/1');
    const page = text(html);
    expect(page).toContain('Keep sharing your link: it takes people to the waitlist with your code.');
    expect(page).toContain('Waitlist with your code: 2 waiting');
    expect(html).toContain('promo_code=DJMAX');
  });

  test('another promoter only sees the people who came with their code', async () => {
    const luna = await newPromoter(server, admin, { name: `Luna ${uid()}`, codes: 'LUNA' });
    const warehouse = card(await luna.client.page('/'), 'Warehouse Night');
    expect(warehouse).toContain('Waitlist with your code: 1 waiting');
    expect(warehouse).not.toContain('offered');
  });

  test('the public page sends visitors to the waitlist', async () => {
    const page = text(await (await new Client(server).get(`/p/${alias}`)).text());
    expect(card(page, 'Warehouse Night')).toContain('Join the waitlist');
    expect(card(page, 'Winter Opening')).toContain('Get tickets');
  });

  test('admins see it on the promoter, and the API returns it', async () => {
    const page = text(await admin.page(`/admin/promoters/${maya.id}`));
    expect(page).toContain('Waitlist with their codes');
    expect(page).toMatch(/Warehouse Night 2 1 1/);

    const res = await maya.client.post('/account/api/keys', { name: `Key ${uid()}` });
    const key = (await res.text()).match(/value="(psk_[A-Za-z0-9_-]+)"/)![1]!;
    const stats = (await (await fetch(`${server.url}/api/v1/stats`, { headers: { authorization: `Bearer ${key}` } })).json()) as any;
    const events = new Map<number, any>(stats.events.map((e: any) => [e.event_id, e]));
    expect(events.get(1).waitlist).toEqual({ open: true, sold_out: true, before_sale: false, waiting: 2, offered: 1, bought: 1 });
    expect(events.get(2).waitlist).toBeNull();
  });

  test('Hi.Events is asked at most once every two minutes per event', async () => {
    const before = calls;
    await maya.client.page('/');
    await maya.client.page('/events/1');
    expect(calls).toBe(before);
  });
});
