import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, createPromoter, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * The index page, /p: every promoter's page, arranged by admins on Promoter pages → Index page, with
 * their own links, section titles, title, tagline and background.
 */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

describeIntegration('the index page', () => {
  let server: Server;
  let admin: Client;
  let visitor: Client;
  let ana: { id: number; name: string };
  let ben: { id: number; name: string };

  /** The editor's rows, in order: id and text. */
  const rows = async () =>
    [...(await admin.page('/admin/pages/index')).matchAll(/<li class="dir-row[^"]*" data-id="(\d+)">([\s\S]*?)<\/li>/g)].map((m) => ({ id: Number(m[1]), html: m[2]! }));
  const rowOf = async (name: string) => (await rows()).find((r) => text(r.html).includes(name))!;
  /** The names and link texts on /p, in order. */
  const shown = async () => text(await visitor.page('/p'));

  /** The look form, as the editor sends it, with these fields changed. */
  const saveLook = (fields: Record<string, string>, image?: File) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ title: 'Promoters', tagline: '', background: 'brand', color: '#1c1c1a', color2: '#000000', new_promoters: 'show', ...fields })) form.set(k, v);
    if (image) form.set('image', image);
    return admin.request('/admin/pages/index', { method: 'POST', body: form });
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    visitor = new Client(server);
    ana = await createPromoter(admin, { name: `Ana ${uid()}`, codes: 'NOVA' });
    ben = await createPromoter(admin, { name: `Ben ${uid()}`, codes: 'NOVA' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('only admins can arrange it; anyone can open it', async () => {
    const promoter = await newPromoter(server, admin, { codes: 'NOVA' });
    expect((await promoter.client.get('/admin/pages/index')).status).toBe(403);
    expect((await promoter.client.post('/admin/pages/index/add', { kind: 'link', title: 'x', url: 'example.com' })).status).toBe(403);
    expect(location(await visitor.get('/admin/pages/index'))).toStartWith('/login');
    const res = await visitor.get('/p');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    // Both tabs link to each other.
    expect(await admin.page('/admin/pages')).toContain('href="/admin/pages/index"');
    expect(await admin.page('/admin/pages/index')).toContain('<a href="/admin/pages">');
  });

  test('promoters are on it from the start, and can be hidden and shown', async () => {
    expect(await shown()).toContain(ana.name);
    const row = await rowOf(ana.name);
    expect(location(await admin.post(`/admin/pages/index/${row.id}/visibility`, { hidden: '1' }))).toBe('/admin/pages/index?ok=index_saved');
    expect(await shown()).not.toContain(ana.name);
    expect(text((await rowOf(ana.name)).html)).toContain('Not on the page');
    expect(location(await admin.post(`/admin/pages/index/${row.id}/visibility`, { hidden: '0' }))).toBe('/admin/pages/index?ok=index_saved');
    expect(await shown()).toContain(ana.name);
    // Promoters cannot be removed, only hidden.
    expect((await admin.post(`/admin/pages/index/${row.id}/remove`)).status).toBe(404);
  });

  test('links and section titles, in the order dragged', async () => {
    expect(location(await admin.post('/admin/pages/index/add', { kind: 'link', title: 'Our Instagram', url: 'instagram.com/outkzt' }))).toBe('/admin/pages/index?ok=index_added');
    expect(location(await admin.post('/admin/pages/index/add', { kind: 'heading', title: 'Montréal crew' }))).toBe('/admin/pages/index?ok=index_added');
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'not a link', 'https://user:pass@example.com']) {
      expect(location(await admin.post('/admin/pages/index/add', { kind: 'link', title: 'Bad', url }))).toBe('/admin/pages/index?error=index_bad_url');
    }
    expect(location(await admin.post('/admin/pages/index/add', { kind: 'link', title: ' ', url: 'example.com' }))).toBe('/admin/pages/index?error=index_no_title');

    let html = await visitor.page('/p');
    expect(html).toContain('<a class="lp-person" href="https://instagram.com/outkzt"');
    // A section title with nothing under it is left off.
    expect(html).not.toContain('Montréal crew');

    // The title first, then Ben, the link, and Ana; the rest after them.
    const heading = await rowOf('Montréal crew');
    const link = await rowOf('Our Instagram');
    const order = [heading.id, (await rowOf(ben.name)).id, link.id, (await rowOf(ana.name)).id];
    const res = await admin.post('/admin/pages/index/order', { order: order.join(',') });
    expect(await res.json()).toEqual({ ok: true });
    expect((await rows()).slice(0, 4).map((r) => r.id)).toEqual(order);
    html = await shown();
    const at = (s: string) => html.indexOf(s);
    expect(at('Montréal crew')).toBeGreaterThan(-1);
    expect(at('Montréal crew')).toBeLessThan(at(ben.name));
    expect(at(ben.name)).toBeLessThan(at('Our Instagram'));
    expect(at('Our Instagram')).toBeLessThan(at(ana.name));

    // From another site, nothing moves.
    expect((await admin.post('/admin/pages/index/order', { order: [...order].reverse().join(',') }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await rows()).slice(0, 4).map((r) => r.id)).toEqual(order);

    // Edited, then removed.
    expect(location(await admin.post(`/admin/pages/index/${link.id}`, { title: 'Instagram', url: 'https://www.instagram.com/outkzt/' }))).toBe('/admin/pages/index?ok=index_saved');
    expect(await visitor.page('/p')).toContain('href="https://www.instagram.com/outkzt/"');
    expect(location(await admin.post(`/admin/pages/index/${link.id}`, { title: 'Instagram', url: 'javascript:alert(1)' }))).toBe('/admin/pages/index?error=index_bad_url');
    expect(location(await admin.post(`/admin/pages/index/${link.id}/remove`))).toBe('/admin/pages/index?ok=index_removed');
    expect(await shown()).not.toContain('Instagram');
  });

  test('a pasted link shows the promoters: their names, and a picture with their photos', async () => {
    const form = new FormData();
    form.set('photo', new File([png], 'me.png', { type: 'image/png' }));
    expect(location(await admin.request(`/admin/promoters/${ana.id}/photo`, { method: 'POST', body: form }))).toStartWith(`/admin/promoters/${ana.id}?ok=`);
    const html = await visitor.page('/p');
    expect(html).toMatch(new RegExp(`<meta property="og:description" content="[^"]*${ana.name}`));
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)![1]!;
    expect(image).toStartWith(`${server.url}/directory/preview.jpg?v=`);
    expect(html).toContain('<meta property="og:image:width" content="1200"/>');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    const res = await visitor.get(image.slice(server.url.length));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    // A new photo is a new picture, at a new address, so apps fetch it again.
    const again = new FormData();
    again.set('photo', new File([png], 'me.png', { type: 'image/png' }));
    await admin.request(`/admin/promoters/${ana.id}/photo`, { method: 'POST', body: again });
    expect((await visitor.page('/p')).match(/<meta property="og:image" content="([^"]+)"/)![1]).not.toBe(image);
  });

  test('title, tagline and a colour background', async () => {
    expect(location(await saveLook({ title: 'Our <b>crew</b>', tagline: 'Tickets with our codes', background: 'gradient', color: '#FF0066', color2: '#220033' }))).toBe('/admin/pages/index?ok=index_saved');
    const html = await visitor.page('/p');
    expect(html).toContain('Our &lt;b&gt;crew&lt;/b&gt;');
    expect(text(html)).toContain('Tickets with our codes');
    const css = html.match(/href="(\/directory\.css\?v=[^"]+)"/)![1]!;
    const res = await visitor.get(css);
    expect(res.headers.get('content-type')).toStartWith('text/css');
    expect(await res.text()).toContain('linear-gradient(170deg, #ff0066, #220033)');
    expect(location(await saveLook({ color: 'red' }))).toBe('/admin/pages/index?error=bad_color');
    // No photo uploaded yet.
    expect(location(await saveLook({ background: 'image' }))).toBe('/admin/pages/index?error=index_no_image');
  });

  test('a photo background', async () => {
    expect(location(await saveLook({}, new File([png], 'bg.png', { type: 'image/png' })))).toBe('/admin/pages/index?ok=index_saved');
    const css = await (await visitor.get((await visitor.page('/p')).match(/href="(\/directory\.css\?v=[^"]+)"/)![1]!)).text();
    expect(css).toContain('url("/directory/background?v=');
    const image = await visitor.get('/directory/background');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(location(await saveLook({ background: 'image' }, new File([Buffer.from('nope')], 'x.png', { type: 'image/png' })))).toBe('/admin/pages/index?error=background_type');

    const form = new FormData();
    for (const [k, v] of Object.entries({ title: 'Promoters', tagline: '', background: 'image', color: '#1c1c1a', color2: '#000000', new_promoters: 'show', remove_image: '1' })) form.set(k, v);
    expect(location(await admin.request('/admin/pages/index', { method: 'POST', body: form }))).toBe('/admin/pages/index?error=index_no_image');
    expect((await visitor.get('/directory/background')).status).toBe(404);
  });

  test('new promoters can wait for an admin to show them', async () => {
    expect(location(await saveLook({ new_promoters: 'hide' }))).toBe('/admin/pages/index?ok=index_saved');
    const late = await createPromoter(admin, { name: `Late ${uid()}`, codes: 'NOVA' });
    expect(await shown()).not.toContain(late.name);
    const row = await rowOf(late.name);
    expect(text(row.html)).toContain('Not on the page');
    await admin.post(`/admin/pages/index/${row.id}/visibility`, { hidden: '0' });
    expect(await shown()).toContain(late.name);
  });

  test('a promoter who hides their page leaves it too', async () => {
    await saveLook({ new_promoters: 'show' });
    const promoter = await newPromoter(server, admin, { name: `Hider ${uid()}`, codes: 'NOVA' });
    expect(await shown()).toContain(promoter.name);
    await promoter.client.post('/page/visibility', { hidden: '1' });
    expect(await shown()).not.toContain(promoter.name);
    expect(text((await rowOf(promoter.name)).html)).toContain('Page hidden by the promoter');
  });
});
