import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Promoters → Promo codes, and where admins land. From dev/seed.sql: DJMAX on Warehouse Night, Winter Opening,
 * another account's event (all upcoming) and Summer Rooftop (over); LUNA on Warehouse Night; NOVA on Warehouse
 * Night, Summer Rooftop and Secret Afterparty (a draft). Only DJMAX is assigned here.
 */
describeIntegration('admin promo codes and landing', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  const rows = (html: string) => (html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('All promoters no longer lists every code, and links to the codes still unassigned', async () => {
    const html = await admin.page('/admin');
    expect(text(html)).not.toContain('Summer Rooftop');
    expect(html).toContain('href="/admin/codes"');
    expect(text(html)).toMatch(/[0-9]+ on upcoming events (is|are) assigned to nobody/);
    expect(html).toContain('<a href="/admin/codes">Promo codes</a>');
  });

  test('upcoming events by default, with who each code is assigned to', async () => {
    const html = await admin.page('/admin/codes');
    expect(text(html)).not.toContain('Summer Rooftop');
    expect(text(html)).toContain('Secret Afterparty');
    expect(text(html)).toContain(maya.name);
    expect(rows(html)).toBe(6);
  });

  test('search, filters and both together', async () => {
    expect(rows(await admin.page('/admin/codes?q=luna'))).toBe(1);
    expect(rows(await admin.page(`/admin/codes?q=${encodeURIComponent(maya.name.toLowerCase())}`))).toBe(3);
    expect(rows(await admin.page('/admin/codes?when=past'))).toBe(2);
    expect(rows(await admin.page('/admin/codes?when=all'))).toBe(8);
    expect(rows(await admin.page('/admin/codes?show=assigned&when=all'))).toBe(4);
    const unassigned = await admin.page('/admin/codes?show=unassigned&q=nova');
    expect(rows(unassigned)).toBe(2);
    expect(text(unassigned)).not.toContain(maya.name);
    // The form shows what is searched, and offers to clear it.
    expect(unassigned).toContain('value="nova"');
    expect(unassigned).toContain('href="/admin/codes">Clear</a>');
    expect(text(await admin.page('/admin/codes?q=zzz-none'))).toContain('No promo codes match.');
  });

  test('search text is shown as text', async () => {
    const html = await admin.page(`/admin/codes?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  test('admins land on the admin dashboard, even with codes of their own', async () => {
    expect(location(await admin.get('/'))).toBe('/admin/dashboard');
    // The admin from ADMIN_EMAIL is the first user.
    const saved = await admin.post('/admin/promoters/1', { name: 'Admin', email: server.adminEmail, is_admin: '1', codes: 'NOVA' });
    expect(location(saved)).toStartWith('/admin/promoters/1?ok=');
    expect(location(await admin.get('/'))).toBe('/admin/dashboard');
    // Promoters still get their own dashboard.
    expect((await maya.client.get('/')).status).toBe(200);
  });

  test('admins only', async () => {
    expect((await maya.client.get('/admin/codes')).status).toBe(403);
    expect(location(await new Client(server).get('/admin/codes'))).toBe('/login');
  });
});
