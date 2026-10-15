import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, createPromoter, currentStep, describeIntegration, newPromoter, signInAdmin, startServer, stats, text, totp, type Server } from './harness';

// Expected numbers from dev/seed.sql for a promoter with the code DJMAX (also matches "djmax") at 10%,
// with no HIEVENTS_ACCOUNT_IDS filter. Events: 1 Warehouse Night (+17 days), 2 Winter Opening (+60 days,
// two dates), 3 Someone else's event (other account, +37 days), 4 Summer Rooftop (70 days ago).
describeIntegration('sales numbers from the seeded Hi.Events database', () => {
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('dashboard totals', async () => {
    const cards = stats(await promoter.client.page('/'));
    expect(cards.get('Commission earned (10%)')).toBe('$28.50');
    expect(cards.get('Available to request · Request payout')).toBe('$28.50');
    expect(cards.get('Ticket sales at full price')).toBe('$285.00');
    // 10 tickets on 6 completed orders, 1 more awaiting an offline payment.
    expect(cards.get('Tickets sold, 6 orders · 1 awaiting payment')).toBe('10');
  });

  test('the dashboard lists upcoming and past events with their commission', async () => {
    const html = await promoter.client.page('/');
    const page = text(html);
    const upcoming = page.slice(page.indexOf('Upcoming events'), page.indexOf('Past events'));
    const past = page.slice(page.indexOf('Past events'));
    expect(upcoming).toContain('Warehouse Night');
    expect(upcoming).toContain('Winter Opening');
    expect(upcoming).toContain("Someone else's event");
    expect(past).toContain('Summer Rooftop');
    expect(upcoming).not.toContain('Summer Rooftop');
    expect(html).toContain('(2 dates)');
    expect(html).toContain('Bronze'); // 10 tickets
  });

  test('promo codes are one click to copy: on the dashboard, the event cards and the event page', async () => {
    const both = await newPromoter(server, admin, { codes: 'djmax, GHOST' });
    const html = await both.client.page('/');
    const card = html.slice(html.indexOf('class="card codes-card"'), html.indexOf('Tickets sold per day'));
    expect(text(card)).toContain('Your promo codes');
    // Spelled as in Hi.Events, with the upcoming events it works on.
    expect(card).toContain('data-copy-text="DJMAX"');
    expect(text(card)).toContain("Warehouse Night, Someone else's event, Winter Opening");
    expect(card).toContain('data-copy-text="ghost"');
    expect(text(card)).toContain('Not in the ticketing system yet');
    // Upcoming event cards carry a copy button for their code; past ones do not.
    const upcoming = html.slice(html.indexOf('Upcoming events'), html.indexOf('Past events'));
    const past = html.slice(html.indexOf('Past events'));
    // (One seeded event spells it "djmax": each card shows Hi.Events' spelling.)
    expect(upcoming.match(/class="secondary small code-copy" data-copy-text="djmax"/gi)?.length).toBe(3);
    expect(past).not.toContain('code-copy');

    const event = await both.client.page('/events/1');
    expect(text(event)).toContain('Your link and code');
    expect(event).toContain('data-copy-text="DJMAX"');
  });

  test('"Winter Opening": a $10 ticket bought with a 10% code counts at full price', async () => {
    const html = await promoter.client.page('/events/2');
    expect(html).toContain('<h1>Winter Opening</h1>');
    const cards = stats(html);
    expect(cards.get('Commission (10%)')).toBe('$1.00');
    expect(cards.get('Ticket sales at full price')).toBe('$10.00');
    expect(cards.get('Paid by customers after discounts')).toBe('$9.00');
    expect(cards.get('Tickets sold, 1 order')).toBe('1');
  });

  test('"Warehouse Night": a half-refunded order counts 50%, pending and cancelled orders count nothing', async () => {
    const cards = stats(await promoter.client.page('/events/1'));
    expect(cards.get('Ticket sales at full price')).toBe('$100.00');
    expect(cards.get('Commission (10%)')).toBe('$10.00');
    expect(cards.get('Paid by customers after discounts')).toBe('$90.00');
    expect(cards.get('Tickets sold, 3 orders · 1 awaiting payment')).toBe('4');
  });

  test('past event and the other account’s event', async () => {
    const rooftop = stats(await promoter.client.page('/events/4'));
    expect(rooftop.get('Ticket sales at full price')).toBe('$75.00');
    expect(rooftop.get('Commission (10%)')).toBe('$7.50');
    const other = stats(await promoter.client.page('/events/3'));
    expect(other.get('Ticket sales at full price')).toBe('$100.00');
    expect(other.get('Commission (10%)')).toBe('$10.00');
  });

  test('the chart counts completed tickets by the day they were ordered', async () => {
    const chartTotal = (html: string) => html.match(/<h2>Tickets sold per day<\/h2><span class="muted">(\d+) tickets?/)?.[1];
    expect(chartTotal(await promoter.client.page('/?range=all'))).toBe('10');
    // Last 7 days: 1 yesterday (Winter Opening), 2 four days ago (other account), 1 today.
    expect(chartTotal(await promoter.client.page('/?range=7'))).toBe('4');
    // 30 days adds the two orders from 9 and 12 days ago; the 85-day-old one needs 90 days.
    expect(chartTotal(await promoter.client.page('/?range=30'))).toBe('7');
    expect(chartTotal(await promoter.client.page('/?range=90'))).toBe('10');
    // An event page's chart covers that event only.
    expect(chartTotal(await promoter.client.page('/events/1?range=all'))).toBe('4');
  });

  test('a per-promoter rate changes the commission everywhere', async () => {
    const vip = await newPromoter(server, admin, { codes: 'djmax', commission: '12.5' });
    const cards = stats(await vip.client.page('/'));
    // Rounded per code and event: $12.50 + $1.25 + $12.50 + $9.375 → $9.38.
    expect(cards.get('Commission earned (12.5%)')).toBe('$35.63');
    expect(stats(await vip.client.page('/events/2')).get('Commission (12.5%)')).toBe('$1.25');
  });

  test('admins see exactly what the promoter sees', async () => {
    const own = stats(await promoter.client.page('/'));
    const viewed = stats(await admin.page(`/admin/promoters/${promoter.id}/view`));
    expect(viewed.get('Commission earned (10%)')).toBe(own.get('Commission earned (10%)'));
    expect(viewed.get('Ticket sales at full price')).toBe('$285.00');
    const event = stats(await admin.page(`/admin/promoters/${promoter.id}/view/events/2`));
    expect(event.get('Commission (10%)')).toBe('$1.00');
  });

  test('the admin dashboard counts the promoter', async () => {
    const html = await admin.page('/admin/dashboard?range=all');
    expect(html).toContain(promoter.name);
  });

  test('the admin dashboard shows when promoters were last active and signed in, the app and two-step', async () => {
    const never = await createPromoter(admin, { codes: 'DJMAX' });
    const active = await newPromoter(server, admin, { codes: 'DJMAX' });
    expect((await active.client.post('/account/app-installed')).status).toBeLessThan(400);
    await active.client.post('/account/security/2fa/start');
    const secret = (await active.client.page('/account/security?setup=1')).match(/<p class="secret">([A-Z2-7 ]+)<\/p>/)![1]!.replace(/ /g, '');
    expect((await active.client.post('/account/security/2fa/confirm', { code: totp(secret, currentStep()) })).status).toBe(200);

    const page = text(await admin.page('/admin/dashboard'));
    const activity = page.slice(page.indexOf('Promoter activity'));
    expect(activity).toMatch(/\d+ of \d+ installed the app · \d+ of \d+ use two-step verification/);
    expect(activity).toContain(`${active.name} Active now Just now Installed On`);
    expect(activity).toContain(`${never.name} Never Never No Off`);
    // Admins are not listed.
    expect(activity).not.toContain('Admin');
  });

  test('event covers are fetched from HIEVENTS_IMAGE_BASE_URL and passed on', async () => {
    const res = await promoter.client.get('/event-image/1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    const expected = readFileSync(join(import.meta.dir, '../../dev/covers/event_cover/warehouse.png'));
    expect(Buffer.from(await res.arrayBuffer()).equals(expected)).toBe(true);
    // No cover: a blank image, never a broken one.
    const none = await promoter.client.get('/event-image/3');
    expect(none.status).toBe(200);
    expect(none.headers.get('cache-control')).toBe('private, max-age=300');
    expect((await none.arrayBuffer()).byteLength).toBeLessThan(200);
    expect(await promoter.client.page('/')).toContain('src="/event-image/1"');
  });
});

describeIntegration('HIEVENTS_ACCOUNT_IDS', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer({ HIEVENTS_ACCOUNT_IDS: '1' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('only shows events from the listed accounts', async () => {
    const admin = await signInAdmin(server);
    const promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
    const cards = stats(await promoter.client.page('/'));
    // Without "Someone else's event" (2 tickets, $100 full price).
    expect(cards.get('Ticket sales at full price')).toBe('$185.00');
    expect(cards.get('Commission earned (10%)')).toBe('$18.50');
    expect((await promoter.client.get('/events/3')).status).toBe(404);
  });
});
