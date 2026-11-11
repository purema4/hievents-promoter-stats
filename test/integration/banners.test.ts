import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Banners from Promoters → Banners. From dev/seed.sql: DJMAX is on Warehouse Night (event 1, upcoming),
 * Winter Opening (event 2, upcoming) and Summer Rooftop (event 4, over); LUNA only on event 1.
 */
describeIntegration('banners', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let luna: Awaited<ReturnType<typeof newPromoter>>;

  const general = (message: string) => admin.post('/admin/banners/general', { message });
  const event = (eventId: number, message: string) => admin.post('/admin/banners/event', { event_id: String(eventId), message });

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    luna = await newPromoter(server, admin, { name: `Luna ${uid()}`, codes: 'LUNA' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('no banner until an admin writes one', async () => {
    expect(await admin.page('/admin')).toContain('<a href="/admin/banners">Banners</a>');
    expect(await maya.client.page('/')).not.toContain('class="banner"');
  });

  test('the general banner: on promoter pages, first thing under the menu, not on admin pages', async () => {
    expect(location(await general('Payouts go out Friday.'))).toBe('/admin/banners?ok=banner_saved#general');
    for (const path of ['/', '/events/1', '/payouts', '/account']) {
      const html = await maya.client.page(path);
      expect(html.slice(html.indexOf('<main id="main"'), html.indexOf('<main id="main"') + 60)).toContain('class="banner"');
      expect(text(html)).toContain('Payouts go out Friday.');
    }
    expect(text(await admin.page('/admin/dashboard'))).not.toContain('Payouts go out Friday.');
    // Except where the admin is looking at what a promoter sees.
    expect(text(await admin.page(`/admin/promoters/${maya.id}/view`))).toContain('Payouts go out Friday.');
    expect(await admin.page('/admin/banners')).toContain('Payouts go out Friday.');
  });

  test('an event banner: only for that event and its promoters, on the card and the event page', async () => {
    expect(location(await event(2, 'Doors at 9 pm.'))).toBe('/admin/banners?ok=banner_saved#event-2');
    const dashboard = await maya.client.page('/');
    const cards = dashboard.split('class="card event-card"');
    expect(text(cards.find((c) => c.includes('Winter Opening'))!)).toContain('Doors at 9 pm.');
    expect(text(cards.find((c) => c.includes('Warehouse Night'))!)).not.toContain('Doors at 9 pm.');
    expect(text(await maya.client.page('/events/2'))).toContain('Doors at 9 pm.');
    expect(text(await maya.client.page('/events/1'))).not.toContain('Doors at 9 pm.');
    expect(text(await luna.client.page('/'))).not.toContain('Doors at 9 pm.');
  });

  test('saving empty removes a banner', async () => {
    expect(location(await general(''))).toBe('/admin/banners?ok=banner_removed#general');
    expect(location(await event(2, '   '))).toBe('/admin/banners?ok=banner_removed#event-2');
    expect(await maya.client.page('/')).not.toContain('class="banner"');
    expect(await maya.client.page('/events/2')).not.toContain('class="banner"');
  });

  test('text is escaped and cut to the limit; events that are over are refused', async () => {
    await general('<script>alert(1)</script>');
    const html = await maya.client.page('/');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)');
    await general('x'.repeat(600));
    expect(await maya.client.page('/')).toContain(`<p>${'x'.repeat(500)}</p>`);
    await general('');
    const refused = location(await event(4, 'Too late'));
    expect(refused).toContain('error=media_event');
    expect(await maya.client.page('/events/4')).not.toContain('Too late');
    expect(location(await event(999999, 'Nope'))).toContain('error=media_event');
  });

  test('promoters cannot change banners', async () => {
    const res = await maya.client.post('/admin/banners/general', { message: 'Hacked' });
    expect(res.status).toBe(403);
    expect(await maya.client.page('/')).not.toContain('Hacked');
  });
});

describeIntegration('event cards', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('upcoming events come first, each with its own tickets and chart', async () => {
    const html = await maya.client.page('/');
    expect(html).not.toContain('Tickets sold per day');
    expect(html.indexOf('Upcoming events')).toBeLessThan(html.indexOf('My totals'));
    expect(html.indexOf('My totals')).toBeLessThan(html.indexOf('Past events'));
    const cards = html.split('class="card event-card"').slice(1);
    const upcoming = cards.filter((c) => c.includes('mini-chart'));
    expect(upcoming.length).toBeGreaterThan(0);
    for (const card of upcoming) expect(text(card)).toMatch(/\d+ tickets? sold/);
    const past = cards.find((c) => c.includes('Summer Rooftop'))!;
    expect(text(past)).toMatch(/\d+ tickets? sold/);
    expect(past).not.toContain('mini-chart');
  });
});
