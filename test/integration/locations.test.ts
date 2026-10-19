import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/*
 * Promoters' cities: suggestions from the bundled list of places, a reminder until one is set, and the
 * heat maps (admin dashboard: everyone; team page: the team lead's team).
 */
describeIntegration('promoter locations', () => {
  let server: Server;
  let admin: Client;
  let lead: Awaited<ReturnType<typeof newPromoter>>;
  let ana: Awaited<ReturnType<typeof newPromoter>>;
  let outsider: Awaited<ReturnType<typeof newPromoter>>;
  let sneaky: Awaited<ReturnType<typeof newPromoter>>;

  const setCity = async (p: { client: Client }, city: string) => {
    const account = await p.client.page('/account');
    const form = new FormData();
    form.set('alias', account.match(/name="alias" value="([^"]+)"/)![1]!);
    form.set('theme', 'system');
    form.set('city', city);
    expect(location(await p.client.request('/account/profile', { method: 'POST', body: form }))).toBe('/account?ok=saved');
  };
  const mapData = (html: string) => {
    const raw = html.match(/data-promoter-map="([^"]*)"/)?.[1];
    return raw ? (JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'")) as { label: string; people: { name: string; href: string }[] }[]) : null;
  };
  const adminRow = async (name: string) => {
    const html = await admin.page('/admin');
    return text(html.slice(html.indexOf(name), html.indexOf('</tr>', html.indexOf(name))));
  };

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    lead = await newPromoter(server, admin, { name: `Lea ${uid()}`, codes: 'DJMAX' });
    ana = await newPromoter(server, admin, { name: `Ana ${uid()}`, codes: 'LUNA' });
    outsider = await newPromoter(server, admin, { name: `Oz ${uid()}`, codes: 'NOVA' });
    sneaky = await newPromoter(server, admin, { name: `<img src=x onerror=alert(1)> ${uid()}`, codes: '' });
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '1' });
    await admin.post(`/admin/promoters/${ana.id}/team`, { team_lead_id: String(lead.id) });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('without a city: a reminder on their dashboard, and a flag for admins', async () => {
    const html = await ana.client.page('/');
    expect(text(html)).toContain('Add your city');
    expect(html).toContain('href="/account#city">Add my city');
    expect(await adminRow(ana.name)).toContain('No city');
  });

  test('the city field suggests places from the app’s own list', async () => {
    const account = await ana.client.page('/account');
    expect(account).toMatch(/<input id="city" name="city"[^>]*data-places="\/places\.json\?v=[0-9a-f]{10}"/);
    expect(await ana.client.page('/welcome?step=2')).toContain('data-places="/places.json?v=');
    const list = await new Client(server).get(account.match(/data-places="([^"]+)"/)![1]!);
    expect(list.status).toBe(200);
    expect(list.headers.get('content-type')).toBe('application/json');
    expect(list.headers.get('cache-control')).toContain('immutable');
    const places = (await list.json()) as [string, string, number, number, number][];
    expect(places.length).toBeGreaterThan(2000);
    expect(places.some(([name, province]) => name === 'Montréal' && province === 'QC')).toBe(true);
  });

  test('a city typed loosely is saved the way the list writes it, and the reminder goes away', async () => {
    await setCity(ana, 'montreal');
    expect(await ana.client.page('/account')).toContain('value="Montréal, QC"');
    expect(text(await ana.client.page('/'))).not.toContain('Add your city');
    expect(await adminRow(ana.name)).not.toContain('No city');
    // Not in the list: kept as typed.
    await setCity(outsider, 'Atlantis');
    expect(await outsider.client.page('/account')).toContain('value="Atlantis"');
    await setCity(lead, 'Laval, Québec');
    await setCity(sneaky, '<script>alert(1)</script>');
  });

  test('the admin dashboard maps everyone, and lists who is missing', async () => {
    const html = await admin.page('/admin/dashboard');
    const points = mapData(html)!;
    expect(points.map((p) => p.label).sort()).toEqual(['Laval, QC', 'Montréal, QC']);
    expect(points.find((p) => p.label === 'Montréal, QC')!.people).toEqual([{ name: ana.name, href: `/admin/promoters/${ana.id}` }]);
    // Each place opens to its promoters in the list under the map too, with links to their page.
    const montreal = html.slice(html.indexOf('data-place="Montréal, QC"'), html.indexOf('</details>', html.indexOf('data-place="Montréal, QC"')));
    expect(montreal).toContain(`href="/admin/promoters/${ana.id}"`);
    expect(text(montreal)).toContain(ana.name);
    expect(html).toMatch(/<script src="\/vendor\/leaflet\.js\?v=[0-9a-f]{10}" defer=""><\/script>/);
    expect(html).toContain('<script src="/map.js" defer=""></script>');
    expect(text(html)).toContain('City not found on the map');
    expect(text(html)).toContain(`${outsider.name} (Atlantis)`);
    // Names and cities are text, never markup.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
  });

  test('a team lead sees their team on the map; promoters on the team do not get a map', async () => {
    const mine = await lead.client.page('/team');
    expect(text(mine)).toContain('Where your team is');
    const people = mapData(mine)!.flatMap((p) => p.people);
    expect(people.map((p) => p.name).sort()).toEqual([ana.name, lead.name].sort());
    // Links to each promoter's dashboard under My team; the team lead's own is their dashboard.
    expect(people.find((p) => p.name === ana.name)!.href).toBe(`/team/${ana.id}`);
    expect(people.find((p) => p.name === lead.name)!.href).toBe('/');
    expect(mine).not.toContain(outsider.name);
    const member = await ana.client.page('/team');
    expect(mapData(member)).toBeNull();
    // Admins looking at the team see it too.
    expect(mapData(await admin.page(`/admin/teams/${lead.id}`))).not.toBeNull();
  });

  test('the map library is served by the app, and the tiles are allowed', async () => {
    for (const file of ['leaflet.js', 'leaflet-heat.js', 'leaflet.css']) {
      const res = await new Client(server).get(`/vendor/${file}?v=1`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('immutable');
    }
    for (const bad of ['package.json', '..%2Fpackage.json', 'leaflet-src.js']) expect((await new Client(server).get(`/vendor/${bad}`)).status).toBe(404);
    expect((await new Client(server).get('/map.js')).status).toBe(200);
    const csp = (await admin.get('/admin/dashboard')).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("img-src 'self' data: https://tile.openstreetmap.org");
    expect(csp).toContain("script-src 'self'");
  });
});
