import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * A media drive per event, from Promoters → Media drives. From dev/seed.sql: DJMAX is on Warehouse Night
 * (event 1, upcoming), Winter Opening (event 2, upcoming) and Summer Rooftop (event 4, over); LUNA only on event 1.
 */
describeIntegration('media drives', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let luna: Awaited<ReturnType<typeof newPromoter>>;
  const drive = 'https://drive.google.com/drive/folders/warehouse-night';
  const rooftop = 'https://www.dropbox.com/sh/summer-rooftop';

  const set = (eventId: number, url: string) => admin.post('/admin/media', { event_id: String(eventId), url });
  const err = async (res: Response) => new URL(location(res)!, server.url).searchParams.get('error');

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    luna = await newPromoter(server, admin, { name: `Luna ${uid()}`, codes: 'LUNA' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('admins see every event with promoter codes, past ones too', async () => {
    expect(await admin.page('/admin')).toContain('<a href="/admin/media">Media drives</a>');
    const html = text(await admin.page('/admin/media'));
    expect(html).toContain('Warehouse Night');
    expect(html).toContain('Summer Rooftop');
    // Nothing set yet: no button for promoters.
    expect(await maya.client.page('/')).not.toContain('Media drive');
  });

  test('a drive on an upcoming event', async () => {
    expect(location(await set(1, drive))).toBe('/admin/media?ok=media_saved#event-1');
    expect(await admin.page('/admin/media')).toContain(`value="${drive}"`);
    const dashboard = await maya.client.page('/');
    expect(dashboard).toContain(`href="${drive}"`);
    const event = await maya.client.page('/events/1');
    expect(event).toContain(`href="${drive}"`);
    expect(text(event)).toContain('Media drive');
    // Only on that event.
    expect(await maya.client.page('/events/2')).not.toContain(drive);
    // Every promoter on the event sees it.
    expect(await luna.client.page('/events/1')).toContain(`href="${drive}"`);
  });

  test('a drive on an event that is over', async () => {
    expect(location(await set(4, rooftop))).toBe('/admin/media?ok=media_saved#event-4');
    expect(await maya.client.page('/')).toContain(`href="${rooftop}"`);
    expect(await maya.client.page('/events/4')).toContain(`href="${rooftop}"`);
    expect(await luna.client.page('/')).not.toContain(rooftop);
  });

  test('what is refused', async () => {
    expect(await err(await set(1, 'http://drive.google.com/x'))).toBe('media_url');
    expect(await err(await set(1, 'javascript:alert(1)'))).toBe('media_url');
    expect(await err(await set(1, 'drive.google.com/x'))).toBe('media_url');
    expect(await err(await set(1, 'https://user:pass@drive.google.com/x'))).toBe('media_url');
    expect(await err(await set(999999, drive))).toBe('media_event');
    // The drive set before is kept.
    expect(await maya.client.page('/events/1')).toContain(`href="${drive}"`);
    // Admins only.
    expect((await maya.client.post('/admin/media', { event_id: '1', url: 'https://evil.example/x' })).status).toBe(403);
    expect((await maya.client.get('/admin/media')).status).toBe(403);
  });

  test('a link cannot break out of the page or run script', async () => {
    const tricks = ['JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/x', 'https://localhost/x', `https://drive.example/${'a'.repeat(2000)}`];
    for (const url of tricks) expect(await err(await set(1, url))).toBe('media_url');
    // Quotes and brackets end up percent-encoded in the link, never as markup.
    expect(location(await set(2, 'https://drive.example/"><script>alert(1)</script>'))).toBe('/admin/media?ok=media_saved#event-2');
    for (const html of [await maya.client.page('/'), await maya.client.page('/events/2'), await admin.page('/admin/media')]) {
      expect(html).toContain('href="https://drive.example/%22%3E%3Cscript%3Ealert(1)%3C/script%3E"');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('rel="noopener noreferrer"');
    }
    await set(2, '');
  });

  test('only the admins, from the app itself', async () => {
    // From another site: refused, nothing saved.
    const res = await admin.post('/admin/media', { event_id: '1', url: 'https://evil.example/x' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await maya.client.page('/events/1')).not.toContain('evil.example');
    // Signed out.
    expect(location(await new Client(server).get('/admin/media'))).toBe('/login');
    // Event ids that are not one of the listed events.
    for (const id of ['1abc', '1.5', '', '-1']) expect(await err(await admin.post('/admin/media', { event_id: id, url: drive }))).toBe('media_event');
  });

  test('removed with an empty link', async () => {
    expect(location(await set(1, ''))).toBe('/admin/media?ok=media_removed#event-1');
    expect(await maya.client.page('/events/1')).not.toContain(drive);
    expect(await luna.client.page('/')).not.toContain('Media drive');
  });
});
