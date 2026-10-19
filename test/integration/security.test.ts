import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, createPromoter, describeIntegration, location, newPromoter, signInAdmin, startServer, uid, type Server } from './harness';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

describeIntegration('security controls', () => {
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;
  let adminId: number;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin);
    // Each server starts with an empty database: the admin from ADMIN_EMAIL is the first user.
    adminId = 1;
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('pages carry a strict CSP, frame and sniffing protections, and are never cached', async () => {
    for (const [client, path] of [
      [new Client(server), '/login'],
      [promoter.client, '/'],
      [promoter.client, '/payouts'],
      [admin, '/admin'],
    ] as const) {
      const res = await client.get(path);
      expect(res.status).toBe(200);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('strict-transport-security')).toContain('max-age=');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('static files are cacheable, pages are not', async () => {
    const css = await new Client(server).get('/app.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('cache-control')).toContain('immutable');
  });

  test('the session cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await new Client(server).post('/login', { email: server.adminEmail, password: server.adminPassword });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('promoter_session='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  test('a form POST without an Origin header is rejected', async () => {
    const res = await new Client(server).post('/login', { email: server.adminEmail, password: server.adminPassword }, { origin: null });
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test('a form POST from another origin is rejected, whatever the content type', async () => {
    for (const origin of ['https://evil.example', server.url.replace('127.0.0.1', 'localhost'), 'null']) {
      const res = await new Client(server).post('/login/link', { email: promoter.email }, { origin });
      expect(res.status).toBe(403);
    }
    const plain = await new Client(server).request('/login', {
      method: 'POST',
      origin: 'https://evil.example',
      headers: { 'content-type': 'text/plain' },
      body: 'email=x',
    });
    expect(plain.status).toBe(403);
    const multipart = new FormData();
    multipart.set('email', 'x');
    const form = await new Client(server).request('/login', { method: 'POST', origin: 'https://evil.example', body: multipart });
    expect(form.status).toBe(403);
  });

  test('a signed-in admin cannot be made to act from another site', async () => {
    const email = `csrf-${uid()}@example.test`;
    const res = await admin.post('/admin/promoters', { name: 'CSRF', email, codes: 'DJMAX', invite: '0' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await admin.page('/admin')).not.toContain(email);
    const out = await promoter.client.post('/logout', {}, { origin: 'https://evil.example' });
    expect(out.status).toBe(403);
    expect((await promoter.client.get('/')).status).toBe(200);
  });

  test('request bodies over 32 KB are refused with 413', async () => {
    const res = await new Client(server).post('/login/link', { email: `${'a'.repeat(40 * 1024)}@example.test` });
    expect(res.status).toBe(413);
    expect(await res.text()).toBe('Request too large');
    const small = await new Client(server).post('/login/link', { email: `${'a'.repeat(1000)}@example.test` });
    expect(small.status).toBe(200);
  });

  test('signed-out visitors only reach the sign-in pages', async () => {
    const visitor = new Client(server);
    for (const path of ['/', '/payouts', '/events/1', '/account', '/account/security', '/notifications', '/admin', '/admin/dashboard', `/avatar/${adminId}`, '/event-image/1']) {
      const res = await visitor.get(path);
      expect(res.status).toBe(302);
      expect(location(res)).toBe('/login');
    }
    expect((await visitor.get('/healthz')).status).toBe(200);
    expect((await visitor.get('/login')).status).toBe(200);
  });

  test('promoters get 403 on every admin page and action', async () => {
    for (const path of ['/admin', '/admin/dashboard', '/admin/payouts', '/admin/emails', '/admin/emails/login/preview', `/admin/promoters/${adminId}`, `/admin/promoters/${promoter.id}/view`]) {
      const res = await promoter.client.get(path);
      expect(res.status).toBe(403);
    }
    const email = `sneaky-${uid()}@example.test`;
    const create = await promoter.client.post('/admin/promoters', { name: 'Sneaky', email, codes: 'LUNA', invite: '0', is_admin: '1' });
    expect(create.status).toBe(403);
    const self = await promoter.client.post(`/admin/promoters/${promoter.id}`, { name: 'Me', email: promoter.email, is_admin: '1', codes: 'DJMAX,LUNA' });
    expect(self.status).toBe(403);
    const adjust = await promoter.client.post(`/admin/promoters/${promoter.id}/adjust`, { kind: 'money', amount: '1000', label: 'Free money' });
    expect(adjust.status).toBe(403);
    expect(await admin.page('/admin')).not.toContain(email);
    // Still a promoter with one code and no extra money.
    expect(await promoter.client.page('/payouts')).not.toContain('Added by the team');
  });

  test('a promoter sees only their own photo; admins see everyone', async () => {
    const other = await newPromoter(server, admin);
    const form = new FormData();
    form.set('alias', `photo-${uid()}`);
    form.set('theme', 'system');
    form.set('photo', new File([png], 'me.png', { type: 'image/png' }));
    const saved = await promoter.client.request('/account/profile', { method: 'POST', body: form });
    expect(location(saved)).toBe('/account?ok=saved');

    const own = await promoter.client.get(`/avatar/${promoter.id}`);
    expect(own.status).toBe(200);
    // Stored rebuilt as a JPEG (src/images.ts), whatever was uploaded.
    expect(own.headers.get('content-type')).toBe('image/jpeg');
    expect([...new Uint8Array(await own.arrayBuffer()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect((await other.client.get(`/avatar/${promoter.id}`)).status).toBe(404);
    expect((await promoter.client.get(`/avatar/${adminId}`)).status).toBe(404);
    expect((await admin.get(`/avatar/${promoter.id}`)).status).toBe(200);
  });

  test('a photo that is not a PNG, JPEG or WebP (an SVG with a script) is refused', async () => {
    const form = new FormData();
    form.set('alias', `svg-${uid()}`);
    form.set('photo', new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'x.png', { type: 'image/png' }));
    const res = await promoter.client.request('/account/profile', { method: 'POST', body: form });
    expect(location(res)).toBe('/account?error=photo_type');
  });

  test('a promoter only sees events that have one of their codes', async () => {
    const luna = await newPromoter(server, admin, { codes: 'luna' });
    expect((await luna.client.get('/events/1')).status).toBe(200);
    for (const id of ['2', '3', '4', '999', 'abc', '1.5']) {
      expect((await luna.client.get(`/events/${id}`)).status).toBe(404);
    }
    const dashboard = await luna.client.page('/');
    expect(dashboard).toContain('Warehouse Night');
    expect(dashboard).not.toContain('Winter Opening');
    expect(dashboard).not.toContain('Summer Rooftop');
  });

  test('a promoter cannot undo or settle anything of someone else', async () => {
    const victim = await createPromoter(admin);
    const adjusted = await admin.post(`/admin/promoters/${victim.id}/adjust`, { kind: 'money', amount: '5', label: 'Bonus' });
    expect(location(adjusted)).toContain('ok=adjusted');
    const undo = (await admin.page(`/admin/promoters/${victim.id}`)).match(/action="(\/admin\/promoters\/\d+\/adjust\/\d+\/undo)"/)![1]!;
    expect((await promoter.client.post(undo)).status).toBe(403);
    // An undo through another promoter's URL is not found.
    const wrongOwner = undo.replace(`/admin/promoters/${victim.id}/`, `/admin/promoters/${promoter.id}/`);
    expect((await admin.post(wrongOwner)).status).toBe(404);
  });

  test('push subscriptions only accept the browsers’ push services', async () => {
    const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };
    const evil = await promoter.client.request('/push/subscribe', json({ endpoint: 'https://evil.example/hook', keys }));
    expect(evil.status).toBe(400);
    const internal = await promoter.client.request('/push/subscribe', json({ endpoint: 'http://169.254.169.254/latest', keys }));
    expect(internal.status).toBe(400);
    const badKeys = await promoter.client.request('/push/subscribe', json({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x'.repeat(30), auth: 'y'.repeat(20) } }));
    expect(badKeys.status).toBe(400);
  });
});
