import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stats, text, uid, type Server } from './harness';

/*
 * Teams: an admin makes a promoter a team lead and puts promoters on their team. From dev/seed.sql,
 * DJMAX has sold 10 tickets in all and LUNA 1.
 */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function uploadPhoto(client: Client) {
  const account = await client.page('/account');
  const form = new FormData();
  form.set('alias', account.match(/name="alias" value="([^"]+)"/)![1]!);
  form.set('theme', 'system');
  form.set('photo', new File([png], 'me.png', { type: 'image/png' }));
  expect(location(await client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
}

describeIntegration('teams', () => {
  let server: Server;
  let admin: Client;
  let lead: Awaited<ReturnType<typeof newPromoter>>;
  let ana: Awaited<ReturnType<typeof newPromoter>>;
  let ben: Awaited<ReturnType<typeof newPromoter>>;
  let outsider: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    lead = await newPromoter(server, admin, { name: `Lea ${uid()}`, codes: 'NOVA' });
    ana = await newPromoter(server, admin, { name: `Ana ${uid()}`, codes: 'DJMAX' });
    ben = await newPromoter(server, admin, { name: `Ben ${uid()}`, codes: 'LUNA' });
    outsider = await newPromoter(server, admin, { name: `Oz ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('an admin makes a team lead and builds their team', async () => {
    expect((await lead.client.get('/team')).status).toBe(403);
    expect(await lead.client.page('/')).not.toContain('href="/team"');

    expect(location(await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '1' }))).toBe('/admin/teams?ok=team_lead_on');
    expect(location(await admin.post('/admin/teams/add', { user_id: String(ana.id), team_lead_id: String(lead.id) }))).toBe(
      '/admin/teams?ok=team_saved',
    );
    // Also from the promoter's own admin page.
    expect(location(await admin.post(`/admin/promoters/${ben.id}/team`, { team_lead_id: String(lead.id) }))).toBe(
      `/admin/promoters/${ben.id}?ok=team_saved`,
    );

    const teams = text(await admin.page('/admin/teams'));
    expect(teams).toContain(lead.name);
    expect(teams).toContain(ana.name);
    expect(teams).toContain(ben.name);
    expect(teams).toContain(`Not on a team: `);
    const list = text(await admin.page('/admin'));
    expect(list).toContain(`${lead.name} (team lead)`);
    expect(list).toContain(`${lead.name}'s team`);
    expect(await admin.page(`/admin/promoters/${ana.id}`)).toContain(`<option value="${lead.id}" selected="">`);

    // Everyone involved is told.
    expect(text(await lead.client.page('/notifications'))).toContain('You are a team lead');
    expect(text(await ana.client.page('/notifications'))).toContain(`${lead.name} is your team lead and can now see your sales. Your team's tickets and sales are under My team.`);
    expect(await lead.client.page('/')).toContain('<a href="/team">My team</a>');
  });

  test("the team lead sees their team's sales, and only theirs", async () => {
    // All time by default, like dashboards.
    const plain = await lead.client.page('/team');
    expect(plain).toContain('href="/team?range=all" aria-current="true"');
    expect(stats(plain).get('Tickets sold by the team')).toBe('11');
    const html = await lead.client.page('/team?range=all');
    expect(stats(html).get('Tickets sold by the team')).toBe('11');
    expect(stats(html).get('Promoters on the team')).toBe('2');
    expect(html).toContain(`href="/team/${ana.id}"`);
    expect(html).toContain(`href="/team/${ben.id}"`);
    expect(text(html)).not.toContain(outsider.name);
    expect(text(html)).not.toContain('Owed');

    const member = await lead.client.page(`/team/${ana.id}`);
    expect(text(member)).toContain(`My team / ${ana.name}`);
    expect(stats(member).get('Tickets sold, 6 orders · 1 awaiting payment')).toBe('10');
    // Nothing to act on for them.
    const main = member.slice(member.indexOf('<main>'));
    expect(main).not.toContain('href="/payouts');
    expect(main).not.toContain('payout-callout');
    expect((await lead.client.get(`/team/${ana.id}/events/1`)).status).toBe(200);

    for (const path of [`/team/${outsider.id}`, `/team/${outsider.id}/events/1`, `/team/${lead.id}`, '/team/x', `/team/${ana.id}/events/999`]) {
      expect((await lead.client.get(path)).status).toBe(404);
    }
  });

  test("their team's photos, but no one else's", async () => {
    await uploadPhoto(ana.client);
    await uploadPhoto(outsider.client);
    expect((await lead.client.get(`/avatar/${ana.id}`)).status).toBe(200);
    expect((await lead.client.get(`/avatar/${outsider.id}`)).status).toBe(404);
    expect((await ana.client.get(`/avatar/${outsider.id}`)).status).toBe(404);
  });

  test('team leads cannot manage anything', async () => {
    for (const path of ['/admin', `/admin/promoters/${ana.id}`, '/admin/teams', `/admin/teams/${lead.id}`, '/admin/payouts']) {
      expect((await lead.client.get(path)).status).toBe(403);
    }
    const posts: [string, Record<string, string>][] = [
      ['/admin/teams/add', { user_id: String(outsider.id), team_lead_id: String(lead.id) }],
      [`/admin/promoters/${outsider.id}/team`, { team_lead_id: String(lead.id) }],
      ['/admin/teams/lead', { user_id: String(ana.id), lead: '1' }],
    ];
    for (const [path, body] of posts) expect((await lead.client.post(path, body)).status).toBe(403);
    expect(text(await lead.client.page('/team'))).not.toContain(outsider.name);

  });

  test("promoters see their whole team's tickets and sales, team lead included, but no money", async () => {
    expect(await ana.client.page('/')).toContain('<a href="/team">My team</a>');
    const html = await ana.client.page('/team?range=all');
    expect(text(html)).toContain(`Sales by your team, ${lead.name} (your team lead) and you included, all time.`);
    expect(stats(html).get('Tickets sold by the team')).toBe('11');
    expect(stats(html).get('Tickets sold by you')).toBe('10');
    expect(text(html)).toContain(ben.name);
    expect(text(html)).toContain(lead.name);
    expect(text(html)).not.toContain(outsider.name);
    expect(html).toContain('<span class="lead-tag">Team lead</span>');
    expect(html).toContain('<span class="lead-tag">You</span>');
    // No one's commission, team commission or dashboard.
    const main = html.slice(html.indexOf('<main>'));
    for (const word of ['Commission', 'commission', 'Owed']) expect(main).not.toContain(word);
    expect(main).not.toContain(`href="/team/`);
    expect(main).not.toContain('href="/admin');
    // Sorting by commission is not offered, and asking for it sorts by tickets.
    expect(await ana.client.page('/team?range=all&sort=commission')).toContain('aria-current="true">Tickets</a>');
    for (const path of [`/team/${ben.id}`, `/team/${ana.id}`, `/team/${ben.id}/events/1`]) expect((await ana.client.get(path)).status).toBe(403);
    // Their teammates' and team lead's photos, but no one else's.
    await uploadPhoto(lead.client);
    expect((await ana.client.get(`/avatar/${lead.id}`)).status).toBe(200);
    expect((await ana.client.get(`/avatar/${outsider.id}`)).status).toBe(404);

    // Someone on no team has no team page.
    expect((await outsider.client.get('/team')).status).toBe(403);
    expect(await outsider.client.page('/')).not.toContain('href="/team"');
  });

  test('admins see every team', async () => {
    const html = await admin.page(`/admin/teams/${lead.id}?range=all`);
    expect(text(html)).toContain(`Teams / ${lead.name}`);
    expect(stats(html).get('Tickets sold by the team')).toBe('11');
    expect(html).toContain(`href="/admin/promoters/${ana.id}"`);
    for (const id of [ana.id, 999999]) expect((await admin.get(`/admin/teams/${id}`)).status).toBe(404);
  });

  test('what an admin cannot do with teams', async () => {
    const at = `/admin/promoters/${outsider.id}`;
    expect(location(await admin.post(`${at}/team`, { team_lead_id: String(ana.id) }))).toBe(`${at}?error=team_not_lead`);
    expect(location(await admin.post(`${at}/team`, { team_lead_id: 'abc' }))).toBe(`${at}?error=team_not_lead`);
    expect(location(await admin.post(`/admin/promoters/${lead.id}/team`, { team_lead_id: String(lead.id) }))).toBe(
      `/admin/promoters/${lead.id}?error=team_is_lead`,
    );
    expect(location(await admin.post('/admin/teams/add', { user_id: String(outsider.id) }))).toBe('/admin/teams?error=team_not_lead');
    expect(location(await admin.post('/admin/teams/lead', { user_id: '999999', lead: '1' }))).toBe('/admin/teams?error=team_pick');
    expect(location(await admin.post('/admin/teams/lead', { user_id: '1', lead: '1' }))).toBe('/admin/teams?error=team_admin');
    expect(text(await admin.page('/admin/teams?error=team_admin'))).toContain('Admins see every team and cannot be on one.');
    // From another site, refused.
    expect((await admin.post(`${at}/team`, { team_lead_id: String(lead.id) }, { origin: 'https://evil.test' })).status).toBe(403);
    expect(text(await lead.client.page('/team'))).not.toContain(outsider.name);
  });

  test('a promoter moves to another team, and leaves when they become a team lead', async () => {
    const other = await newPromoter(server, admin, { name: `Max ${uid()}` });
    await admin.post('/admin/teams/lead', { user_id: String(other.id), lead: '1' });
    await admin.post(`/admin/promoters/${ben.id}/team`, { team_lead_id: String(other.id) });
    expect(text(await lead.client.page('/team'))).not.toContain(ben.name);
    expect(text(await other.client.page('/team'))).toContain(ben.name);

    // Ben becomes a team lead: off Max's team.
    expect(location(await admin.post('/admin/teams/lead', { user_id: String(ben.id), lead: '1', from: 'promoter' }))).toBe(
      `/admin/promoters/${ben.id}?ok=team_lead_on`,
    );
    expect(text(await other.client.page('/team'))).toContain('No promoters on your team yet');
    expect((await ben.client.get('/team')).status).toBe(200);

    // Deleting a team lead leaves their promoters without a team.
    await admin.post(`/admin/promoters/${outsider.id}/team`, { team_lead_id: String(ben.id) });
    await admin.post(`/admin/promoters/${ben.id}/delete`, { confirm: '1' });
    expect(text(await admin.page('/admin'))).not.toContain(`${ben.name}'s team`);
    expect(await admin.page(`/admin/promoters/${outsider.id}`)).toContain('<option value="">No team</option>');
    expect(await admin.page(`/admin/promoters/${outsider.id}`)).not.toContain('selected=""');
  });

  test('a team lead who steps down loses the team page, and their promoters their team', async () => {
    expect(location(await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '0' }))).toBe('/admin/teams?ok=team_lead_off');
    expect((await lead.client.get('/team')).status).toBe(403);
    expect((await lead.client.get(`/team/${ana.id}`)).status).toBe(403);
    expect((await lead.client.get(`/avatar/${ana.id}`)).status).toBe(404);
    expect((await ana.client.get('/team')).status).toBe(403);
    expect((await ana.client.get(`/avatar/${lead.id}`)).status).toBe(404);
    expect(text(await admin.page('/admin'))).not.toContain(`${lead.name}'s team`);
  });

  test('a team lead made admin is no longer on any team', async () => {
    const boss = await newPromoter(server, admin, { name: `Bo ${uid()}` });
    await admin.post('/admin/teams/lead', { user_id: String(boss.id), lead: '1' });
    await admin.post(`/admin/promoters/${ana.id}/team`, { team_lead_id: String(boss.id) });
    const details = await admin.page(`/admin/promoters/${boss.id}`);
    const email = details.match(/name="email" value="([^"]+)"/)![1]!;
    const alias = details.match(/name="alias" value="([^"]+)"/)![1]!;
    await admin.post(`/admin/promoters/${boss.id}`, { name: boss.name, email, alias, codes: '', commission_percent: '', is_admin: '1' });
    expect(text(await admin.page('/admin'))).not.toContain(`${boss.name}'s team`);
    expect(text(await admin.page('/admin/teams'))).not.toContain(boss.name);
  });
});
