import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, type Server } from './harness';

/* Notifications: unread until opened or "Mark all as read", and admins writing to one promoter, a team or everyone. */
describeIntegration('notifications from admins', () => {
  let server: Server;
  let admin: Client;
  let lead: Awaited<ReturnType<typeof newPromoter>>;
  let member: Awaited<ReturnType<typeof newPromoter>>;
  let solo: Awaited<ReturnType<typeof newPromoter>>;
  const send = (fields: Record<string, string>) => admin.post('/admin/notifications', fields);
  const unreadBadge = async (p: { client: Client }) => (await p.client.page('/')).includes('class="nav-count"');

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
    lead = await newPromoter(server, admin, { name: `Lia ${uid()}` });
    member = await newPromoter(server, admin, { name: `Max ${uid()}` });
    solo = await newPromoter(server, admin, { name: `Sol ${uid()}` });
    await admin.post('/admin/teams/lead', { user_id: String(lead.id), lead: '1' });
    await admin.post('/admin/teams/add', { user_id: String(member.id), team_lead_id: String(lead.id) });
    // Start from nothing unread.
    for (const p of [lead, member, solo]) await p.client.post('/notifications/read', {});
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('admins only', async () => {
    expect(await admin.page('/admin')).toContain('href="/admin/notifications"');
    expect((await solo.client.get('/admin/notifications')).status).toBe(403);
    expect((await solo.client.post('/admin/notifications', { to: 'everyone', title: 'x', body: 'y' })).status).toBe(403);
  });

  test('to one promoter', async () => {
    expect(location(await send({ to: 'one', user: String(solo.id), title: 'Hi Sol', body: 'Your codes are ready.', link: '/page' }))).toBe('/admin/notifications?sent=1');
    expect(text(await admin.page('/admin/notifications?sent=1'))).toContain(`To ${solo.name} (1 promoter)`);
    expect(text(await solo.client.page('/notifications'))).toContain('Your codes are ready.');
    expect(text(await member.client.page('/notifications'))).not.toContain('Your codes are ready.');
  });

  test('to a team: its lead and members', async () => {
    expect(location(await send({ to: 'team', lead: String(lead.id), title: 'Team call', body: 'Call at 7 tonight.' }))).toBe('/admin/notifications?sent=2');
    for (const p of [lead, member]) expect(text(await p.client.page('/notifications'))).toContain('Call at 7 tonight.');
    expect(text(await solo.client.page('/notifications'))).not.toContain('Call at 7 tonight.');
  });

  test('to every promoter, not the admins', async () => {
    const res = await send({ to: 'everyone', title: 'New event', body: 'Tickets for the summer party are on sale.' });
    const sent = Number(location(res)!.match(/sent=(\d+)/)![1]);
    expect(sent).toBeGreaterThanOrEqual(3);
    for (const p of [lead, member, solo]) expect(text(await p.client.page('/notifications'))).toContain('Tickets for the summer party are on sale.');
    expect(text(await admin.page('/notifications'))).not.toContain('Tickets for the summer party are on sale.');
  });

  test('what is refused', async () => {
    for (const [fields, error] of [
      [{ to: 'everyone', title: '', body: 'x' }, 'Give it a title'],
      [{ to: 'everyone', title: 'x', body: '' }, 'Write the message'],
      [{ to: 'everyone', title: 'x', body: 'y', link: 'https://evil.example' }, 'The link must be a page of this app'],
      [{ to: 'everyone', title: 'x', body: 'y', link: '//evil.example' }, 'The link must be a page of this app'],
      [{ to: 'team', lead: String(solo.id), title: 'x', body: 'y' }, 'Pick a team.'],
      [{ to: 'one', user: '99999', title: 'x', body: 'y' }, 'Pick a promoter.'],
      [{ to: 'nope', title: 'x', body: 'y' }, 'Pick who it goes to.'],
    ] as const) {
      const res = await send(fields);
      expect(res.status).toBe(400);
      expect(text(await res.text())).toContain(error);
    }
    // What is typed is shown as text.
    const html = await (await send({ to: 'nope', title: '<script>alert(1)</script>', body: 'y' })).text();
    expect(html).not.toContain('<script>alert(1)');
  });

  test('unread until opened or marked as read', async () => {
    // Seeing the list does not mark them as read any more.
    const list = await solo.client.page('/notifications');
    expect(text(list)).toContain('2 unread');
    expect(list).toContain('action="/notifications/read"');
    expect(await unreadBadge(solo)).toBe(true);
    // Opening one marks it, and goes to its link.
    const id = list.match(/href="\/notifications\/(\d+)"[^>]*>\s*<strong>Hi Sol/)![1]!;
    expect(location(await solo.client.get(`/notifications/${id}`))).toBe('/page');
    expect(text(await solo.client.page('/notifications'))).toContain('1 unread');
    // Someone else's: nothing happens.
    expect(location(await member.client.get(`/notifications/${id}`))).toBe('/notifications');
    // All at once.
    expect(location(await solo.client.post('/notifications/read', {}))).toBe('/notifications');
    const after = await solo.client.page('/notifications');
    expect(text(after)).toContain('All read');
    expect(after).not.toContain('action="/notifications/read"');
    expect(await unreadBadge(solo)).toBe(false);
  });
});
