import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  Client,
  createPromoter,
  currentStep,
  describeIntegration,
  location,
  openLink,
  sendInvite,
  signInAdmin,
  signInPromoter,
  startServer,
  totp,
  type Promoter,
  type Server,
} from './harness';

describeIntegration('two-step verification', () => {
  let server: Server;
  let admin: Client;
  let promoter: Promoter;
  let client: Client;
  let secret: string;
  let recovery: string[];
  let usedStep: number;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await createPromoter(admin);
    client = await signInPromoter(server, admin, promoter);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  /** Signs in with a fresh invite link: the first step only, when two-step verification is on. */
  async function firstStep(): Promise<Client> {
    const browser = new Client(server);
    const { token } = await sendInvite(admin, promoter);
    const res = await openLink(browser, token);
    expect(res.status).toBe(302);
    expect(location(res)).toBe('/login/2fa');
    return browser;
  }

  test('set up from Account → Security with the key shown on the page', async () => {
    expect(await client.page('/account/security')).toContain('Set up two-step verification');
    const start = await client.post('/account/security/2fa/start');
    expect(location(start)).toBe('/account/security?setup=1#two-step');
    const page = await client.page('/account/security?setup=1');
    secret = page.match(/<p class="secret">([A-Z2-7 ]+)<\/p>/)![1]!.replace(/ /g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // The QR code carries the same key, as an otpauth URI.
    expect(page).toContain(`secret=${secret}&amp;issuer=`);

    const wrong = await client.post('/account/security/2fa/confirm', { code: totp(secret, currentStep() + 10) });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('That code did not work.');

    usedStep = currentStep();
    const confirmed = await client.post('/account/security/2fa/confirm', { code: totp(secret, usedStep) });
    expect(confirmed.status).toBe(200);
    const html = await confirmed.text();
    recovery = html.match(/value="([^"]+)" aria-label="Recovery codes"/)![1]!.split(' ');
    expect(recovery).toHaveLength(10);
    expect(await client.page('/account/security')).toContain('10 recovery codes');
    // The browser that turned it on stays signed in.
    expect((await client.get('/')).status).toBe(200);
  });

  test('signing in then asks for a code before giving a session', async () => {
    const browser = await firstStep();
    expect(browser.cookies.has('promoter_session')).toBe(false);
    expect(location(await browser.get('/'))).toBe('/login');
    expect(await browser.page('/login/2fa')).toContain('Enter the 6-digit code from your authenticator app.');

    const wrong = await browser.post('/login/2fa', { code: totp(secret, usedStep + 10) });
    expect(wrong.status).toBe(400);
    // The code used to confirm the setup is spent.
    expect((await browser.post('/login/2fa', { code: totp(secret, usedStep) })).status).toBe(400);

    // The next code, sent from two sign-in attempts at the same moment, signs in only one of them.
    const other = await firstStep();
    const next = totp(secret, usedStep + 1);
    const results = await Promise.all([browser.post('/login/2fa', { code: next }), other.post('/login/2fa', { code: next })]);
    expect(results.map((r) => r.status).sort()).toEqual([302, 400]);
    const winner = results[0]!.status === 302 ? browser : other;
    expect(location(results.find((r) => r.status === 302)!)).toBe('/');
    expect((await winner.get('/')).status).toBe(200);
    expect(location(await winner.get('/login/2fa'))).toBe('/login');
  });

  test('a code from the app works once: a replay is refused', async () => {
    const browser = await firstStep();
    const replay = await browser.post('/login/2fa', { code: totp(secret, usedStep + 1) });
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain('That code did not work.');
    expect(browser.cookies.has('promoter_session')).toBe(false);
  });

  test('a recovery code signs in once, typed in any case', async () => {
    const browser = await firstStep();
    const res = await browser.post('/login/2fa', { code: recovery[0]!.toUpperCase() });
    expect(location(res)).toBe('/');
    const again = await firstStep();
    expect((await again.post('/login/2fa', { code: recovery[0]! })).status).toBe(400);
    expect(await browser.page('/account/security')).toContain('9 recovery codes');
    // Using one is announced.
    expect(await browser.page('/notifications')).toContain('A recovery code was used');
  });

  test('5 wrong codes end the attempt', async () => {
    const browser = await firstStep();
    for (let i = 0; i < 4; i++) expect((await browser.post('/login/2fa', { code: '00000' + i })).status).toBe(400);
    const last = await browser.post('/login/2fa', { code: '000009' });
    expect(last.status).toBe(429);
    expect(await last.text()).toContain('Too many wrong codes.');
    // Even a right code no longer helps with this attempt.
    expect(location(await browser.post('/login/2fa', { code: recovery[1]! }))).toBe('/login');
  });

  test('the sign-in code path asks for the second step too', async () => {
    const { code } = await sendInvite(admin, promoter);
    const app = new Client(server);
    const res = await app.post('/login/code', { email: promoter.email, code });
    expect(location(res)).toBe('/login/2fa');
    expect(app.cookies.has('promoter_session')).toBe(false);
  });

  test('turning it off needs a code; then signing in is one step again', async () => {
    const wrong = await client.post('/account/security/2fa/off', { code: '123456' });
    expect(wrong.status).toBe(400);
    const off = await client.post('/account/security/2fa/off', { code: recovery[2]! });
    expect(location(off)).toBe('/account/security?ok=2fa_off');
    const browser = new Client(server);
    const { token } = await sendInvite(admin, promoter);
    expect(location(await openLink(browser, token))).toBe('/');
  });

  test('an admin can reset it for a promoter who lost their phone', async () => {
    const other = await createPromoter(admin);
    const otherClient = await signInPromoter(server, admin, other);
    await otherClient.post('/account/security/2fa/start');
    const key = (await otherClient.page('/account/security?setup=1')).match(/<p class="secret">([A-Z2-7 ]+)<\/p>/)![1]!.replace(/ /g, '');
    expect((await otherClient.post('/account/security/2fa/confirm', { code: totp(key) })).status).toBe(200);

    expect(location(await admin.post(`/admin/promoters/${other.id}/2fa-reset`, { confirm: '1' }))).toBe(`/admin/promoters/${other.id}?ok=2fa_reset`);
    const browser = new Client(server);
    const { token } = await sendInvite(admin, other);
    expect(location(await openLink(browser, token))).toBe('/');
  });
});
