import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  Client,
  describeIntegration,
  emailsTo,
  location,
  newPromoter,
  openLink,
  signInAdmin,
  signInDetails,
  startServer,
  text,
  uid,
  waitForSubject,
  type Server,
} from './harness';

/* Invite links: whoever opens one enters their name and email and becomes a promoter. */
describeIntegration('invite links', () => {
  let server: Server;
  let admin: Client;

  const tokenOf = (html: string, label: string) => {
    const card = html.slice(html.indexOf(`<strong>${label}</strong>`));
    return card.match(/\/join\/([A-Za-z0-9_-]+)"/)?.[1];
  };
  const create = async (client: Client, base: string, body: Record<string, string>) => {
    const label = body.label ?? `Link ${uid()}`;
    expect(location(await client.post(base, { days: '7', ...body, label }))).toBe(`${base}?ok=invite_created`);
    return tokenOf(await client.page(base), label)!;
  };
  const join_ = (visitor: Client, token: string, body: Partial<Record<'first_name' | 'last_name' | 'email', string>> = {}) =>
    visitor.post(`/join/${token}`, { first_name: 'Jo', last_name: `Doe${uid()}`, email: `join-${uid()}@example.test`, ...body });
  const sql = (query: string, ...args: (string | number)[]) => {
    const db = new Database(join(server.dataDir, 'promoters.sqlite'));
    db.query(query).run(...args);
    db.close();
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('someone joins with a link, gets a sign-in email and lands on the welcome steps', async () => {
    expect(await admin.page('/admin')).toContain('<a href="/admin/invites">Invite links</a>');
    const token = await create(admin, '/admin/invites', { label: 'Street team', max_uses: '2' });
    expect(token.length).toBeGreaterThanOrEqual(20);

    const visitor = new Client(server);
    const form = await visitor.page(`/join/${token}`);
    expect(text(form)).toContain('Join as a promoter');
    const email = `ana-${uid()}@example.test`;
    const res = await join_(visitor, token, { first_name: 'Ana', last_name: 'Lopez', email });
    expect(res.status).toBe(200);
    expect(text(await res.text())).toContain('Check your email');

    const mail = await waitForSubject(email, /Your access to/);
    expect(mail.Text).toContain('Welcome to the team, Ana Lopez');
    // Opened in the same browser: signed in, first stop the welcome steps.
    expect(location(await openLink(visitor, signInDetails(mail).token))).toBe('/');
    expect(location(await visitor.get('/'))).toBe('/welcome');

    // The admins are told, and see where they came from.
    expect(text(await admin.page('/notifications'))).toContain(`Ana Lopez (${email}) joined with the invite link "Street team". Give them their promo codes.`);
    const list = await admin.page('/admin');
    const id = Number(list.match(new RegExp(`href="/admin/promoters/(\\d+)">Ana Lopez<`))![1]);
    expect(text(await admin.page(`/admin/promoters/${id}`))).toContain('Joined with Invite link "Street team"');
    expect(text(await admin.page('/admin/invites'))).toContain('1 sign-up of 2');
  });

  test('an email that already has an account gets a sign-in link, and no second account', async () => {
    const token = await create(admin, '/admin/invites', { label: 'Existing', max_uses: '1' });
    const existing = await newPromoter(server, admin, { name: `Old ${uid()}` });
    const welcomes = async () => (await emailsTo(existing.email)).filter((m) => /Your access to/.test(m.Subject)).length;
    const before = await welcomes();
    const res = await join_(new Client(server), token, { email: existing.email.toUpperCase() });
    expect(text(await res.text())).toContain('Check your email');
    // A normal sign-in email, not another welcome one.
    await waitForSubject(existing.email, /sign-in code: \d{6}/);
    expect(await welcomes()).toBe(before);
    // The link was not used up.
    expect(text(await admin.page('/admin/invites'))).toContain('0 sign-ups of 1');
  });

  test('a link stops when it is full, turned off or expired', async () => {
    const token = await create(admin, '/admin/invites', { label: 'One only', max_uses: '1' });
    expect((await join_(new Client(server), token)).status).toBe(200);
    const full = await join_(new Client(server), token);
    expect(full.status).toBe(410);
    expect(text(await full.text())).toContain('This invite link no longer works');
    expect((await new Client(server).get(`/join/${token}`)).status).toBe(410);

    const other = await create(admin, '/admin/invites', { label: 'Switch', days: '' });
    const html = await admin.page('/admin/invites');
    const id = html.slice(html.indexOf('<strong>Switch</strong>')).match(/\/admin\/invites\/(\d+)\/off/)![1];
    expect(location(await admin.post(`/admin/invites/${id}/off`))).toBe('/admin/invites?ok=invite_off');
    expect((await join_(new Client(server), other)).status).toBe(410);
    expect(location(await admin.post(`/admin/invites/${id}/on`))).toBe('/admin/invites?ok=invite_on');
    expect((await join_(new Client(server), other)).status).toBe(200);

    sql('UPDATE invite_links SET expires_at = 1000 WHERE id = ?', Number(id));
    expect((await new Client(server).get(`/join/${other}`)).status).toBe(410);
    expect(text(await admin.page('/admin/invites'))).toContain('Expired');
  });

  test('what is refused', async () => {
    const token = await create(admin, '/admin/invites', {});
    const visitor = new Client(server);
    for (const body of [{ email: 'not-an-email' }, { email: 'a@b' }, { first_name: ' ' }, { last_name: '' }]) {
      expect((await join_(visitor, token, body)).status).toBe(400);
    }
    for (const path of ['/join/nope', `/join/${'x'.repeat(24)}`, '/join/..%2Fadmin']) expect((await visitor.get(path)).status).toBe(404);
    // From another site.
    expect((await visitor.post(`/join/${token}`, { first_name: 'A', last_name: 'B', email: `x-${uid()}@example.test` }, { origin: 'https://evil.test' })).status).toBe(403);
    // Bad settings.
    for (const body of [{ label: ' ' }, { label: 'x', days: '3' }, { label: 'x', max_uses: '0' }, { label: 'x', team_lead_id: '999999' }] as Record<string, string>[]) {
      expect(location(await admin.post('/admin/invites', { days: '7', ...body }))).toContain('error=');
    }
    // Promoters manage none.
    const p = await newPromoter(server, admin);
    expect((await p.client.get('/admin/invites')).status).toBe(403);
    expect((await p.client.post('/admin/invites', { label: 'mine', days: '7' })).status).toBe(403);
    expect((await p.client.get('/team/invites')).status).toBe(403);
    // Signed in already.
    expect(text(await p.client.page(`/join/${token}`))).toContain('You already have an account');
  });

  test('at most 20 sign-ups an hour on one link', async () => {
    const token = await create(admin, '/admin/invites', {});
    for (let i = 0; i < 20; i++) expect((await join_(new Client(server), token)).status).toBe(200);
    const res = await join_(new Client(server), token);
    expect(res.status).toBe(429);
    expect(text(await res.text())).toContain('Too many people joined with this link');
  }, 60_000);

  test("team leads invite to their own team; admins can invite to any team", async () => {
    const lead = await newPromoter(server, admin, { name: `Lea ${uid()}` });
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '1' });
    expect(await lead.client.page('/team')).toContain('href="/team/invites"');
    // A team lead cannot pick another team.
    const token = await create(lead.client, '/team/invites', { label: 'My crew', team_lead_id: '1' });
    const form = await new Client(server).page(`/join/${token}`);
    expect(text(form)).toContain(`on ${lead.name}'s team`);
    const email = `crew-${uid()}@example.test`;
    await join_(new Client(server), token, { first_name: 'Cy', last_name: 'Crew', email });
    expect(text(await lead.client.page('/team'))).toContain('Cy Crew');
    expect(text(await lead.client.page('/notifications'))).toContain('Cy Crew joined your team with your invite link "My crew"');
    expect(text(await admin.page('/notifications'))).toContain(`on ${lead.name}'s team`);

    // Admins see it; the team lead sees only their own links and cannot touch others'.
    const adminToken = await create(admin, '/admin/invites', { label: `For ${lead.name}`, team_lead_id: String(lead.id) });
    await join_(new Client(server), adminToken, { first_name: 'Di', last_name: 'Dee' });
    expect(text(await lead.client.page('/team'))).toContain('Di Dee');
    const mine = text(await lead.client.page('/team/invites'));
    expect(mine).toContain('My crew');
    expect(mine).not.toContain(`For ${lead.name}`);
    const adminHtml = await admin.page('/admin/invites');
    const adminLinkId = adminHtml.slice(adminHtml.indexOf(`<strong>For ${lead.name}</strong>`)).match(/\/admin\/invites\/(\d+)\/off/)![1];
    expect((await lead.client.post(`/team/invites/${adminLinkId}/off`)).status).toBe(404);
    expect(text(adminHtml)).toContain(`made by ${lead.name}`);

    // A team lead who steps down: their own link stops; the admin's link still works, with no team.
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '0' });
    expect((await new Client(server).get(`/join/${token}`)).status).toBe(410);
    expect((await join_(new Client(server), adminToken)).status).toBe(200);
  });
});
