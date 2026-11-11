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
    // The server writes too (notifications, milestones…): wait for it rather than fail with SQLITE_BUSY.
    db.exec('PRAGMA busy_timeout = 5000');
    db.query("INSERT INTO reward_types (key, label_en, label_fr) VALUES ('vip_tickets', 'VIP', 'VIP'), ('ga_list', 'GA list', 'Liste GA')").run();
    db.query("INSERT INTO rule_versions (scope, event_id, text) VALUES ('event', 1, ?)").run('vip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list = floor(tickets_sold / 5)');
    // One merch item, given by hand.
    await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'merch', quantity: '1', label: 'Street team' });
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
  });

  test('rewards by event: what each one is, how many are available, and what comes next', async () => {
    const page = await maya.client.page('/payouts');
    expect(text(page)).toContain('Rewards shop');
    const card = (name: string) => text(page.slice(page.indexOf(`data-name="${name}"`)).split('data-shop-item')[0]!);
    expect(card('VIP · Warehouse Night')).toMatch(/2 available/);
    expect(card('Free ticket · Warehouse Night')).toMatch(/1 available/);
    expect(card('Free ticket · Winter Opening')).toMatch(/1 available/);
    // Nothing ready yet: shown, with how far to go.
    expect(card('GA list · Warehouse Night')).toMatch(/0 available/);
    expect(card('GA list · Warehouse Night')).toContain('1 more sale for the next one');
    expect(card('Merch')).toMatch(/1 available/);
    expect(page).toContain('action="/rewards/order"');
    expect(text(page)).toContain('Your cart');
  });

  test('a whole cart in one request: tickets sent to the promoter, into the bank, and merch', async () => {
    const page = await maya.client.page('/payouts');
    // Tickets go to the promoter, who hands them out: no "for me", no guest names.
    expect(page).not.toContain('name="me.');
    expect(page).not.toContain('name="guests.1.vip_tickets"');
    const res = await order({
      'qty.1.vip_tickets': '2',
      'qty.1.free_tickets': '1',
      'for.1.free_tickets': 'bank',
      'qty.merch': '1',
      'merch.details': 'Hoodie, size M',
    });
    expect(location(res)).toBe('/payouts?ok=reward_ordered#rewards');
    // The confirmation shows in the rewards shop, where that link lands, not at the top of the page.
    const done = await maya.client.page('/payouts?ok=reward_ordered');
    const confirmation = 'Sent to the team. You will hear back here and by email.';
    expect(text(done.split('id="rewards"')[1]!.split('class="shop"')[0]!)).toContain(confirmation);
    expect(text(done.split('id="rewards"')[0]!)).not.toContain(confirmation);
    const rows = db
      .query<{ kind: string; reward_type: string | null; event_title: string | null; source_event_title: string | null; quantity: number; details: string }, []>(
        'SELECT kind, reward_type, event_title, source_event_title, quantity, details FROM reward_requests ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      { kind: 'ticket', reward_type: null, event_title: null, source_event_title: 'Warehouse Night', quantity: 1, details: maya.name },
      { kind: 'ticket', reward_type: 'vip_tickets', event_title: 'Warehouse Night', source_event_title: 'Warehouse Night', quantity: 2, details: maya.name },
      { kind: 'merch', reward_type: null, event_title: null, source_event_title: null, quantity: 1, details: 'Hoodie, size M' },
    ]);
    // One email to the admins for the whole cart.
    const mail = await waitForSubject(server.adminEmail, `Reward request from ${maya.name} (${maya.email})`);
    expect(mail.Text).toContain('1 free ticket into the bank, from Warehouse Night; 2 VIP for Warehouse Night; Merch');
    // What was asked for is no longer ready.
    expect(text((await maya.client.page('/payouts')).split('data-name="VIP · Warehouse Night"')[1]!.split('data-shop-item')[0]!)).toContain('All 2 requested');
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

  test('the bank: accepted by the team, kept with its type, used on any upcoming event', async () => {
    const queue = await admin.page('/admin/payouts');
    expect(text(queue)).toContain('1 free ticket into the bank, from Warehouse Night');
    // Waiting for the team: shown, not usable yet.
    let page = await maya.client.page('/payouts');
    expect(text(page)).toContain('1 more waiting for the team to bank');
    expect(page).not.toContain('name="qty.bank.free_tickets"');

    const id = queue.match(/1 free ticket into the bank[\s\S]*?action="\/admin\/rewards\/(\d+)\/fulfil"/)![1]!;
    expect(location(await admin.post(`/admin/rewards/${id}/fulfil`, { admin_note: '' }))).toBe('/admin/payouts?ok=reward_fulfilled');
    page = await maya.client.page('/payouts');
    expect(text(page.slice(page.indexOf('data-name="Free ticket · your bank"')).split('data-shop-item')[0]!)).toMatch(/1 available/);

    // Too many out of the bank: refused, nothing saved.
    const before = requests();
    expect((await order({ 'qty.bank.free_tickets': '2', 'event.bank.free_tickets': '2' })).status).toBe(400);
    expect(requests()).toBe(before);
    // Used for Winter Opening: still a free ticket.
    expect(location(await order({ 'qty.bank.free_tickets': '1', 'event.bank.free_tickets': '2' }))).toBe('/payouts?ok=reward_ordered#rewards');
    expect(text(await admin.page('/admin/payouts'))).toContain('1 free ticket for Winter Opening, from the bank');
    expect(await maya.client.page('/payouts')).not.toContain('name="qty.bank.free_tickets"');
    // An event that is over, or no event at all, cannot take banked rewards.
    db.query("INSERT INTO reward_requests (user_id, promoter_name, promoter_email, kind, event_id, source_event_id, source_event_title, quantity, reward_type, reward_label, status) VALUES (?, 'x', 'x', 'ticket', NULL, 1, 'Warehouse Night', 1, 'ga_list', 'GA list', 'fulfilled')").run(maya.id);
    expect((await order({ 'qty.bank.ga_list': '1', 'event.bank.ga_list': '4' })).status).toBe(400);
    const banked = await maya.client.page('/payouts');
    expect(text(banked.slice(banked.indexOf('data-name="GA list · your bank"')).split('data-shop-item')[0]!)).toMatch(/1 available/);
  });

  test('a bank request the team declines goes back to its event', async () => {
    // Winter Opening's free ticket, asked for the bank, then declined.
    expect(location(await order({ 'qty.2.free_tickets': '1', 'for.2.free_tickets': 'bank' }))).toBe('/payouts?ok=reward_ordered#rewards');
    const queue = await admin.page('/admin/payouts');
    const id = queue.match(/1 free ticket into the bank, from Winter Opening[\s\S]*?action="\/admin\/rewards\/(\d+)\/reject"/)![1]!;
    await admin.post(`/admin/rewards/${id}/reject`, { admin_note: 'Use it on Winter Opening' });
    const page = await maya.client.page('/payouts');
    expect(text(page.slice(page.indexOf('data-name="Free ticket · Winter Opening"')).split('data-shop-item')[0]!)).toMatch(/1 available/);
  });

  test('checkout spells out every line, and the team\'s note must be accepted before sending', async () => {
    // Clear names and what each one is, set by the admins.
    expect(location(await admin.post('/admin/rules/types', { key: 'vip_tickets', label_en: 'VIP ticket', label_fr: 'Billet VIP', description_en: 'Skip the line and get into the VIP area.' }))).toContain('ok=reward_type_saved');
    expect(location(await admin.post('/admin/banners/checkout', { message: 'Tickets are under your name at the door: bring ID.' }))).toBe('/admin/banners?ok=banner_saved#checkout');
    // Two more VIP to ask for.
    await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'free_tickets', event_id: '1', reward_type: 'vip_tickets', quantity: '2', label: 'Thanks' });
    const shop = await maya.client.page('/payouts');
    const card = text(shop.slice(shop.indexOf('data-name="VIP ticket · Warehouse Night"')).split('data-shop-item')[0]!);
    expect(card).toContain('VIP ticket');
    expect(card).toContain('Skip the line and get into the VIP area.');
    expect(card).toMatch(/2 available/);
    // "+" says exactly what it adds; the tickets are sent to the promoter.
    expect(shop).toContain('aria-label="Add one VIP ticket for Warehouse Night"');
    expect(shop).toContain(`data-promoter="${maya.name}"`);
    expect(shop).toContain('formaction="/rewards/checkout"');

    const cart = { 'qty.1.vip_tickets': '2' };
    const res = await maya.client.post('/rewards/checkout', cart);
    expect(res.status).toBe(200);
    const page = await res.text();
    const words = text(page);
    expect(words).toContain('Check your request');
    expect(words).toContain('2 × VIP ticket');
    expect(words).toContain('Skip the line and get into the VIP area.');
    expect(words).toContain('Warehouse Night');
    expect(words).toContain(`Sent to you (${maya.name})`);
    expect(page).toContain('<dialog class="notice-modal"');
    expect(words).toContain('Tickets are under your name at the door: bring ID.');
    expect(page).toContain('<input type="hidden" name="qty.1.vip_tickets" value="2"/>');
    // Nothing sent yet.
    const before = requests();
    expect(requests()).toBe(before);
    // Without "I understand": refused, nothing sent.
    const unread = await order(cart);
    expect(unread.status).toBe(400);
    expect(text(await unread.text())).toContain('tick “I understand” first');
    expect(requests()).toBe(before);
    expect(location(await order({ ...cart, ack: '1' }))).toBe('/payouts?ok=reward_ordered#rewards');
    expect(requests()).toBe(before + 1);
    expect(text(await admin.page('/admin/payouts'))).toContain('2 VIP ticket for Warehouse Night');
    await admin.post('/admin/banners/checkout', { message: '' });
  });

  test('a guest list reward asks for the names; the others do not', async () => {
    expect(location(await admin.post('/admin/rules/types', { key: 'ga_list', label_en: 'GA list', label_fr: 'Liste GA', guest_list: '1' }))).toContain('ok=reward_type_saved');
    expect(text(await admin.page('/admin/rules'))).toContain('Yes: asks for names');
    await admin.post(`/admin/promoters/${maya.id}/adjust`, { kind: 'free_tickets', event_id: '1', reward_type: 'ga_list', quantity: '2', label: 'Crew' });
    const shop = await maya.client.page('/payouts');
    expect(shop).toContain('name="guests.1.ga_list"');
    // Without names: refused, at checkout and on sending.
    const before = requests();
    for (const path of ['/rewards/checkout', '/rewards/order']) {
      const res = await maya.client.post(path, { 'qty.1.ga_list': '1', ack: '1' });
      expect(res.status).toBe(400);
      expect(text(await res.text())).toContain('Add the names for the guest list.');
    }
    expect(requests()).toBe(before);
    const checkout = text(await (await maya.client.post('/rewards/checkout', { 'qty.1.ga_list': '1', 'guests.1.ga_list': 'Ana Roy' })).text());
    expect(checkout).toContain('On the guest list: Ana Roy');
    expect(location(await order({ 'qty.1.ga_list': '1', 'guests.1.ga_list': 'Ana Roy' }))).toBe('/payouts?ok=reward_ordered#rewards');
    expect(db.query<{ details: string }, []>('SELECT details FROM reward_requests ORDER BY id DESC LIMIT 1').get()!.details).toBe('Guest list: Ana Roy');
  });

  test('checkout refuses a cart that would not go through', async () => {
    const res = await maya.client.post('/rewards/checkout', { 'qty.1.vip_tickets': '5' });
    expect(res.status).toBe(400);
    expect(text(await res.text())).toContain('That reward is not available any more.');
  });
});
