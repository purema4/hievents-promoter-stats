import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stats, text, uid, type Server } from './harness';

/*
 * A team lead's commission on their promoters' sales. From dev/seed.sql, DJMAX has one $25 sale today
 * and LUNA none; the team lead's own code (NOVA) has no sales.
 */
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const cents = (shown: string | undefined) => Math.round(Number(shown!.replace(/[$,]/g, '')) * 100);

describeIntegration('team commission', () => {
  let server: Server;
  let admin: Client;
  let lead: Awaited<ReturnType<typeof newPromoter>>;
  let ana: Awaited<ReturnType<typeof newPromoter>>;
  let ben: Awaited<ReturnType<typeof newPromoter>>;
  let anaSales: number;
  let benSales: number;

  /** Moves the day they joined back, as if they had been on the team all along. */
  function joinedLongAgo(memberId: number) {
    const db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.query("UPDATE team_memberships SET from_day = '2000-01-01' WHERE member_id = ?").run(memberId);
    db.close();
  }

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    lead = await newPromoter(server, admin, { name: `Lea ${uid()}`, codes: 'NOVA' });
    ana = await newPromoter(server, admin, { name: `Ana ${uid()}`, codes: 'DJMAX' });
    ben = await newPromoter(server, admin, { name: `Ben ${uid()}`, codes: 'LUNA' });
    anaSales = cents(stats(await ana.client.page('/')).get('Ticket sales at full price'));
    benSales = cents(stats(await ben.client.page('/')).get('Ticket sales at full price'));
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '1' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('an admin sets the rate; none until then', async () => {
    await admin.post('/admin/teams/add', { user_id: String(ana.id), team_lead_id: String(lead.id) });
    await admin.post('/admin/teams/add', { user_id: String(ben.id), team_lead_id: String(lead.id) });
    expect(text(await lead.client.page('/team'))).toContain('No team commission is set for you yet');

    expect(location(await admin.post(`/admin/teams/${lead.id}/commission`, { team_commission_percent: '101' }))).toBe('/admin/teams?error=commission');
    expect(location(await admin.post(`/admin/teams/${lead.id}/commission`, { team_commission_percent: '5' }))).toBe('/admin/teams?ok=team_commission');
    expect(await admin.page('/admin/teams')).toContain('name="team_commission_percent" min="0" max="100" step="0.01" value="5"');
    expect(location(await admin.post(`/admin/teams/${lead.id}/commission`, { team_commission_percent: '5', from: 'promoter' }))).toBe(
      `/admin/promoters/${lead.id}?ok=team_commission`,
    );
    // Only for team leads, and only by admins.
    expect((await admin.post(`/admin/teams/${ana.id}/commission`, { team_commission_percent: '5' })).status).toBe(404);
    expect((await lead.client.post(`/admin/teams/${lead.id}/commission`, { team_commission_percent: '50' })).status).toBe(403);
  });

  test('it counts from the day a promoter joins, and only their sales', async () => {
    // Joined today: only today's $25 DJMAX sale.
    const today = await lead.client.page('/team?range=all');
    expect(stats(today).get('Team commission (5% of $25.00)')).toBe('$1.25');

    joinedLongAgo(ana.id);
    joinedLongAgo(ben.id);
    const all = await lead.client.page('/team?range=all');
    const expected = Math.round((anaSales + benSales) * 0.05);
    expect(stats(all).get(`Team commission (5% of ${money(anaSales + benSales)})`)).toBe(money(expected));
    // Team totals include the team lead's own sales (none here), tagged.
    expect(stats(all).get('Sales at full price')).toBe(money(anaSales + benSales));
    expect(all).toContain('<span class="lead-tag">Team lead</span>');
    expect(text(all)).toContain('Your own sales earn your usual commission');
    // The last 7 days count less than all time.
    const week = cents(stats(await lead.client.page('/team?range=7')).get(`Team commission (5% of ${money(25_00)})`) ?? '$0');
    expect(week).toBeLessThanOrEqual(expected);
  });

  test("it goes to the team lead's balance, and can be requested", async () => {
    const expected = Math.round((anaSales + benSales) * 0.05);
    const dashboard = await lead.client.page('/');
    expect(stats(dashboard).get(`Commission earned (10%) · incl. ${money(expected)} team commission`)).toBe(money(expected));
    expect(stats(dashboard).get('Available to request · Request payout')).toBe(money(expected));
    const payouts = text(await lead.client.page('/payouts'));
    expect(payouts).toContain(`Team commission, on your team's sales +${money(expected)}`);
    // The promoters' own balances do not change.
    expect(stats(await ana.client.page('/')).get('Commission earned (10%)')).toBe(money(Math.round(anaSales * 0.1)));

    const res = await lead.client.post('/payouts', { amount: (expected / 100).toFixed(2), currency: 'CAD', method: 'Interac e-Transfer', details: 'lea@example.test' });
    expect(location(res)).toBe('/payouts?ok=requested');
    expect(text(await admin.page(`/admin/promoters/${lead.id}`))).toContain(`incl. ${money(expected)} team commission`);
  });

  test('admins see every team on the dashboard', async () => {
    const expected = Math.round((anaSales + benSales) * 0.05);
    const html = await admin.page('/admin/dashboard?range=all');
    const teams = html.slice(html.indexOf('<h2>Teams</h2>'));
    expect(teams).toContain(`href="/admin/teams/${lead.id}?range=all"`);
    expect(text(teams)).toContain(lead.name);
    expect(text(teams)).toContain(`${money(expected)} 5%`);
    expect(text(html)).toContain(`incl. ${money(expected)} team commission`);
    expect(stats(await admin.page(`/admin/teams/${lead.id}?range=all`)).get(`Team commission (5% of ${money(anaSales + benSales)})`)).toBe(money(expected));
  });

  test('sales outside Hi.Events entered after they joined count too', async () => {
    const before = Math.round((anaSales + benSales) * 0.05);
    const adjust = (body: Record<string, string>) => admin.post(`/admin/promoters/${ana.id}/adjust`, { kind: 'outside_sale', label: 'Door sales', ...body });
    // $20 commission at Ana's 10%: $200 in sales. With the sales given: those.
    expect(location(await adjust({ quantity: '4', amount: '20' }))).toBe(`/admin/promoters/${ana.id}?ok=adjusted#adjust`);
    expect(location(await adjust({ quantity: '2', amount: '', sales: '100' }))).toBe(`/admin/promoters/${ana.id}?ok=adjusted#adjust`);
    expect(location(await adjust({ quantity: '2', amount: '5', sales: 'lots' }))).toBe(`/admin/promoters/${ana.id}?error=adjust_amount#adjust`);
    const base = anaSales + benSales + 300_00;
    const html = await lead.client.page('/team?range=all');
    expect(stats(html).get(`Team commission (5% of ${money(base)})`)).toBe(money(before + 15_00));
    expect(text(await admin.page(`/admin/promoters/${ana.id}`))).toContain('+4 tickets sold ($200.00 in sales)');
    // Ana's own balance gets the commission only.
    expect(stats(await ana.client.page('/')).get('Commission earned (10%) · incl. +$20.00 from the team')).toBe(money(Math.round(anaSales * 0.1) + 20_00));
  });

  test('what was earned stays when a promoter leaves, moves or is deleted', async () => {
    const teamCommission = async () => {
      const html = await lead.client.page('/team?range=all');
      return [...stats(html)].find(([label]) => label.startsWith('Team commission'))![1];
    };
    const expected = cents(await teamCommission());
    // Ana moves to another team: her sales up to today stay with Lea.
    const other = await newPromoter(server, admin, { name: `Max ${uid()}` });
    await admin.post('/admin/teams/lead', { user_id: String(other.id), lead: '1' });
    await admin.post(`/admin/teams/${other.id}/commission`, { team_commission_percent: '5' });
    await admin.post(`/admin/promoters/${ana.id}/team`, { team_lead_id: String(other.id) });
    expect(await teamCommission()).toBe(money(expected));
    // Her new team starts tomorrow, so today's sale is not counted twice.
    expect(stats(await other.client.page('/team?range=all')).get('Team commission (5% of $0.00)')).toBe('$0.00');

    // Ben is deleted: what Lea earned on him stays.
    await admin.post(`/admin/promoters/${ben.id}/delete`, { confirm: '1' });
    expect(await teamCommission()).toBe(money(expected));

    // Ana is deleted too: her sales outside Hi.Events while on Lea's team stay counted.
    await admin.post(`/admin/promoters/${ana.id}/delete`, { confirm: '1' });
    expect(await teamCommission()).toBe(money(expected));

    // Lea steps down: still earned, still in her balance.
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '0' });
    expect(text(await lead.client.page('/payouts'))).toContain(`Team commission, on your team's sales +${money(expected)}`);
  });
});
