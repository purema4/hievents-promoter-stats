import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, stats, text, uid, type Server } from './harness';

/* Admins viewing the app as a promoter: everything they see, nothing sent in their name. */
describeIntegration('viewing as a promoter', () => {
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('an admin sees the app as the promoter, with a banner on every page', async () => {
    expect(await admin.page(`/admin/promoters/${promoter.id}`)).toContain(`action="/admin/promoters/${promoter.id}/impersonate"`);
    expect(location(await admin.post(`/admin/promoters/${promoter.id}/impersonate`))).toBe('/');

    const home = await admin.page('/');
    expect(home).toContain('class="impersonation-banner"');
    expect(text(home)).toContain(`Viewing as ${promoter.name}.`);
    expect(text(home)).toContain(`Hi ${promoter.name}`);
    expect(stats(home).get('Tickets sold, 6 orders · 1 awaiting payment')).toBe('10');
    expect(home).toContain('<a href="/payouts">Payouts &amp; rewards</a>');
    expect(home).not.toContain('href="/admin');
    expect(home).not.toContain('data-install-banner');
    for (const path of ['/payouts', '/page', '/account', '/account/security', '/notifications']) {
      expect(await admin.page(path)).toContain('class="impersonation-banner"');
    }
    // No admin pages meanwhile.
    for (const path of ['/admin', `/admin/promoters/${promoter.id}`, '/admin/dashboard']) expect((await admin.get(path)).status).toBe(403);

    // The promoter's own session is untouched and shows no banner.
    const own = await promoter.client.page('/');
    expect(own).not.toContain('impersonation-banner');
    expect(text(own)).toContain(`Hi ${promoter.name}`);
  });

  test('nothing can be sent in their name', async () => {
    const attempts: [string, Record<string, string>][] = [
      ['/payouts', { amount: '10', currency: 'CAD', method: 'Interac e-Transfer', details: 'evil@example.test' }],
      ['/account/profile', { alias: 'taken-over', theme: 'dark', first_name: 'Evil' }],
      ['/account/security/devices/sign-out-others', {}],
      ['/account/security/2fa/start', {}],
      ['/page/visibility', { hidden: '1' }],
      ['/welcome/done', {}],
      ['/login/approve', { answer: 'yes', request: '1' }],
      ['/rewards/ticket', { event_id: '1', guest_name: 'Someone' }],
    ];
    for (const [path, body] of attempts) {
      const res = await admin.post(path, body);
      expect(res.status).toBe(403);
      expect(text(await res.text())).toContain('changes are turned off: nothing was sent or saved');
    }
    const own = await promoter.client.page('/payouts');
    expect(text(own)).toContain('No payout requests yet');
    expect(await promoter.client.page('/account')).not.toContain('taken-over');
    expect((await promoter.client.get('/')).status).toBe(200);
  });

  test("a two-step setup they started stays theirs", async () => {
    await admin.post('/impersonate/stop');
    expect(location(await promoter.client.post('/account/security/2fa/start'))).toStartWith('/account/security');
    const own = await promoter.client.page('/account/security?setup=1');
    const secret = own.match(/<p class="secret">([A-Z2-7 ]+)<\/p>/)?.[1];
    expect(secret).toBeTruthy();
    await admin.post(`/admin/promoters/${promoter.id}/impersonate`);
    const seen = await admin.page('/account/security?setup=1');
    expect(seen).toContain('impersonation-banner');
    expect(seen).not.toContain(secret!);
    expect(seen).not.toContain('class="secret"');
  });

  test('their notifications stay unread for them', async () => {
    await admin.post('/impersonate/stop');
    // Making them a team lead sends them a notification.
    await admin.post('/admin/teams/lead', { user_id: String(promoter.id), lead: '1' });
    await admin.post(`/admin/promoters/${promoter.id}/impersonate`);
    expect(text(await admin.page('/notifications'))).toContain('You are a team lead');
    expect(await promoter.client.page('/')).toContain('class="nav-count"');
    // They see My team too, as the promoter would.
    expect((await admin.get('/team')).status).toBe(200);
  });

  test('back to their own account', async () => {
    expect(location(await admin.post('/impersonate/stop'))).toBe(`/admin/promoters/${promoter.id}`);
    const page = await admin.page(`/admin/promoters/${promoter.id}`);
    expect(page).not.toContain('impersonation-banner');
    expect((await admin.get('/admin')).status).toBe(200);
    // Stopping when not viewing as anyone does nothing.
    expect(location(await admin.post('/impersonate/stop'))).toBe('/');
  });

  test('only admins, from this site, and never as another admin', async () => {
    expect((await promoter.client.post(`/admin/promoters/${promoter.id}/impersonate`)).status).toBe(403);
    expect((await admin.post(`/admin/promoters/${promoter.id}/impersonate`, {}, { origin: 'https://evil.test' })).status).toBe(403);
    expect(location(await admin.get('/'))).toBe('/admin/dashboard');
    expect(location(await admin.post('/admin/promoters/1/impersonate'))).toBe('/admin/promoters/1?error=impersonate_admin');
    expect((await admin.post('/admin/promoters/999999/impersonate')).status).toBe(404);
    expect(location(await promoter.client.post('/impersonate/stop'))).toBe('/');
  });

  test('it ends by itself when the promoter becomes an admin', async () => {
    const other = await newPromoter(server, admin, { name: `Bo ${uid()}` });
    await admin.post(`/admin/promoters/${other.id}/impersonate`);
    expect(await admin.page('/')).toContain('impersonation-banner');
    const second = await signInAdmin(server);
    const details = await second.page(`/admin/promoters/${other.id}`);
    const alias = details.match(/name="alias" value="([^"]+)"/)![1]!;
    await second.post(`/admin/promoters/${other.id}`, { name: other.name, email: other.email, alias, codes: '', commission_percent: '', is_admin: '1' });
    expect(await admin.page('/admin')).not.toContain('impersonation-banner');
  });
});
