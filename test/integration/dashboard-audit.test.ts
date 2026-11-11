import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, newPromoter, signInAdmin, startServer, text, type Server } from './harness';

/*
 * From the UX audit of the promoter dashboard: every request link goes to the one checkout, a new
 * promoter without a code is told what happens next, and keyboard users can skip the menu. (The page
 * shown when a page fails to load needs the ticketing database to fail after startup, which this stack
 * cannot do; it is checked by hand.)
 */
describeIntegration('the promoter dashboard', () => {
  let server: Server;
  let admin: Client;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('request links lead to checkout, and the page says how fresh it is', async () => {
    const p = await newPromoter(server, admin, { codes: 'DJMAX' });
    const html = await p.client.page('/');
    const totals = html.slice(html.indexOf('class="grid"'));
    expect(totals).toContain('<a href="/rewards/checkout">Request payout</a>');
    expect(html).toContain('<a href="/rewards/checkout">Request your rewards →</a>');
    expect(html).not.toContain('href="/payouts#request"');
    expect(text(html)).toMatch(/Live from the ticketing system\. Updated at \d{1,2}:\d{2}/);
  });

  test('keyboard users can skip the menu', async () => {
    const p = await newPromoter(server, admin);
    const html = await p.client.page('/');
    expect(html.indexOf('<a class="skip-link" href="#main">Skip to content</a>')).toBeLessThan(html.indexOf('id="sidebar"'));
    expect(html).toContain('<main id="main" tabindex="-1">');
  });

  test('without a code: what happens next, not just "nothing"', async () => {
    const p = await newPromoter(server, admin, { codes: '' });
    const words = text(await p.client.page('/'));
    expect(words).toContain('No promo code yet');
    expect(words).toContain('As soon as yours is added');
  });
});
