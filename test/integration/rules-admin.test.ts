import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stack, stats, text, uid, type Server } from './harness';

/*
 * Promoters → Rules. From dev/seed.sql: DJMAX sold 4 tickets on Warehouse Night (event 1) and 1 on
 * Winter Opening (event 2); Summer Rooftop (event 4) is over. The engine is behind a proxy the test can
 * turn off.
 */
describeIntegration('rules screens', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let engineUp = true;
  const proxy = Bun.serve({
    port: 0,
    async fetch(req) {
      if (!engineUp) return new Response('down', { status: 502 });
      return fetch(`${stack.rulesUrl}${new URL(req.url).pathname}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() });
    },
  });
  let db: Database;
  const versions = () => db.query<{ n: number }, []>('SELECT count(*) AS n FROM rule_versions').get()!.n;
  const save = (query: string, body: Record<string, string>) => admin.post(`/admin/rules/edit?${query}`, body);
  const check = async (query: string, textValue: string, testTickets = '') => {
    const res = await admin.request(`/admin/rules/check?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textValue, test: testTickets }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const ash = '# Ash\ncommission  = tickets_sold * 5.00\nvip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list     = floor(tickets_sold / 5)\nfree_tickets = 0';

  beforeAll(async () => {
    server = await startServer({ RULES_ENGINE_URL: `http://127.0.0.1:${proxy.port}` });
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    db = new Database(join(server.dataDir, 'promoters.sqlite'));
    // The server writes too (notifications, milestones…): wait for it rather than fail with SQLITE_BUSY.
    db.exec('PRAGMA busy_timeout = 5000');
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
    proxy.stop(true);
  });

  test('admins only', async () => {
    expect(await admin.page('/admin')).toContain('<a href="/admin/rules">Rules</a>');
    expect((await maya.client.get('/admin/rules')).status).toBe(403);
    expect((await maya.client.post('/admin/rules/edit?scope=default', { text: 'commission = 999' })).status).toBe(403);
  });

  test('the default rule, migrated from the old rates, in words', async () => {
    const page = text(await admin.page('/admin/rules'));
    expect(page).toContain('Commission: 10% of your sales at full price, outside Hi.Events too.');
    expect(page).toContain('Free ticket: 1 from your first sale, then 1 more for every 5 tickets sold after the first one.');
    expect(page).toContain('Warehouse Night');
  });

  test('reward types', async () => {
    expect(location(await admin.post('/admin/rules/types', { key: 'vip_tickets', label_en: 'VIP', label_fr: 'VIP' }))).toBe('/admin/rules?ok=reward_type_saved#types');
    expect(location(await admin.post('/admin/rules/types', { key: 'ga_list', label_en: 'GA list', label_fr: 'Liste GA' }))).toBe('/admin/rules?ok=reward_type_saved#types');
    for (const key of ['commission', 'VIP', 'a', 'x y']) {
      expect(location(await admin.post('/admin/rules/types', { key, label_en: 'X' }))).toBe('/admin/rules?error=reward_type#types');
    }
    expect(text(await admin.page('/admin/rules'))).toContain('Liste GA');
  });

  test('a rule with a problem is not saved; problems carry their line', async () => {
    const before = versions();
    const res = await save('scope=event&event=1', { text: 'commission = tickets_sold * 5\nvip = tickets_sold >= 1 ? 2 : 0\nga_list = floor(tickets / 5)' });
    expect(res.status).toBe(400);
    const page = text(await res.text());
    expect(page).toContain('Line 2: vip is not something a rule can give');
    expect(page).toContain('Line 3: tickets is not a variable a rule can read.');
    expect(versions()).toBe(before);
    // An output that goes below 0 on made-up sales is refused too.
    const negative = await save('scope=event&event=1', { text: 'bonus = tickets_sold - 10' });
    expect(negative.status).toBe(400);
    expect(text(await negative.text())).toContain('Line 1: It gives -10 with 0 tickets sold: a rule must give 0 or more.');
    expect(versions()).toBe(before);
  });

  test("Ash's table, end to end: checked live, saved, and paid", async () => {
    const live = await check('scope=event&event=1', ash, '4');
    expect(live.status).toBe(200);
    expect(live.body.problems).toEqual([]);
    expect(live.body.en).toEqual(['Commission: $5.00 per ticket sold.', 'VIP: 2 from your first sale.', 'GA list: 1 for every 5 tickets sold.', 'Free ticket: 0.']);
    expect(live.body.fr).toContain('Liste GA : 1 par tranche de 5 billets vendus.');
    const madeUp = Object.fromEntries((live.body.preview as { made_up?: boolean; tickets: number; values: Record<string, string> }[]).filter((r) => r.made_up).map((r) => [r.tickets, r.values]));
    const table = [1, 4, 5, 12, 20].map((sold) => [sold, madeUp[sold]!.commission, madeUp[sold]!.vip_tickets, madeUp[sold]!.ga_list]);
    expect(table).toEqual([
      [1, '$5.00', '2', '0'],
      [4, '$20.00', '2', '0'],
      [5, '$25.00', '2', '1'],
      [12, '$60.00', '2', '2'],
      [20, '$100.00', '2', '4'],
    ]);
    // Maya's real numbers on the event are in the preview too.
    const real = (live.body.preview as { label: string; tickets: number; values: Record<string, string> }[]).find((r) => r.label === maya.name)!;
    expect(real).toMatchObject({ tickets: 4, values: { commission: '$20.00', vip_tickets: '2', ga_list: '0' } });

    expect(location(await save('scope=event&event=1', { text: ash }))).toBe('/admin/rules/edit?scope=event&event=1&ok=rule_saved');
    expect(stats(await maya.client.page('/events/1')).get('Commission')).toBe('$20.00');
    expect(text(await maya.client.page('/events/1'))).toContain('2 VIP ready for this event');
    // Saving the same text again keeps the version; the history lists it.
    const before = versions();
    await save('scope=event&event=1', { text: ash });
    expect(versions()).toBe(before);
    expect(text(await admin.page('/admin/rules/edit?scope=event&event=1'))).toContain('Versions');
  });

  test('promoters see their deal in words, in their language, never the rule', async () => {
    const en = await maya.client.page('/events/1');
    const card = text(en.slice(en.indexOf('class="card deal-card"'), en.indexOf('class="card links-card"')));
    expect(card).toContain('Your deal on this event');
    expect(card).toContain('Commission: $5.00 per ticket sold.');
    expect(card).toContain('VIP: 2 from your first sale.');
    expect(card).toContain('GA list: 1 for every 5 tickets sold.');
    expect(card).not.toContain('Free tickets'); // free_tickets = 0: nothing to say
    expect(card).toContain('You sold 4: $20.00, 2 VIP, 0 GA list.');
    const fr = text(await (await maya.client.get('/events/1', { headers: { 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8' } })).text());
    expect(fr).toContain('Ton entente pour cet événement');
    expect(fr).toContain('Liste GA : 1 par tranche de 5 billets vendus.');
    expect(fr).toContain('Tu as vendu 4 : 20,00 $, 2 VIP, 0 Liste GA.');
    for (const page of [en, fr]) {
      expect(page).not.toContain('tickets_sold');
      expect(page).not.toContain('floor(');
    }
  });

  test('a promoter\'s own lines on one event, then removed', async () => {
    const query = `scope=promoter_event&user=${maya.id}&event=1`;
    expect(text(await admin.page('/admin/rules/edit?scope=event&event=1'))).toContain(maya.name);
    expect(location(await save(query, { text: 'commission = tickets_sold * 6' }))).toBe(`/admin/rules/edit?${query}&ok=rule_saved`);
    expect(stats(await maya.client.page('/events/1')).get('Commission')).toBe('$24.00');
    // The event's other lines still apply.
    expect(text(await maya.client.page('/events/1'))).toContain('2 VIP ready for this event');
    expect(location(await save(query, { remove: '1' }))).toBe(`/admin/rules/edit?${query}&ok=rule_removed`);
    expect(stats(await maya.client.page('/events/1')).get('Commission')).toBe('$20.00');
  });

  test('templates are copied into an event rule', async () => {
    const res = await save('scope=template', { name: 'Big show', text: 'commission = tickets_sold * 7' });
    const id = location(res)!.match(/template=(\d+)/)![1]!;
    expect(text(await admin.page('/admin/rules'))).toContain('Big show');
    const copied = await admin.page(`/admin/rules/edit?scope=event&event=2&copy=${id}`);
    expect(copied).toContain('commission = tickets_sold * 7</textarea>');
    // Copying does not save: Winter Opening keeps the default rule until saved.
    expect(stats(await maya.client.page('/events/2')).get('Commission')).toBe('$1.00');
  });

  test('without ANTHROPIC_API_KEY, no "Ask Claude"', async () => {
    expect(text(await admin.page('/admin/rules/edit?scope=default'))).not.toContain('Ask Claude');
    expect((await admin.post('/admin/rules/write?scope=default', { description: 'x' })).status).toBe(404);
  });

  test('only events that are not over, and real promoters', async () => {
    expect((await admin.get('/admin/rules/edit?scope=event&event=4')).status).toBe(404);
    expect((await admin.get('/admin/rules/edit?scope=event&event=999')).status).toBe(404);
    expect((await admin.get('/admin/rules/edit?scope=promoter&user=99999')).status).toBe(404);
    expect((await admin.get('/admin/rules/edit?scope=nope')).status).toBe(404);
  });

  test('what is typed is shown as text', async () => {
    const res = await save('scope=event&event=2', { text: '</textarea><script>alert(1)</script>' });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;/textarea&gt;&lt;script&gt;');
  });

  test('with the engine down: nothing checked or saved, and it says so', async () => {
    engineUp = false;
    const before = versions();
    expect((await check('scope=default', 'commission = 1')).status).toBe(503);
    const res = await save('scope=default', { text: 'commission = tickets_sold * 1' });
    expect(res.status).toBe(400);
    expect(text(await res.text())).toContain('The rules engine is not available');
    expect(versions()).toBe(before);
    engineUp = true;
  });

  test('a cross-site post is refused', async () => {
    const res = await admin.post('/admin/rules/edit?scope=default', { text: 'commission = 999' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});
