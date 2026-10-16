import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, type Server } from './harness';

/* Without PAYOUT_METHODS, payouts are by Interac e-Transfer only; the choice stays a dropdown. */
describeIntegration('payout methods by default', () => {
  let server: Server;
  let admin: Client;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('e-Transfer is the only choice, and cash is refused', async () => {
    const p = await newPromoter(server, admin);
    const html = await p.client.page('/payouts');
    const select = html.slice(html.indexOf('<select name="method"'), html.indexOf('</select>', html.indexOf('<select name="method"')));
    expect([...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual(['Interac e-Transfer']);
    expect(text(html)).not.toContain('Cash');
    expect(text(html)).not.toContain('cash');
    for (const path of ['/account', '/welcome?step=2']) expect(text(await p.client.page(path))).not.toContain('Cash');

    const res = await p.client.post('/payouts', { currency: 'CAD', amount: '0', method: 'Cash', details: '', note: '' });
    expect(res.status).toBe(400);
    expect(location(await p.client.post('/payouts', { currency: 'CAD', amount: '10', method: 'Interac e-Transfer', details: 'p@example.test', note: '' }))).toBe(
      '/payouts?ok=requested',
    );
  });

  test('a promoter who chose cash before gets e-Transfer', async () => {
    const p = await newPromoter(server, admin);
    // Saved while cash was offered.
    const db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.query("UPDATE users SET payout_method = 'Cash' WHERE id = ?").run(p.id);
    db.close();
    // The amount is their whole balance, not rounded down to cash steps ($0 here).
    const html = await p.client.page('/payouts');
    expect(html).toContain('name="amount" inputmode="decimal" value="28.50"');
    expect(html).toContain('<option value="Interac e-Transfer">Interac e-Transfer</option>');
    const res = await p.client.post('/payouts', { currency: 'CAD', amount: '50', method: 'Cash', details: '', note: '' });
    expect(text(await res.text())).toContain('Choose how we should pay you.');
  });
});
