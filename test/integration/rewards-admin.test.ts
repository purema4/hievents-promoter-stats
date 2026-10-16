import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, type Server } from './harness';

/*
 * Admin-set levels and reward milestones, and the payout button. A promoter with the code DJMAX has
 * 10 tickets in the seed ($28.50 commission), 4 of them for the upcoming "Warehouse Night".
 */
describeIntegration('levels and rewards set by admins', () => {
  let server: Server;
  let admin: Client;
  let promoter: Awaited<ReturnType<typeof newPromoter>>;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    promoter = await newPromoter(server, admin, { codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  // Rows as the form sends them: levels in any order, blank rows included.
  const customRules: [string, string][] = [
    ['level_name', 'Pro'], ['level_at', '5'], ['level_color', 'purple'],
    ['level_name', 'Starter'], ['level_at', '0'], ['level_color', 'gray'],
    ['level_name', ''], ['level_at', ''], ['level_color', 'blue'],
    ['ticket_at', '2'], ['ticket_count', '3'],
    ['ticket_at', ''], ['ticket_count', ''],
    ['ticket_every', '0'], ['ticket_every_count', '1'],
    ['merch_at', '8'], ['merch_count', ''], ['merch_label', 'Hoodie'],
    ['merch_at', ''], ['merch_count', ''], ['merch_label', ''],
    ['merch_every', '0'], ['merch_every_count', '1'], ['merch_every_label', ''],
  ];

  test('promoters get a big payout button on the dashboard and in the menu', async () => {
    const html = await promoter.client.page('/');
    const callout = html.slice(html.indexOf('class="card payout-callout ready"'), html.indexOf('class="grid"'));
    expect(text(callout)).toContain('Ready to request $28.50');
    expect(callout).toContain('<a class="button big" href="/payouts#request">Request my payout</a>');
    expect(text(callout)).toMatch(/Claim \d+ rewards?/);
    expect(html).toContain('<a class="nav-cta" href="/payouts#request">');
    expect(await promoter.client.page('/payouts')).toContain('id="request"');

    // Not on an admin's view of the dashboard, nor in an admin's menu.
    const asAdmin = await admin.page(`/admin/promoters/${promoter.id}/view`);
    expect(asAdmin).not.toContain('payout-callout');
    expect(asAdmin).not.toContain('nav-cta');

    // Nothing earned yet: no callout, the menu button stays.
    const fresh = await newPromoter(server, admin, { codes: 'NOSALES' });
    const empty = await fresh.client.page('/');
    expect(empty).not.toContain('payout-callout');
    expect(empty).toContain('nav-cta');
  });

  test('the defaults until an admin changes them', async () => {
    const page = text(await admin.page('/admin/rewards'));
    expect(page).toContain('Free tickets for each event: 1 free ticket at 1 sale, then 1 free ticket every 5 more sales.');
    expect(page).toContain('Merch: 1 merch item every 50 tickets sold.');
    expect(page).not.toContain('Back to the default levels and rewards');
    expect(await promoter.client.page('/')).toContain('level-c-bronze">Bronze');
  });

  test('admins set levels and milestones; promoters see them at once', async () => {
    expect(location(await admin.post('/admin/rewards', customRules))).toBe('/admin/rewards?ok=rewards_saved');
    const settings = text(await admin.page('/admin/rewards'));
    expect(settings).toContain('Free tickets for each event: 3 free tickets at 2 sales.');
    expect(settings).toContain('Merch: Hoodie at 8 tickets sold.');

    const dashboard = await promoter.client.page('/');
    expect(dashboard).toContain('level-c-purple">Pro');
    expect(text(dashboard)).toContain('Top level: Pro.');
    expect(text(dashboard)).toContain('Hoodie unlocked: request it now');

    const payouts = await promoter.client.page('/payouts');
    expect(text(payouts)).toContain('For each event: 3 free tickets at 2 sales.');
    expect(text(payouts)).toContain('3 free tickets earned');
    expect(payouts).toContain('value="Hoodie, "');
    expect(location(await promoter.client.post('/rewards/merch', { details: 'Hoodie, size M' }))).toBe('/payouts?ok=reward_requested#rewards');

    expect(await admin.page('/admin/dashboard')).toContain('level-c-purple tiny">Pro');
  });

  test('mistakes are explained, and what was typed is kept', async () => {
    const tooHigh = await admin.post('/admin/rewards', [['level_name', 'Gold'], ['level_at', '5'], ['level_color', 'gold']]);
    expect(tooHigh.status).toBe(400);
    const html = await tooHigh.text();
    expect(text(html)).toContain('The first level must start at 0 tickets');
    expect(html).toContain('value="Gold"');

    for (const color of ['url(x)', '']) {
      const res = await admin.post('/admin/rewards', [['level_name', 'Only'], ['level_at', '0'], ['level_color', color]]);
      expect(res.status).toBe(400);
      expect(text(await res.text())).toContain('Pick a color for Only');
    }
    const words = await admin.post('/admin/rewards', [['level_name', 'Only'], ['level_at', 'ten'], ['level_color', 'gold']]);
    expect(text(await words.text())).toContain('must be a whole number');
    const label = await admin.post('/admin/rewards', [...customRules, ['merch_label', '<script>alert(1)</script>']]);
    // A name with no number of tickets is a mistake, shown as plain text.
    expect(label.status).toBe(400);
    expect(await label.text()).not.toContain('<script>alert(1)</script>');

    // Nothing was saved.
    expect(await promoter.client.page('/')).toContain('level-c-purple">Pro');
  });

  test('only admins can change them', async () => {
    const res = await promoter.client.post('/admin/rewards', [['level_name', 'Hacked'], ['level_at', '0'], ['level_color', 'red']]);
    expect(location(res) ?? '').not.toContain('ok=');
    expect((await promoter.client.post('/admin/rewards/reset')).status).not.toBe(200);
    expect(await promoter.client.page('/')).toContain('level-c-purple">Pro');
  });

  test('back to the defaults', async () => {
    expect(text(await admin.page('/admin/rewards'))).toContain('Back to the default levels and rewards');
    expect(location(await admin.post('/admin/rewards/reset'))).toBe('/admin/rewards?ok=rewards_reset');
    expect(await promoter.client.page('/')).toContain('level-c-bronze">Bronze');
  });
});
