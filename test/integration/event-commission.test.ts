import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stats, text, uid, type Server } from './harness';

/*
 * Commission per promoter and event, from Promoters → Commissions. From dev/seed.sql, DJMAX at 10%:
 * Warehouse Night (event 1, upcoming) 4 tickets for $100 at full price ($10), Winter Opening (event 2,
 * upcoming) 1 ticket for $10 ($1), another account's event (3, upcoming) 2 tickets ($10), and Summer
 * Rooftop (event 4, over) 3 tickets ($7.50): $28.50 in all.
 */
describeIntegration('commission per event', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let luna: Awaited<ReturnType<typeof newPromoter>>;

  const set = (userId: number, eventId: number, kind: string, value = '') =>
    admin.post('/admin/commissions', { user_id: String(userId), event_id: String(eventId), kind, value });
  const earned = async () => {
    const html = await maya.client.page('/');
    return [...stats(html)].find(([label]) => label.startsWith('Commission earned'));
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    luna = await newPromoter(server, admin, { name: `Luna ${uid()}`, codes: 'LUNA' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('admins see the events that are not over, with their promoters', async () => {
    expect(await admin.page('/admin')).toContain('<a href="/admin/commissions">Commissions</a>');
    const html = await admin.page('/admin/commissions');
    const card = (id: number) => {
      const start = html.indexOf(`id="event-${id}"`);
      return start < 0 ? '' : html.slice(start, html.indexOf('class="card rate-card"', start + 1) >>> 0);
    };
    expect(text(card(1))).toContain('Warehouse Night');
    expect(text(card(1))).toContain(maya.name);
    expect(text(card(1))).toContain(luna.name);
    expect(text(card(1))).toContain('Usual rate, 10%');
    expect(text(card(2))).toContain(maya.name);
    expect(text(card(2))).not.toContain(luna.name);
    // Over: not listed.
    expect(card(4)).toBe('');
    expect(text(html)).not.toContain('Summer Rooftop');
    expect(await earned()).toEqual(['Commission earned (10%)', '$28.50']);
  });

  test('a flat amount per ticket on one event', async () => {
    expect(location(await set(maya.id, 1, 'flat', '3'))).toBe('/admin/commissions?ok=rate_saved#event-1');
    // 4 tickets × $3 = $12 instead of $10.
    expect(await earned()).toEqual(['Commission earned (10%, other rates on some events)', '$30.50']);
    const event = await maya.client.page('/events/1');
    expect(stats(event).get('Commission ($3.00 per ticket)')).toBe('$12.00');
    expect(stats(await maya.client.page('/events/2')).get('Commission (10%)')).toBe('$1.00');
    expect(text(await admin.page('/admin/commissions'))).toContain('$3.00 per ticket');
    // Luna on the same event keeps her usual rate.
    expect(stats(await luna.client.page('/')).get('Commission earned (10%)')).toBe('$2.50');
  });

  test('another percentage on another event', async () => {
    expect(location(await set(maya.id, 2, 'percent', '50'))).toBe('/admin/commissions?ok=rate_saved#event-2');
    // $10 × 50% = $5 instead of $1.
    expect(await earned()).toEqual(['Commission earned (10%, other rates on some events)', '$34.50']);
    expect(stats(await maya.client.page('/events/2')).get('Commission (50%)')).toBe('$5.00');
  });

  test('the same numbers everywhere: payouts, the chart, the admin dashboard', async () => {
    expect(text(await maya.client.page('/payouts'))).toContain('Available to request $34.50');
    const dashboard = await admin.page('/admin/dashboard?range=all');
    const row = dashboard.slice(dashboard.indexOf(maya.name));
    expect(text(row.slice(0, row.indexOf('</tr>')))).toContain('$34.50');
    // The chart's days add up to the same commission (the last 90 days hold every sale but Summer Rooftop's).
    const chart = await maya.client.page('/?range=90');
    const days = [...chart.matchAll(/<td class="num">\$([0-9.]+)<\/td><\/tr>/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(days.toFixed(2)).toBe('34.50');
  });

  test('back to the usual rate', async () => {
    await set(maya.id, 1, 'usual');
    await set(maya.id, 2, 'usual');
    expect(await earned()).toEqual(['Commission earned (10%)', '$28.50']);
  });

  test('what is refused', async () => {
    const err = async (res: Response) => new URL(location(res)!, server.url).searchParams.get('error');
    expect(await err(await set(maya.id, 1, 'percent', '150'))).toBe('rate_percent');
    expect(await err(await set(maya.id, 1, 'flat', 'abc'))).toBe('rate_flat');
    expect(await err(await set(maya.id, 1, 'flat', '-2'))).toBe('rate_flat');
    expect(await err(await set(maya.id, 1, 'other', '5'))).toBe('rate_event');
    // An event that is over, one they have no code on, and an unknown promoter.
    expect(await err(await set(maya.id, 4, 'flat', '5'))).toBe('rate_event');
    expect(await err(await set(luna.id, 2, 'flat', '5'))).toBe('rate_event');
    expect(await err(await set(999999, 1, 'flat', '5'))).toBe('rate_event');
    expect(await earned()).toEqual(['Commission earned (10%)', '$28.50']);
    // Admins only.
    expect((await maya.client.post('/admin/commissions', { user_id: String(maya.id), event_id: '1', kind: 'flat', value: '100' })).status).toBe(403);
    expect((await maya.client.get('/admin/commissions')).status).toBe(403);
  });
});
