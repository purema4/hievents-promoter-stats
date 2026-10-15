import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, type Server } from './harness';

/*
 * Short links through a fake Kutt that answers like Kutt's API v2: X-API-KEY, POST /links (with
 * customurl and reuse), PATCH /links/:id, GET /links. Seeded event 1 is "Warehouse Night" and the
 * promoter's code for it is DJMAX.
 */
const API_KEY = 'kutt-secret-key-0123456789';
const SITE = 'https://tickets.example.test';

type FakeLink = { id: string; address: string; target: string; visit_count: number; description?: string };
type Mode = 'ok' | 'down' | 'slow' | 'bad-link' | 'redirect';

function fakeKutt() {
  const links = new Map<string, FakeLink>();
  const requests: { method: string; path: string; body: Record<string, unknown> | null; apiKey: string | null }[] = [];
  const state = { mode: 'ok' as Mode };
  const thief: { hits: number } = { hits: 0 };
  // Where the "redirect" mode points: it must never be reached.
  const elsewhere = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      thief.hits++;
      return Response.json({ id: crypto.randomUUID(), link: 'https://evil.test/x' }, { status: 201 });
    },
  });
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const shown = (l: FakeLink) => ({ ...l, link: `https://short.test/${l.address}` });
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === 'GET' ? null : ((await req.json().catch(() => null)) as Record<string, unknown> | null);
      requests.push({ method: req.method, path: url.pathname + url.search, body, apiKey: req.headers.get('x-api-key') });
      if (state.mode === 'down') return json({ error: 'An error occurred.' }, 503);
      if (state.mode === 'slow') await Bun.sleep(8000);
      if (state.mode === 'redirect') return new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${elsewhere.port}${url.pathname}` } });
      if (req.headers.get('x-api-key') !== API_KEY) return json({ error: 'Unauthorized' }, 401);
      if (req.method === 'POST' && url.pathname === '/api/v2/links') {
        const target = String(body?.target ?? '');
        if (body?.reuse) {
          const same = [...links.values()].find((l) => l.target === target);
          if (same) return json(shown(same));
        }
        const address = typeof body?.customurl === 'string' ? body.customurl : Math.random().toString(36).slice(2, 8);
        // Kutt reports a taken address as a 500.
        if ([...links.values()].some((l) => l.address === address)) return json({ error: 'Custom URL is already in use.' }, 500);
        const link: FakeLink = { id: crypto.randomUUID(), address, target, visit_count: 0, description: String(body?.description ?? '') };
        links.set(link.id, link);
        if (state.mode === 'bad-link') return json({ ...shown(link), link: 'javascript:alert(1)' }, 201);
        return json(shown(link), 201);
      }
      const edit = url.pathname.match(/^\/api\/v2\/links\/([0-9a-f-]{36})$/);
      if (req.method === 'PATCH' && edit) {
        const link = links.get(edit[1]!);
        if (!link) return json({ error: 'Link was not found.' }, 500);
        if (link.target === body?.target) return json({ error: 'Should at least update one field.' }, 400);
        link.target = String(body?.target);
        return json(shown(link));
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/links') {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 50);
        const skip = Number(url.searchParams.get('skip') ?? 0);
        const all = [...links.values()];
        return json({ limit, skip, total: all.length, data: all.slice(skip, skip + limit).map(shown) });
      }
      return json({ error: 'Not found' }, 404);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    links,
    requests,
    state,
    thief,
    created: () => requests.filter((r) => r.method === 'POST'),
    stop: () => Promise.all([server.stop(true), elsewhere.stop(true)]),
  };
}

type Kutt = ReturnType<typeof fakeKutt>;

const startWithKutt = (kutt: Kutt, extra: Record<string, string> = {}) =>
  startServer({ HIEVENTS_PUBLIC_URL: SITE, KUTT_URL: kutt.url, KUTT_API_KEY: API_KEY, KUTT_CLICKS_MINUTES: '0', ...extra });

/** The link in a page's first copy field. */
const sharedLink = (html: string) => html.match(/<div class="link-field"><input readonly="" value="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');

describeIntegration('short links through Kutt', () => {
  let kutt: Kutt;
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    kutt = fakeKutt();
    server = await startWithKutt(kutt);
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
    await kutt?.stop();
  });

  test('a promoter shares a readable short link that leads to their full link', async () => {
    const html = await promoter.client.page('/events/1');
    const created = kutt.created();
    expect(created.length).toBe(1);
    const body = created[0]!.body!;
    const alias = new URL(String(body.target)).searchParams.get('aff')!;
    expect(alias).toMatch(/^promoter-/);
    expect(body.target).toBe(`${SITE}/event/1/warehouse-night?promo_code=DJMAX&aff=${alias}`);
    expect(body.customurl).toBe(`warehouse-night-${alias}`);
    expect(body.reuse).toBe(true);
    expect(created[0]!.apiKey).toBe(API_KEY);
    expect(sharedLink(html)).toBe(`https://short.test/warehouse-night-${alias}`);
    expect(text(html)).toContain('0 clicks on this link');
  });

  test('the short link is made once and reused, also on the dashboard card', async () => {
    const before = kutt.created().length;
    await promoter.client.page('/events/1');
    const dashboard = await promoter.client.page('/');
    expect(kutt.created().length).toBe(before + 2); // the other upcoming events (2 and 3), not event 1 again
    expect(dashboard).toContain('data-copy-text="https://short.test/warehouse-night-');
    // No link for the past event (4).
    expect(kutt.created().some((r) => String(r.body?.target).includes('/event/4/'))).toBe(false);
  });

  test('click counts come from Kutt', async () => {
    for (const link of kutt.links.values()) if (link.address.startsWith('warehouse-night-')) link.visit_count = 42;
    expect(text(await promoter.client.page('/events/1'))).toContain('42 clicks on this link');
  });

  test('a new link format points the same short link at the new address', async () => {
    const shortBefore = sharedLink(await promoter.client.page('/events/1'));
    const saved = await admin.post('/admin/links', { base_url: SITE, template: '{event_url}?aff={alias}&promo_code={code}&utm_source=promoter' });
    expect(location(saved)).toBe('/admin/links?ok=saved');
    const html = await promoter.client.page('/events/1');
    expect(sharedLink(html)).toBe(shortBefore!);
    const patch = kutt.requests.filter((r) => r.method === 'PATCH').at(-1)!;
    expect(String(patch.body?.target)).toEndWith('&promo_code=DJMAX&utm_source=promoter');
    const link = [...kutt.links.values()].find((l) => `https://short.test/${l.address}` === shortBefore)!;
    expect(link.target).toBe(String(patch.body?.target));
  });

  test('a taken address gets a number; a link deleted in Kutt is made again', async () => {
    const other = await newPromoter(server, admin, { codes: 'LUNA' });
    // Take the address the next promoter would get.
    const alias = (await other.client.page('/account')).match(/name="alias" value="([^"]+)"/)?.[1] ?? '';
    expect(alias).not.toBe('');
    kutt.links.set(crypto.randomUUID(), { id: crypto.randomUUID(), address: `warehouse-night-${alias}`, target: 'https://elsewhere.test', visit_count: 0 });
    expect(sharedLink(await other.client.page('/events/1'))).toBe(`https://short.test/warehouse-night-${alias}-2`);

    for (const [id, link] of kutt.links) if (link.address === `warehouse-night-${alias}-2`) kutt.links.delete(id);
    // A changed alias changes the long link, so the dashboard tries to update the deleted short link.
    expect(location(await other.client.post('/account/profile', { alias: `${alias}-new` }))).toBe('/account?ok=saved');
    const html = await other.client.page('/events/1');
    expect(sharedLink(html)).toMatch(/^https:\/\/short\.test\/warehouse-night-/);
    expect([...kutt.links.values()].some((l) => l.target.includes(`aff=${alias}-new`))).toBe(true);
  });

  test('admins see that short links are on; the API key never reaches a page or the logs', async () => {
    const page = await admin.page('/admin/links');
    expect(text(page)).toContain('On: promoters share short links from 127.0.0.1');
    for (const html of [page, await promoter.client.page('/'), await promoter.client.page('/events/1'), await admin.page(`/admin/promoters/${promoter.id}`)]) {
      expect(html).not.toContain(API_KEY);
    }
    expect(server.logs()).not.toContain(API_KEY);
  });
});

