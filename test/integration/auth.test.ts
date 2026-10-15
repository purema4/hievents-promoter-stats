import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  Client,
  createPromoter,
  describeIntegration,
  emailsTo,
  location,
  openLink,
  signInAdmin,
  signInDetails,
  signInPromoter,
  startServer,
  uid,
  waitForEmail,
  type Server,
} from './harness';

describeIntegration('signing in', () => {
  let server: Server;
  let admin: Client;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('the admin signs in with the password and lands on the admin dashboard', async () => {
    const client = new Client(server);
    const res = await client.post('/login', { email: server.adminEmail.toUpperCase(), password: server.adminPassword });
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/');
    expect(client.cookies.has('promoter_session')).toBe(true);
    const home = await client.get('/');
    expect(location(home)).toBe('/admin/dashboard');
    expect(await client.page('/admin/dashboard')).toContain('Dashboard');
  });

  test('a wrong password or an unknown email is refused the same way', async () => {
    const client = new Client(server);
    const wrong = await client.post('/login', { email: `nobody-${uid()}@example.test`, password: 'x' });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('Wrong email or password.');
    const promoter = await createPromoter(admin);
    // Promoters have no password at all.
    const noPassword = await client.post('/login', { email: promoter.email, password: '' });
    expect(noPassword.status).toBe(401);
    expect(client.cookies.has('promoter_session')).toBe(false);
  });

  test('a sign-in link request answers the same for known and unknown emails', async () => {
    const promoter = await createPromoter(admin);
    const unknown = `nobody-${uid()}@example.test`;
    const ask = async (email: string) => {
      const client = new Client(server);
      const started = performance.now();
      const res = await client.post('/login/link', { email });
      const elapsed = performance.now() - started;
      return { status: res.status, body: (await res.text()).replaceAll(email, 'EMAIL'), waits: client.cookies.has('login_wait'), elapsed };
    };
    const known = await ask(promoter.email);
    const other = await ask(unknown);
    expect(known.status).toBe(200);
    expect(other.status).toBe(200);
    expect(known.body).toBe(other.body);
    expect(known.body).toContain('Check your email.');
    expect(known.waits && other.waits).toBe(true);
    // Padded so that sending the email does not make known addresses slower.
    expect(known.elapsed).toBeGreaterThanOrEqual(290);
    expect(other.elapsed).toBeGreaterThanOrEqual(290);
    await waitForEmail(promoter.email);
    expect(await emailsTo(unknown)).toHaveLength(0);
  });

  test('a link opened in the browser that asked for it signs in once', async () => {
    const promoter = await createPromoter(admin);
    const browser = new Client(server);
    await browser.post('/login/link', { email: promoter.email });
    const mail = await waitForEmail(promoter.email);
    expect(mail.Subject).toMatch(/^Promoter stats sign-in code: [0-9]{6}$/);
    const { token, code } = signInDetails(mail);
    expect(mail.Subject).toEndWith(code);

    // The link page itself spends nothing (mail scanners open it); its form does.
    const confirm = await browser.page(`/login/verify?token=${token}`);
    expect(confirm).toContain('action="/login/verify"');
    expect(browser.cookies.has('promoter_session')).toBe(false);

    const res = await browser.post('/login/verify', { token });
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/');
    expect(browser.cookies.has('promoter_session')).toBe(true);
    // First visit: the welcome steps.
    expect(location(await browser.get('/'))).toBe('/welcome');

    const again = await new Client(server).post('/login/verify', { token });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('This link has expired or was already used.');
    // The code went with the link.
    const codeAfter = await new Client(server).post('/login/code', { email: promoter.email, code });
    expect(codeAfter.status).toBe(400);
  });

  test('the 6-digit code signs in, and spends the link that came with it', async () => {
    const promoter = await createPromoter(admin);
    const app = new Client(server);
    await app.post('/login/link', { email: promoter.email });
    const { token, code } = signInDetails(await waitForEmail(promoter.email));

    const wrong = await app.post('/login/code', { email: promoter.email, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('That code is wrong or has expired.');

    const res = await app.post('/login/code', { email: promoter.email.toUpperCase(), code });
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/');
    expect(app.cookies.has('promoter_session')).toBe(true);

    const link = await new Client(server).post('/login/verify', { token });
    expect(link.status).toBe(400);
  });

  test('5 wrong codes cancel the open link and code', async () => {
    const promoter = await createPromoter(admin);
    const app = new Client(server);
    await app.post('/login/link', { email: promoter.email });
    const { token, code } = signInDetails(await waitForEmail(promoter.email));
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) expect((await app.post('/login/code', { email: promoter.email, code: wrongCode })).status).toBe(400);
    expect((await app.post('/login/code', { email: promoter.email, code })).status).toBe(400);
    expect((await new Client(server).post('/login/verify', { token })).status).toBe(400);
  });

  test('a link opened on another device asks before signing in the one that waits', async () => {
    const promoter = await createPromoter(admin);
    const app = new Client(server); // e.g. the installed app, which asked for the link
    await app.post('/login/link', { email: promoter.email });
    const { token } = signInDetails(await waitForEmail(promoter.email));

    expect(await (await app.post('/login/wait')).json()).toEqual({ signedIn: false });

    const browser = new Client(server); // where the link was tapped
    const opened = await openLink(browser, token);
    expect(opened.status).toBe(200);
    const page = await opened.text();
    expect(page).toContain('Also sign in the device that asked for this link?');
    expect(browser.cookies.has('promoter_session')).toBe(true);
    // Not approved yet: the waiting device is still signed out.
    expect(await (await app.post('/login/wait')).json()).toEqual({ signedIn: false });

    const request = page.match(/name="request" value="(\d+)"/)![1]!;
    const approved = await browser.post('/login/approve', { request, answer: 'yes' });
    expect(await approved.text()).toContain('Done.');
    expect(await (await app.post('/login/wait')).json()).toEqual({ signedIn: true });
    expect(app.cookies.has('promoter_session')).toBe(true);
    expect(location(await app.get('/'))).toBe('/welcome');

    // The approval works once.
    const again = await browser.post('/login/approve', { request, answer: 'yes' });
    expect(await again.text()).toContain('That request has expired.');
  });

  test('at most 3 sign-in links per email every 15 minutes, with the same answer every time', async () => {
    const promoter = await createPromoter(admin);
    const bodies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await new Client(server).post('/login/link', { email: promoter.email });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    await waitForEmail(promoter.email, 3);
    await Bun.sleep(1500);
    expect(await emailsTo(promoter.email)).toHaveLength(3);
    // The limit is per address: someone else is not affected.
    const other = await createPromoter(admin);
    await new Client(server).post('/login/link', { email: other.email });
    await waitForEmail(other.email);
    expect(server.logs()).toContain('"event":"link.rate_limited"');
  });

  test('signing out ends the session on the server, not just in the browser', async () => {
    const promoter = await createPromoter(admin);
    const client = await signInPromoter(server, admin, promoter);
    const stolen = client.cookies.get('promoter_session')!;
    expect((await client.get('/')).status).toBe(200);

    const out = await client.post('/logout');
    expect(out.status).toBe(302);
    expect(location(out)).toBe('/login');
    expect(client.cookies.has('promoter_session')).toBe(false);
    expect(location(await client.get('/'))).toBe('/login');

    const replay = new Client(server);
    replay.cookies.set('promoter_session', stolen);
    const res = await replay.get('/');
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/login');
  });

  test('changing a promoter email revokes their sessions and unused links', async () => {
    const promoter = await createPromoter(admin);
    const client = await signInPromoter(server, admin, promoter);
    const res = await admin.post('/admin/promoters/' + promoter.id, {
      name: promoter.name,
      email: `moved-${uid()}@example.test`,
      codes: 'DJMAX',
      commission_percent: '',
    });
    expect(location(res)).toBe(`/admin/promoters/${promoter.id}?ok=saved`);
    expect(location(await client.get('/'))).toBe('/login');
  });

  // Last in this file: it locks the admin's password sign-in on this server for 15 minutes.
  test('password sign-in locks for 15 minutes after 5 failures, even with the right password', async () => {
    const client = new Client(server);
    for (let i = 0; i < 5; i++) {
      const res = await client.post('/login', { email: server.adminEmail, password: `wrong-${i}` });
      expect(res.status).toBe(401);
    }
    const locked = await client.post('/login', { email: server.adminEmail, password: server.adminPassword });
    expect(locked.status).toBe(429);
    expect(await locked.text()).toContain('Too many attempts. Try again in 15 minutes.');
    expect(client.cookies.has('promoter_session')).toBe(false);
    // Already signed-in sessions keep working.
    expect((await admin.get('/admin/dashboard')).status).toBe(200);
  });
});
