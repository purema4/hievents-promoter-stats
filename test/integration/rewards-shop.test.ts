import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, waitForSubject, type Server } from './harness';

/*
 * Payouts & rewards as a shop. From dev/seed.sql: DJMAX sold 4 tickets on Warehouse Night (event 1) and
 * 1 on Winter Opening (event 2). Warehouse Night gives 2 VIP from the first sale and a GA list spot every
 * 5 tickets; the default rule's free tickets apply everywhere (1 from the first sale).
 */
describeIntegration('rewards shop', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let db: Database;
  const requests = () => db.query<{ n: number }, []>('SELECT count(*) AS n FROM reward_requests').get()!.n;
  const order = (fields: Record<string, string>) => maya.client.post('/rewards/order', fields);

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.query("INSERT INTO reward_types (key, label_en, label_fr) VALUES ('vip_tickets', 'VIP', 'VIP'), ('ga_list', 'GA list', 'Liste GA')").run();
    db.query("INSERT INTO rule_versions (scope, event_id, text) VALUES ('event', 1, ?)").run('vip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list = floor(tickets_sold / 5)');
    // One merch item, given by hand.
    await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'merch', quantity: '1', label: 'Street team' });
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
  });

  test('every reward is a card: what it is, how many are ready, and what comes next', async () => {
    const page = await maya.client.page('/payouts');
    expect(text(page)).toContain('Rewards shop');
    const card = (name: string) => text(page.slice(page.indexOf(`data-name="${name}"`)).split('data-shop-item')[0]!);
    expect(card('VIP · Warehouse Night')).toMatch(/2 ready/);
    expect(card('Free tickets · Warehouse Night')).toMatch(/1 ready/);
    expect(card('Free tickets · Winter Opening')).toMatch(/1 ready/);
    // Nothing ready yet: shown, with how far to go.
    expect(card('GA list · Warehouse Night')).toContain('None ready yet.');
    expect(card('GA list · Warehouse Night')).toContain('1 more sale for the next one');
    expect(card('Merch')).toMatch(/1 ready/);
    expect(page).toContain('action="/rewards/order"');
    expect(text(page)).toContain('Your cart');
  });

  test('a whole cart in one request: for me and a guest, rolled over, and merch', async () => {
    const res = await order({
      'qty.1.vip_tickets': '2',
      'me.1.vip_tickets': '1',
      'guests.1.vip_tickets': 'Ana',
      'qty.1.free_tickets': '1',
      'me.1.free_tickets': '1',
      'for.1.free_tickets': '2', // rolled over to Winter Opening
      'qty.merch': '1',
      'merch.details': 'Hoodie, size M',
    });
    expect(location(res)).toBe('/payouts?ok=reward_ordered#rewards');
    const rows = db
      .query<{ kind: string; reward_type: string | null; event_title: string | null; source_event_title: string | null; quantity: number; details: string }, []>(
        'SELECT kind, reward_type, event_title, source_event_title, quantity, details FROM reward_requests ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      { kind: 'ticket', reward_type: null, event_title: 'Winter Opening', source_event_title: 'Warehouse Night', quantity: 1, details: maya.name },
      { kind: 'ticket', reward_type: 'vip_tickets', event_title: 'Warehouse Night', source_event_title: 'Warehouse Night', quantity: 2, details: `${maya.name} + 1 guest: Ana` },
      { kind: 'merch', reward_type: null, event_title: null, source_event_title: null, quantity: 1, details: 'Hoodie, size M' },
    ]);
    // One email to the admins for the whole cart.
    const mail = await waitForSubject(server.adminEmail, `Reward request from ${maya.name} (${maya.email})`);
    expect(mail.Text).toContain('1 free ticket for Winter Opening, rolled over from Warehouse Night; 2 VIP for Warehouse Night; Merch');
    // What was asked for is no longer ready.
    expect(text((await maya.client.page('/payouts')).split('data-name="VIP · Warehouse Night"')[1]!.split('data-shop-item')[0]!)).toContain('All 2 requested.');
  });

  test('a cart with one item too many is refused whole', async () => {
    const before = requests();
    // Winter Opening's free ticket is still ready; VIP are all asked for.
    const res = await order({ 'qty.2.free_tickets': '1', 'qty.1.vip_tickets': '1' });
    expect(res.status).toBe(400);
    expect(text(await res.text())).toContain('That reward is not available any more.');
    expect(requests()).toBe(before);
  });

  test('an empty cart, and merch without its size', async () => {
    const empty = await order({ 'qty.2.free_tickets': '0' });
    expect(empty.status).toBe(400);
    expect(text(await empty.text())).toContain('Your cart is empty');
    await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'merch', quantity: '1', label: 'More' });
    const before = requests();
    expect((await order({ 'qty.merch': '1', 'merch.details': '' })).status).toBe(400);
    expect(requests()).toBe(before);
  });
});
