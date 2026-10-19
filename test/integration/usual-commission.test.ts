import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, signInAdmin, signInPromoter, startServer, stats, text, uid, type Server } from './harness';

/*
 * A promoter's usual commission, set when they are added: the default percentage, another percentage, or a
 * flat amount per ticket. From dev/seed.sql, DJMAX has sold 10 tickets: 4 on Warehouse Night (event 1, $100
 * at full price), 1 on Winter Opening, 2 on another account's event and 3 on Summer Rooftop.
 */
describeIntegration('usual commission: percentage or flat per ticket', () => {
  let server: Server;
  let admin: Client;
  let id: number;
  let client: Client;
  const name = `Flat ${uid()}`;
  const email = `flat-${uid()}@example.test`;

  const earned = async () => [...stats(await client.page('/'))].find(([label]) => label.startsWith('Commission earned'))?.[1];
  const edit = (fields: Record<string, string>) =>
    admin.post(`/admin/promoters/${id}`, { name, email, alias: `flat-${id}`, codes: 'DJMAX', ...fields });

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('the add form offers the default, a percentage or CAD per ticket', async () => {
    const html = await admin.page('/admin');
    expect(html).toContain('name="commission_kind"');
    expect(text(html)).toContain('Default (10% of sales)');
    expect(text(html)).toContain('CAD per ticket');
  });

  test('a promoter added with a flat amount per ticket', async () => {
    const res = await admin.post('/admin/promoters', { name, email, codes: 'DJMAX', commission_kind: 'flat', commission_value: '2', invite: '0' });
    id = Number(location(res)?.match(/^\/admin\/promoters\/(\d+)\?ok=created$/)?.[1]);
    expect(id).toBeGreaterThan(0);
    client = await signInPromoter(server, admin, { id, email, name });
    // 10 tickets × $2, not 10% of the sales, and nothing on top.
    expect(await earned()).toBe('$20.00');
    expect(stats(await client.page('/events/1')).get('Commission')).toBe('$8.00');
    // Admins see the rate; the promoter does not.
    const list = await admin.page('/admin');
    const row = list.slice(list.indexOf(name), list.indexOf('</tr>', list.indexOf(name)));
    expect(text(row)).toContain('$2.00 per ticket');
    expect(text(await client.page('/'))).not.toMatch(/per ticket|[0-9]%/);
    // The edit form shows it.
    const page = await admin.page(`/admin/promoters/${id}`);
    expect(page).toMatch(/<option value="flat" selected/);
    expect(page).toContain('value="2.00"');
    expect(text(await admin.page('/admin/commissions'))).toContain('Usual rate, $2.00 per ticket');
  });

  test('an event rate still replaces it on its event', async () => {
    await admin.post('/admin/commissions', { user_id: String(id), event_id: '1', kind: 'percent', value: '10' });
    // Event 1: 10% of $100 = $10 instead of 4 × $2; the other 6 tickets at $2.
    expect(await earned()).toBe('$22.00');
    await admin.post('/admin/commissions', { user_id: String(id), event_id: '1', kind: 'usual', value: '' });
    expect(await earned()).toBe('$20.00');
  });

  test('sales outside Hi.Events earn the flat amount per ticket', async () => {
    const res = await admin.post(`/admin/promoters/${id}/adjust`, { kind: 'outside_sale', quantity: '5', sales: '400', label: 'Door sales' });
    expect(location(res)).toBe(`/admin/promoters/${id}?ok=adjusted#adjust`);
    // 5 × $2 = $10, not 10% of $400.
    expect(stats(await client.page('/')).get('Commission earned · incl. +$10.00 from the team')).toBe('$30.00');
    expect(text(await client.page('/payouts'))).toContain('Door sales (commission)');
  });

  test('switched to a percentage, then back to the default', async () => {
    expect(location(await edit({ commission_kind: 'percent', commission_value: '12.5' }))).toBe(`/admin/promoters/${id}?ok=saved`);
    expect(text(await admin.page('/admin/commissions'))).toContain('Usual rate, 12.5%');
    expect(location(await edit({ commission_kind: 'default', commission_value: '' }))).toBe(`/admin/promoters/${id}?ok=saved`);
    expect(text(await admin.page('/admin/commissions'))).toContain('Usual rate, 10%');
  });

  test('what is refused', async () => {
    const err = async (fields: Record<string, string>) => new URL(location(await edit(fields))!, server.url).searchParams.get('error');
    expect(await err({ commission_kind: 'percent', commission_value: '150' })).toBe('commission');
    expect(await err({ commission_kind: 'percent', commission_value: '' })).toBe('commission');
    expect(await err({ commission_kind: 'flat', commission_value: '-2' })).toBe('commission');
    expect(await err({ commission_kind: 'flat', commission_value: 'abc' })).toBe('commission');
    expect(await err({ commission_kind: 'flat', commission_value: '20000' })).toBe('commission');
    expect(await err({ commission_kind: 'other', commission_value: '5' })).toBe('commission');
    const add = await admin.post('/admin/promoters', { name: 'X', email: `x-${uid()}@example.test`, commission_kind: 'flat', commission_value: '1.234' });
    expect(location(add)).toBe('/admin?error=commission');
  });
});