describeIntegration('short links when Kutt misbehaves', () => {
  const servers: Server[] = [];
  const kutts: Kutt[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.stop()));
    await Promise.all(kutts.map((k) => k.stop()));
  });

  async function setup(mode: Mode) {
    const kutt = fakeKutt();
    kutt.state.mode = mode;
    const server = await startWithKutt(kutt);
    kutts.push(kutt);
    servers.push(server);
    const admin = await signInAdmin(server);
    const promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
    return { kutt, server, admin, promoter };
  }

  const isLongLink = (link: string | undefined) => expect(link).toStartWith(`${SITE}/event/1/warehouse-night?promo_code=DJMAX&aff=`);

  test('Kutt down: the long link, and Kutt is left alone for a while', async () => {
    const { kutt, admin, promoter } = await setup('down');
    isLongLink(sharedLink(await promoter.client.page('/events/1')));
    const calls = kutt.requests.length;
    kutt.state.mode = 'ok';
    isLongLink(sharedLink(await promoter.client.page('/events/1')));
    await promoter.client.page('/');
    expect(kutt.requests.length).toBe(calls);
    expect(text(await admin.page('/admin/links'))).toContain('Kutt last failed');
  });

  test('a slow Kutt does not hold the page up', async () => {
    const { promoter } = await setup('slow');
    const started = Date.now();
    isLongLink(sharedLink(await promoter.client.page('/events/1')));
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('a short link that is not a web address is never shown', async () => {
    const { promoter, admin } = await setup('bad-link');
    const html = await promoter.client.page('/events/1');
    isLongLink(sharedLink(html));
    expect(html).not.toContain('javascript:');
    expect(text(await admin.page('/admin/links'))).toContain('not a link');
  });

  test('redirects are not followed, so the API key stays with Kutt', async () => {
    const { kutt, promoter } = await setup('redirect');
    isLongLink(sharedLink(await promoter.client.page('/events/1')));
    expect(kutt.requests.length).toBeGreaterThan(0);
    expect(kutt.thief.hits).toBe(0);
  });

  test('a wrong API key: the long link, and the admin is told', async () => {
    const kutt = fakeKutt();
    const server = await startServer({ HIEVENTS_PUBLIC_URL: SITE, KUTT_URL: kutt.url, KUTT_API_KEY: 'not-the-key' });
    kutts.push(kutt);
    servers.push(server);
    const admin = await signInAdmin(server);
    const promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
    isLongLink(sharedLink(await promoter.client.page('/events/1')));
    expect(text(await admin.page('/admin/links'))).toContain('the API key was refused');
  });
});

describeIntegration('without Kutt', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer({ HIEVENTS_PUBLIC_URL: SITE });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('promoters get the long links and admins see how to turn short links on', async () => {
    const admin = await signInAdmin(server);
    const promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
    const html = await promoter.client.page('/events/1');
    expect(sharedLink(html)).toStartWith(`${SITE}/event/1/warehouse-night?promo_code=DJMAX&aff=`);
    expect(text(html)).not.toContain('clicks on this link');
    expect(text(await admin.page('/admin/links'))).toContain('Off. To give promoters short links');
  });
});
