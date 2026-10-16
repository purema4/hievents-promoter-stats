import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Each promoter's public page, /p/<alias>. The seed's NOVA code is on "Warehouse Night" (event 1,
 * upcoming), "Summer Rooftop" (event 4, over) and "Secret Afterparty" (event 5, a draft), with no sales.
 */
const SITE = 'https://tickets.example.test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

describeIntegration("promoters' public pages", () => {
  let server: Server;
  let admin: Client;
  let visitor: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;
  let alias: string;

  beforeAll(async () => {
    server = await startServer({ HIEVENTS_PUBLIC_URL: SITE });
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { name: 'Nova <b>Star</b>', codes: 'NOVA' });
    visitor = new Client(server);
    alias = `nova-${uid()}`;
    // A photo and an Instagram handle, as the promoter sets them on Account.
    const form = new FormData();
    form.set('alias', alias);
    form.set('theme', 'system');
    form.set('instagram', '@nova.star');
    form.set('photo', new File([png], 'me.png', { type: 'image/png' }));
    expect(location(await promoter.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('anyone can open it: the upcoming events, each with the link and code, and nothing about sales', async () => {
    const res = await visitor.get(`/p/${alias}`);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const html = await res.text();
    expect(html).toContain('Nova &lt;b&gt;Star&lt;/b&gt;');
    expect(html).not.toContain('<b>Star</b>');
    expect(html).toContain(`<a class="lp-event" href="${SITE}/event/1/warehouse-night?promo_code=NOVA&amp;aff=${alias}"`);
    expect(text(html)).toContain('Code NOVA applied');
    expect(text(html)).toContain('Next up');
    expect(html).toContain(`<a class="lp-pill" href="https://www.instagram.com/nova.star/"`);
    expect(html).toContain(`<meta property="og:image" content="${server.url}/p/${alias}/cover/1"/>`);
    expect(html).toContain(`data-share-page="${server.url}/p/${alias}"`);
    // Over, and not published yet.
    expect(html).not.toContain('Summer Rooftop');
    expect(html).not.toContain('Secret Afterparty');
    for (const word of ['commission', 'tickets sold', '$', 'Payout']) expect(text(html)).not.toContain(word);
  });

  test('its pictures are public too, but only the ones it shows', async () => {
    const cover = await visitor.get(`/p/${alias}/cover/1`);
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toBe('image/png');
    for (const id of ['2', '4', '5', 'x']) expect((await visitor.get(`/p/${alias}/cover/${id}`)).status).toBe(404);
    const avatar = await visitor.get(`/p/${alias}/avatar`);
    expect(avatar.status).toBe(200);
    expect(Buffer.from(await avatar.arrayBuffer()).equals(png)).toBe(true);
    // Still private everywhere else.
    expect((await visitor.get(`/avatar/${promoter.id}`)).status).toBe(302);
    expect((await visitor.get('/event-image/1')).status).toBe(302);
  });

  test('a mistyped or unknown address', async () => {
    const upper = await visitor.get(`/p/${alias.toUpperCase()}`);
    expect(upper.status).toBe(301);
    expect(location(upper)).toBe(`/p/${alias}`);
    for (const path of ['/p/nobody-here', '/p/..%2Fadmin', '/p/x']) {
      const res = await visitor.get(path);
      expect(res.status).toBe(404);
      expect(text(await res.text())).toContain('This page does not exist');
    }
  });

  test('a promoter without upcoming events still has a page', async () => {
    const other = await newPromoter(server, admin, { codes: 'NOSUCHCODE' });
    const account = await other.client.page('/account');
    const otherAlias = account.match(/name="alias" value="([^"]+)"/)![1]!;
    expect(text(await visitor.page(`/p/${otherAlias}`))).toContain('No upcoming events right now');
  });

  test('promoters find it on their dashboard and on My page, with a QR code', async () => {
    const dashboard = await promoter.client.page('/');
    expect(dashboard).toContain('class="card page-card"');
    expect(dashboard).toContain(`value="${server.url}/p/${alias}"`);
    expect(dashboard).toContain('<a href="/page">My page</a>');

    const page = await promoter.client.page('/page');
    expect(page).toContain(`value="${server.url}/p/${alias}"`);
    expect(page).toContain(`href="/p/${alias}"`);
    expect(text(page)).toContain('Warehouse Night with the code NOVA');
    expect(text(page)).toContain('your photo, your Instagram (@nova.star)');

    const qr = await promoter.client.get('/page/qr.png');
    expect(qr.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await qr.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');

    // Signed out: nothing but the public page.
    expect(location(await visitor.get('/page'))).toStartWith('/login');
    expect(location(await visitor.get('/page/qr.png'))).toStartWith('/login');
    // Not on an admin's view of their dashboard.
    expect(await admin.page(`/admin/promoters/${promoter.id}/view`)).not.toContain('page-card');
  });

  test('a promoter can hide it and bring it back', async () => {
    expect(location(await promoter.client.post('/page/visibility', { hidden: '1' }))).toBe('/page?ok=page_hidden');
    expect((await visitor.get(`/p/${alias}`)).status).toBe(404);
    expect((await visitor.get(`/p/${alias}/cover/1`)).status).toBe(404);
    expect((await visitor.get(`/p/${alias}/avatar`)).status).toBe(404);
    expect(await promoter.client.page('/')).not.toContain('page-card');
    expect(text(await promoter.client.page('/page'))).toContain('Your page is hidden');

    // From another site, the change is refused.
    expect((await promoter.client.post('/page/visibility', { hidden: '0' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await visitor.get(`/p/${alias}`)).status).toBe(404);

    expect(location(await promoter.client.post('/page/visibility', { hidden: '0' }))).toBe('/page?ok=page_shown');
    expect((await visitor.get(`/p/${alias}`)).status).toBe(200);
  });
});
