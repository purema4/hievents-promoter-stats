import { afterAll, beforeAll, expect, test } from 'bun:test';
import { bytes, has, jpg, phoneJpeg, pngSized } from '../fixtures/images';
import { Client, createPromoter, describeIntegration, location, newPromoter, signInAdmin, signInPromoter, startServer, text, uid, type Server } from './harness';

/*
 * Profile photos: a step of the welcome steps, a reminder on the dashboard until there is one, and a
 * "No photo" flag for admins on All promoters.
 */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

function photoForm(bytes: Uint8Array<ArrayBuffer> | null, type = 'image/png') {
  const form = new FormData();
  if (bytes) form.set('photo', new File([bytes], 'me.png', { type }));
  return form;
}

describeIntegration('profile photos', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;

  const reminder = 'Add your profile photo';
  // The promoter's row on All promoters.
  const adminRow = async (name: string) => {
    const html = await admin.page('/admin');
    const start = html.indexOf(name);
    return html.slice(start, html.indexOf('</tr>', start));
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('without a photo: a reminder on their dashboard, and a flag for admins', async () => {
    const dashboard = text(await maya.client.page('/'));
    expect(dashboard).toContain(reminder);
    expect(await maya.client.page('/')).toContain('href="/account">Add my photo');
    expect(text(await adminRow(maya.name))).toContain('No photo');
    // Admins viewing their dashboard see it as it is, without the reminder.
    expect(text(await admin.page(`/admin/promoters/${maya.id}/view`))).not.toContain(reminder);
  });

  test('the photo is a welcome step, between About you and Get the app', async () => {
    const promoter = await createPromoter(admin, { name: `Nova ${uid()}`, codes: 'NOVA' });
    const client = await signInPromoter(server, admin, promoter, false);
    expect(location(await client.get('/'))).toBe('/welcome');
    const step = await client.page('/welcome?step=3');
    expect(text(step)).toContain('Your photo');
    expect(text(step)).toContain('No photo yet.');
    expect(step).toContain('aria-label="Step 3 of 4"');
    expect(step).toContain('href="/welcome?step=4">Skip for now');
    expect(step).toMatch(/<input type="file" name="photo"[^>]*required/);
    expect(text(await client.page('/welcome?step=4'))).toContain('Get the app');
    expect(await client.page('/welcome?step=4')).toContain('href="/welcome?step=3">Back');

    // Nothing chosen, a file that is not an image, a photo over the size limit.
    expect(location(await client.request('/welcome/photo', { method: 'POST', body: photoForm(null) }))).toBe('/welcome?step=3&error=photo_missing');
    expect(text(await client.page('/welcome?step=3&error=photo_missing'))).toContain('Choose a photo, or skip this step for now.');
    const notImage = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(location(await client.request('/welcome/photo', { method: 'POST', body: photoForm(notImage, 'image/png') }))).toBe('/welcome?step=3&error=photo_type');
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(png);
    expect(location(await client.request('/welcome/photo', { method: 'POST', body: photoForm(big) }))).toBe('/welcome?step=3&error=photo_size');
    // Far over every limit: back to the same step, not to an admin page. The server answers without reading
    // the upload and closes the connection, so the test's fetch must not keep it for the next request.
    const huge = new Uint8Array(6 * 1024 * 1024);
    const refused = await client.request('/welcome/photo', { method: 'POST', body: photoForm(huge), keepalive: false });
    expect(location(refused)).toBe('/welcome?step=3&error=photo_size');
    expect(refused.headers.get('connection')).toBe('close');
    expect(text(await adminRow(promoter.name))).toContain('No photo');

    // A real photo: on to the last step.
    expect(location(await client.request('/welcome/photo', { method: 'POST', body: photoForm(png) }))).toBe('/welcome?step=4');
    const again = await client.page('/welcome?step=3');
    expect(text(again)).toContain('Looking good');
    expect(again).not.toMatch(/<input type="file" name="photo"[^>]*required/);
    // With a photo, Next goes on without a new one.
    expect(location(await client.request('/welcome/photo', { method: 'POST', body: photoForm(null) }))).toBe('/welcome?step=4');

    expect(location(await client.post('/welcome/done'))).toBe('/');
    expect(text(await client.page('/'))).not.toContain(reminder);
    expect(text(await adminRow(promoter.name))).not.toContain('No photo');
  });

  test('the reminder goes away once they add one on Account', async () => {
    const account = await maya.client.page('/account');
    const form = photoForm(png);
    form.set('alias', account.match(/name="alias" value="([^"]+)"/)![1]!);
    form.set('theme', 'system');
    expect(location(await maya.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
    expect(text(await maya.client.page('/'))).not.toContain(reminder);
  });

  test('a photo far over the limit on Account goes back to Account', async () => {
    const res = await maya.client.request('/account/profile', { method: 'POST', body: photoForm(new Uint8Array(6 * 1024 * 1024)), keepalive: false });
    expect(location(res)).toBe('/account?error=photo_size');
  });

  test('only for the signed-in promoter, from the app itself', async () => {
    expect(location(await new Client(server).request('/welcome/photo', { method: 'POST', body: photoForm(png) }))).toBe('/login');
    const cross = await maya.client.request('/welcome/photo', { method: 'POST', body: photoForm(png), origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
  });
});

describeIntegration('photos set by admins, and image safety', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;

  const upload = (client: Client, path: string, image: Uint8Array<ArrayBuffer>, field = 'photo', extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set(field, new File([image], 'photo.jpg', { type: 'image/jpeg' }));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return client.request(path, { method: 'POST', body: form });
  };
  const storedPhoto = async (userId: number) => new Uint8Array(await (await admin.get(`/avatar/${userId}`)).arrayBuffer());

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('an admin sets a promoter’s photo; they are told and can replace it', async () => {
    const page = await admin.page(`/admin/promoters/${maya.id}`);
    expect(page).toContain(`action="/admin/promoters/${maya.id}/photo"`);
    expect(text(page)).toContain('No photo yet');
    expect(location(await upload(admin, `/admin/promoters/${maya.id}/photo`, phoneJpeg(6)))).toBe(`/admin/promoters/${maya.id}?ok=photo_set#photo`);
    expect(text(await admin.page(`/admin/promoters/${maya.id}`))).toContain('Set by the team.');
    expect(text(await maya.client.page('/'))).not.toContain('Add your profile photo');
    expect(text(await maya.client.page('/notifications'))).toContain('The team set your profile photo');
    expect(text(await maya.client.page('/account'))).toContain('A photo the team chose for you');
    // The admin's list no longer flags them.
    const list = await admin.page('/admin');
    const row = list.slice(list.indexOf(maya.name), list.indexOf('</tr>', list.indexOf(maya.name)));
    expect(text(row)).not.toContain('No photo');
  });

  test('what is stored has no location or other metadata, and is served as an image only', async () => {
    const res = await admin.get(`/avatar/${maya.id}`);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const stored = await storedPhoto(maya.id);
    expect(has(stored, 'SECRET')).toBe(false);
    expect(has(stored, 'GPS')).toBe(false);
    expect([...stored.subarray(stored.length - 2)]).toEqual([0xff, 0xd9]);
    // Their own upload on Account is cleaned the same way.
    const account = await maya.client.page('/account');
    const form = new FormData();
    form.set('photo', new File([phoneJpeg(1)], 'me.jpg', { type: 'image/jpeg' }));
    form.set('alias', account.match(/name="alias" value="([^"]+)"/)![1]!);
    form.set('theme', 'system');
    expect(location(await maya.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
    expect(has(await storedPhoto(maya.id), 'SECRET')).toBe(false);
    expect(text(await admin.page(`/admin/promoters/${maya.id}`))).toContain('Uploaded by them.');
  });

  test('removed by an admin', async () => {
    expect(location(await admin.post(`/admin/promoters/${maya.id}/photo/remove`))).toBe(`/admin/promoters/${maya.id}?ok=photo_removed#photo`);
    expect((await admin.get(`/avatar/${maya.id}`)).status).toBe(404);
    expect(text(await maya.client.page('/'))).toContain('Add your profile photo');
  });

  test('refused: not an image, too many pixels, too big', async () => {
    const back = `/admin/promoters/${maya.id}`;
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(location(await upload(admin, `${back}/photo`, svg))).toBe(`${back}?error=photo_type#photo`);
    expect(location(await upload(admin, `${back}/photo`, pngSized(8000, 8000)))).toBe(`${back}?error=photo_pixels#photo`);
    expect(location(await upload(maya.client, '/welcome/photo', pngSized(20_000, 20_000)))).toBe('/welcome?step=3&error=photo_pixels');
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(jpg);
    expect(location(await upload(admin, `${back}/photo`, big))).toBe(`${back}?error=photo_size#photo`);
    const huge = new Uint8Array(6 * 1024 * 1024);
    const form = new FormData();
    form.set('photo', new File([huge], 'huge.jpg'));
    const refused = await admin.request(`${back}/photo`, { method: 'POST', body: form, keepalive: false });
    expect(location(refused)).toBe(`${back}?error=photo_size#photo`);
    // Nothing was stored.
    expect((await admin.get(`/avatar/${maya.id}`)).status).toBe(404);
    // An empty form.
    expect(location(await admin.request(`${back}/photo`, { method: 'POST', body: new FormData() }))).toBe(`${back}?error=photo_type#photo`);
  });

  test('the logo is checked and cleaned the same way', async () => {
    const brand = { name: 'Brand', accent: '#2f5bea', login_message: '', footer: '' };
    expect(location(await upload(admin, '/admin/branding', pngSized(9000, 10), 'logo', brand))).toBe('/admin/branding?error=logo_pixels');
    expect(location(await upload(admin, '/admin/branding', phoneJpeg(1), 'logo', brand))).toBe('/admin/branding?ok=saved');
    const logo = new Uint8Array(await (await new Client(server).get('/brand/logo')).arrayBuffer());
    expect(has(logo, 'SECRET')).toBe(false);
  });

  test('only admins set someone else’s photo, from the app itself', async () => {
    expect((await upload(maya.client, `/admin/promoters/${maya.id}/photo`, jpg)).status).toBe(403);
    expect((await maya.client.post(`/admin/promoters/${maya.id}/photo/remove`)).status).toBe(403);
    const form = new FormData();
    form.set('photo', new File([jpg], 'x.jpg'));
    const cross = await admin.request(`/admin/promoters/${maya.id}/photo`, { method: 'POST', body: form, origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    expect((await admin.post('/admin/promoters/999999/photo/remove')).status).toBe(404);
  });

  test('at most 20 uploads per person per hour', async () => {
    const results: (string | null)[] = [];
    for (let i = 0; i < 22; i++) results.push(location(await upload(admin, `/admin/promoters/${maya.id}/photo`, jpg)));
    expect(results.filter((l) => l?.includes('error=photo_rate')).length).toBeGreaterThan(0);
    expect(results.at(-1)).toBe(`/admin/promoters/${maya.id}?error=photo_rate#photo`);
    expect(text(await admin.page(`/admin/promoters/${maya.id}?error=photo_rate`))).toContain('Too many photos uploaded in the last hour');
    // Someone else can still upload.
    const page = await maya.client.page('/account');
    const form = new FormData();
    form.set('photo', new File([jpg], 'me.jpg'));
    form.set('alias', page.match(/name="alias" value="([^"]+)"/)![1]!);
    form.set('theme', 'system');
    expect(location(await maya.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
  });
});
