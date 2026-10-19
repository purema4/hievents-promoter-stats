import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, startServer, type Server } from './harness';

/*
 * The app icons are linked by a versioned address everywhere (pages, manifest, service worker), so a new
 * icon reaches browsers and installed apps instead of a stored copy of the old one.
 */
describeIntegration('app icons', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer();
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('pages, the manifest and the service worker link the same versioned icons', async () => {
    const client = new Client(server);
    const page = await (await client.get('/login')).text();
    const version = page.match(/<link rel="icon" href="\/icon\.svg\?v=([0-9a-f]{10})"/)?.[1];
    expect(version).toBeDefined();
    expect(page).toContain(`<link rel="apple-touch-icon" href="/icon-180.png?v=${version}"`);

    const manifest = (await (await client.get('/manifest.webmanifest')).json()) as { id: string; icons: { src: string }[] };
    // The id stays put: installed apps update in place instead of counting as a new app.
    expect(manifest.id).toBe('/');
    expect(manifest.icons.length).toBeGreaterThan(3);
    for (const icon of manifest.icons) {
      expect(icon.src).toEndWith(`?v=${version}`);
      const res = await client.get(icon.src);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toStartWith('image/');
    }

    const sw = await (await client.get('/sw.js')).text();
    expect(sw).toContain(`'/icon-192.png?v=${version}'`);
    expect(sw).toContain(`badge: '/badge-96.png?v=${version}'`);
    expect(sw).not.toContain('__ICON_VERSION__');
  });
});
