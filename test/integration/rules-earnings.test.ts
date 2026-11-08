import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stack, stats, text, uid, type Server } from './harness';

/*
 * Commission, bonus and typed rewards worked out by the rules, in the running app. From dev/seed.sql,
 * DJMAX sold 4 tickets on Warehouse Night (event 1, upcoming), 1 on Winter Opening (event 2, upcoming)
 * and 3 on Summer Rooftop (event 4, over). The rules engine is reached through a proxy the test can
 * turn off, to see what happens while it is down.
 */
describeIntegration('earnings from rules', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let engineUp = true;
  const proxy = Bun.serve({
    port: 0,
    async fetch(req) {
      if (!engineUp) return new Response('down', { status: 502 });
      const url = new URL(req.url);
      return fetch(`${stack.rulesUrl}${url.pathname}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() });
    },
  });
  let db: Database;
  const setRule = (scope: string, eventId: number | null, text: string) =>
    db.query('INSERT INTO rule_versions (scope, event_id, text) VALUES (?, ?, ?)').run(scope, eventId, text);
  const ash = 'commission  = tickets_sold * 5.00\nvip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list     = floor(tickets_sold / 5)';
  const card = (html: string, title: string) => text(html.split('class="card event-card"').find((c) => c.includes(title)) ?? '');

  beforeAll(async () => {
    server = await startServer({ RULES_ENGINE_URL: `http://127.0.0.1:${proxy.port}` });
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.query("INSERT INTO reward_types (key, label_en, label_fr) VALUES ('vip_tickets', 'VIP', 'VIP'), ('ga_list', 'GA list', 'Liste GA')").run();
    setRule('event', 1, ash);
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
    proxy.stop(true);
  });

  test("Ash's deal on Warehouse Night; the default rule elsewhere", async () => {
    const home = await maya.client.page('/');
    const night = card(home, 'Warehouse Night');
    expect(night).toContain('$20.00'); // 4 tickets × $5
    expect(night).toContain('2 VIP ready');
    expect(card(home, 'Winter Opening')).toContain('$1.00'); // 10% of $10
    const event = await maya.client.page('/events/1');
    expect(stats(event).get('Commission')).toBe('$20.00');
    expect(text(event)).toContain('2 VIP ready for this event');
    // 4 sold: the first GA list spot comes at 5, found by evaluating the rule with more sales.
    expect(text(event)).toContain('GA list for this event');
    expect(text(event)).toContain('1 more sale for the next one');
    // Winter Opening keeps the default free tickets.
    expect(text(await maya.client.page('/events/2'))).toContain('1 free ticket ready for this event');
  });

  test('a bonus is earned on top, kept apart from the commission', async () => {
    setRule('event', 1, `${ash}\nbonus = tickets_sold >= 4 ? 10 : 0`);
    const home = await maya.client.page('/');
    expect(card(home, 'Warehouse Night')).toContain('$10.00 bonus');
    const cards = stats(home);
    const earned = [...cards].find(([label]) => label.startsWith('Commission earned'))!;
    expect(earned[0]).toContain('incl. $10.00 bonus');
    // $20 (Ash) + $10 (Someone else's event) + $1 (Winter Opening) + $7.50 (Summer Rooftop) + the $10 bonus.
    expect(earned[1]).toBe('$48.50');
    expect(stats(await maya.client.page('/events/1')).get('Bonus')).toBe('$10.00');
  });

  test('typed rewards are requested by type and keep their rule versions', async () => {
    const res = await maya.client.post('/rewards/ticket', { event_id: '1', reward_type: 'vip_tickets', quantity: '2', details: 'Ash +1' });
    expect(location(res)).toBe('/payouts?ok=reward_requested#rewards');
    expect((await maya.client.post('/rewards/ticket', { event_id: '1', reward_type: 'vip_tickets', quantity: '1', details: '' })).status).toBe(400);
    expect(text(await admin.page('/admin/payouts'))).toContain('2 VIP for Warehouse Night');
    const row = db.query<{ reward_type: string; reward_label: string; rule_versions: string }, []>('SELECT reward_type, reward_label, rule_versions FROM reward_requests ORDER BY id DESC LIMIT 1').get()!;
    expect(row.reward_type).toBe('vip_tickets');
    expect(row.reward_label).toBe('VIP');
    expect(JSON.parse(row.rule_versions).length).toBeGreaterThanOrEqual(2); // the default rule and the event's
  });

  test('admins give or take back a reward of one type by hand', async () => {
    const page = await admin.page(`/admin/promoters/${maya.id}`);
    expect(page).toContain('<option value="ga_list">GA list</option>');
    const res = await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'free_tickets', event_id: '1', reward_type: 'ga_list', quantity: '1', label: 'Brought a crew' });
    expect(location(res)).toContain('ok=adjusted');
    expect(text(await maya.client.page('/events/1'))).toContain('1 GA list ready for this event');
    expect(location(await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'free_tickets', event_id: '1', reward_type: 'nope', quantity: '1', label: 'x' }))).toContain('error=adjust_event');
  });

  test('a payout keeps the rule versions its balance came from', async () => {
    expect(location(await maya.client.post('/payouts', { currency: 'CAD', amount: '5', method: 'Interac e-Transfer', details: 'maya@example.com', note: '' }))).toContain('ok=');
    const versions = JSON.parse(db.query<{ rule_versions: string }, []>('SELECT rule_versions FROM payout_requests ORDER BY id DESC LIMIT 1').get()!.rule_versions);
    const ids = db.query<{ id: number }, []>("SELECT id FROM rule_versions WHERE scope IN ('default', 'event')").all().map((r) => r.id);
    expect(versions.every((v: number) => ids.includes(v))).toBe(true);
  });

  test('sales outside Hi.Events for an event count in its rule', async () => {
    const before = stats(await maya.client.page('/events/2')).get('Commission');
    expect(before).toBe('$1.00');
    const res = await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'outside_sale', event_id: '2', quantity: '2', sales: '50', label: 'Door' });
    expect(location(res)).toContain('ok=adjusted');
    // The default rule counts outside_sales: 10% of $10 + $50.
    expect(stats(await maya.client.page('/events/2')).get('Commission')).toBe('$6.00');
  });

  test('while the engine is down: last numbers, a notice, and no payout approved', async () => {
    engineUp = false;
    const queue = await admin.page('/admin/payouts');
    const id = queue.match(/action="\/admin\/payouts\/(\d+)\/paid"/)![1]!;
    // Approving checks the engine first, and refuses.
    expect(location(await admin.post(`/admin/payouts/${id}/paid`, { admin_note: '' }))).toBe('/admin/payouts?error=rules_down');
    expect(text(await admin.page('/admin/payouts'))).toContain('The rules engine is not available');
    // Promoters still see their numbers (the last ones known), with a gentle notice.
    const home = await maya.client.page('/');
    expect(card(home, 'Warehouse Night')).toContain('$20.00');
    expect(text(home)).toContain('Some numbers may be a little behind');

    engineUp = true;
    expect(location(await admin.post(`/admin/payouts/${id}/paid`, { admin_note: 'REF-1' }))).toBe('/admin/payouts?ok=payout_paid');
    expect(text(await maya.client.page('/'))).not.toContain('Some numbers may be a little behind');
  });

  test('a rule that gives a negative amount counts it as 0', async () => {
    setRule('event', 2, 'commission = 0 - 5');
    expect(stats(await maya.client.page('/events/2')).get('Commission')).toBe('$0.00');
  });

  test('team_full_price_sales: what a team lead\'s promoters sold since joining, not the team lead\'s own', async () => {
    // Luna (LUNA, $25 on Warehouse Night) leads; Maya (DJMAX) joins today. Maya sold $100 there in all, but
    // only today's $25 sale comes after she joined; Luna's own $25 does not count either.
    const luna = await newPromoter(server, admin, { name: `Luna ${uid()}`, codes: 'LUNA' });
    await admin.post('/admin/teams/lead', { user_id: String(luna.id), lead: '1' });
    await admin.post('/admin/teams/add', { user_id: String(maya.id), team_lead_id: String(luna.id) });
    setRule('event', 1, `${ash}\nbonus = team_full_price_sales * 0.1`);
    expect(stats(await luna.client.page('/events/1')).get('Bonus')).toBe('$2.50');
    // Maya is not a team lead: 0 for her, so no bonus.
    expect(stats(await maya.client.page('/events/1')).get('Bonus')).toBeUndefined();
  });

});
