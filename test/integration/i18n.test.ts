import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, waitForSubject, type Server } from './harness';

/*
 * French for promoters whose browser asks for it, English otherwise; admin pages in English.
 * And the menu: accordions, with an Advanced section (API & Claude) behind a toggle.
 */
const FR = { 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' };

describeIntegration('languages and the menu', () => {
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;

  const frPage = async (client: Client, path: string) => {
    const res = await client.request(path, { headers: FR });
    expect(res.status).toBe(200);
    return res.text();
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('a French browser gets the promoter pages in French, money and dates included', async () => {
    const html = await frPage(promoter.client, '/');
    expect(html).toContain('<html lang="fr"');
    const words = text(html);
    expect(words).toContain('Tableau de bord');
    expect(words).toContain('Mes ventes');
    expect(words).not.toContain('Upcoming events');
    // 310,00 $ style, not $310.00.
    expect(words).toMatch(/\d+,\d{2}\s\$/);
    expect(words).not.toMatch(/\$\d+\.\d{2}/);
  });

  test('an English browser, or none, gets English', async () => {
    const html = await promoter.client.page('/');
    expect(html).toContain('<html lang="en"');
    expect(text(html)).toContain('Dashboard');
    const res = await promoter.client.request('/', { headers: { 'accept-language': 'en-CA,en;q=0.9,fr;q=0.8' } });
    expect(text(await res.text())).toContain('Dashboard');
  });

  test('admin pages stay in English, numbers too', async () => {
    const html = await frPage(admin, '/admin');
    expect(html).toContain('<html lang="en"');
    expect(text(html)).toContain('Promoters');
  });

  test('the language of their last visit is used for what is sent to them later', async () => {
    await frPage(promoter.client, '/notifications');
    const res = await promoter.client.request('/notifications/test', { method: 'POST', headers: FR });
    expect(res.status).toBe(302);
    expect(text(await frPage(promoter.client, '/notifications'))).toContain('Notification de test');
    // Back in English: the next one is in English.
    await promoter.client.page('/notifications');
  });

  test('menu groups are accordions, open without scripts', async () => {
    const html = await promoter.client.page('/');
    expect(html).toContain('<details class="nav-group" data-nav-group="sales" open="">');
    expect(html).toContain('<summary class="nav-title">');
  });

  test('API & Claude is in an Advanced section that a toggle shows and hides', async () => {
    let html = await promoter.client.page('/payouts');
    expect(html).not.toContain('href="/account/api"');
    expect(html).toContain('role="switch" aria-checked="false"');

    let res = await promoter.client.post('/account/advanced', { on: '1', back: '/payouts?x=1' });
    expect(res.status).toBe(303);
    expect(location(res)).toBe('/payouts?x=1');
    html = await promoter.client.page('/payouts');
    expect(html).toContain('data-nav-group="advanced"');
    expect(html).toContain('href="/account/api"');
    expect(html).toContain('role="switch" aria-checked="true"');

    // Only back to a page of this site.
    for (const back of ['//evil.example', 'https://evil.example/', '/\\evil.example']) {
      res = await promoter.client.post('/account/advanced', { on: '0', back });
      expect(location(res)).toBe('/');
    }
    expect(await promoter.client.page('/payouts')).not.toContain('href="/account/api"');
    // The page itself still opens for those who know it.
    expect((await promoter.client.request('/account/api')).status).toBe(200);
  });

  test('promoter emails have a French version the admins can edit, sent to French browsers', async () => {
    const editor = await admin.page('/admin/emails/login?lang=fr');
    expect(editor).toContain('<input type="hidden" name="lang" value="fr"/>');
    expect(text(editor)).toContain('Français');
    const fields = { subject: 'Ton code {{code}} pour {{brand}}', heading: 'Connexion', body: 'Voici ton lien.', button: 'Me connecter' };
    expect(location(await admin.post('/admin/emails/login', { ...fields, lang: 'fr', action: 'save' }))).toBe('/admin/emails/login?lang=fr&ok=saved');
    // English untouched.
    expect(await admin.page('/admin/emails/login')).not.toContain('Ton code');
    expect(text(await (await admin.get('/admin/emails/login/preview?lang=fr')).text())).toContain('Voici ton lien.');

    const visitor = new Client(server);
    await visitor.post('/login/link', { email: promoter.email }, { headers: FR });
    const mail = await waitForSubject(promoter.email, /^Ton code \d{6} pour /);
    expect(mail.Text).toContain('Voici ton lien.');
    expect(mail.Text).toContain('expirent dans 30 minutes');
    expect(location(await admin.post('/admin/emails/login', { lang: 'fr', action: 'reset' }))).toBe('/admin/emails/login?lang=fr&ok=reset');
  });

  test('the language picked in the menu wins over the browser, for pages and what is sent later', async () => {
    const p = await newPromoter(server, admin);
    let html = await p.client.page('/payouts');
    // In the avatar menu and the side menu.
    expect(html.match(/<form class="lang-switch"/g)?.length).toBe(2);
    expect(html).toContain('value="auto" aria-pressed="true"');

    let res = await p.client.post('/lang', { lang: 'fr', back: '/payouts' });
    expect(location(res)).toBe('/payouts');
    // An English browser, French chosen: French.
    res = await p.client.request('/payouts', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
    html = await res.text();
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('value="fr" aria-pressed="true"');
    await p.client.post('/notifications/test');
    expect(text(await p.client.page('/notifications'))).toContain('Notification de test');

    // Back to the browser's language.
    await p.client.post('/lang', { lang: 'auto', back: '/' });
    expect(await p.client.page('/payouts')).toContain('<html lang="en"');
    expect(await frPage(p.client, '/payouts')).toContain('<html lang="fr"');
  });

  test('before signing in, the choice is kept in a cookie', async () => {
    const visitor = new Client(server);
    expect(location(await visitor.post('/lang', { lang: 'fr', back: '//evil.example' }))).toBe('/');
    expect(await visitor.page('/login')).toContain('<html lang="fr"');
  });

  test('admins have the toggle too', async () => {
    expect(await admin.page('/admin')).toContain('role="switch"');
  });
});
