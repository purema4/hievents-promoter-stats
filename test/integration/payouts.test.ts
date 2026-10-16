import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client, describeIntegration, emailsTo, location, newPromoter, signInAdmin, startServer, stats, text, waitForEmail, waitForSubject, type Server } from './harness';

const balanceRow = (html: string, label: string) =>
  html.match(new RegExp(`<td>${label}</td><td class="num">(.*?)</td>`))?.[1]?.replace(/<[^>]*>/g, '');
const available = (html: string) => balanceRow(html, 'Available to request');
const flashError = (html: string) => html.match(/<div class="flash error">([^<]*)<\/div>/)?.[1];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describeIntegration('payouts, rewards and changes by hand', () => {
  let server: Server;
  let admin: Client;

  beforeAll(async () => {
    // Cash is off by default; these tests turn it on.
    server = await startServer({ PAYOUT_METHODS: 'Interac e-Transfer,Cash' });
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  async function addMoney(promoterId: number, amount: string, label = 'Bonus') {
    const res = await admin.post(`/admin/promoters/${promoterId}/adjust`, { kind: 'money', amount, label, notify: '1' });
    expect(location(res)).toBe(`/admin/promoters/${promoterId}?ok=adjusted#adjust`);
  }

  describe('admin changes by hand', () => {
    test('added money raises the balance and the commission, and undo restores both', async () => {
      const p = await newPromoter(server, admin);
      expect(available(await p.client.page('/payouts'))).toBe('$28.50');

      await addMoney(p.id, '40', 'Bonus for the flyers');
      const payouts = await p.client.page('/payouts');
      expect(available(payouts)).toBe('$68.50');
      expect(balanceRow(payouts, 'Added by the team')).toBe('+$40.00');
      expect(text(payouts)).toContain('+$40.00 Bonus for the flyers');
      const cards = stats(await p.client.page('/'));
      expect(cards.get('Commission earned (10%) · incl. +$40.00 from the team')).toBe('$68.50');
      // The promoter was told.
      expect(text(await p.client.page('/notifications'))).toContain('$40.00 added to your balance');

      const undo = (await admin.page(`/admin/promoters/${p.id}`)).match(/action="(\/admin\/promoters\/\d+\/adjust\/\d+\/undo)"/)![1]!;
      expect(location(await admin.post(undo))).toBe(`/admin/promoters/${p.id}?ok=undone#adjust`);
      expect(available(await p.client.page('/payouts'))).toBe('$28.50');
      expect(stats(await p.client.page('/')).get('Commission earned (10%)')).toBe('$28.50');
      // Undoing twice finds nothing.
      expect((await admin.post(undo)).status).toBe(404);
    });

    test('money can be taken away too', async () => {
      const p = await newPromoter(server, admin);
      await addMoney(p.id, '-8.50', 'Correction');
      const payouts = await p.client.page('/payouts');
      expect(available(payouts)).toBe('$20.00');
      expect(balanceRow(payouts, 'Removed by the team')).toBe('−$8.50');
    });

    test('sales outside Hi.Events count for tickets, levels and the balance', async () => {
      const p = await newPromoter(server, admin);
      // $300 in ticket sales: their 10% is $30.
      const res = await admin.post(`/admin/promoters/${p.id}/adjust`, { kind: 'outside_sale', quantity: '15', sales: '300', label: 'Door sales' });
      expect(location(res)).toContain('ok=adjusted');
      const html = await p.client.page('/');
      expect(stats(html).get('Tickets sold, 6 orders · incl. 15 outside Hi.Events · 1 awaiting payment')).toBe('25');
      expect(html).toContain('level-c-silver">Silver'); // 25 tickets
      expect(available(await p.client.page('/payouts'))).toBe('$58.50');
      const admin_ = await admin.page(`/admin/promoters/${p.id}`);
      expect(text(admin_)).toContain('+15 tickets sold ($300.00 in sales)');
      expect(text(admin_)).toContain('Door sales (commission)');

      // Their own rate applies.
      const q = await newPromoter(server, admin, { commission: '15' });
      await admin.post(`/admin/promoters/${q.id}/adjust`, { kind: 'outside_sale', quantity: '2', sales: '100', label: 'Bar' });
      expect(available(await q.client.page('/payouts'))).toBe(money(Math.round(28_50 * 1.5) + 15_00));

      // Tickets only, no sales: no commission.
      await admin.post(`/admin/promoters/${p.id}/adjust`, { kind: 'outside_sale', quantity: '1', sales: '', label: 'Guest list' });
      expect(available(await p.client.page('/payouts'))).toBe('$58.50');
      expect(location(await admin.post(`/admin/promoters/${p.id}/adjust`, { kind: 'outside_sale', quantity: '1', sales: 'lots', label: 'x' }))).toBe(
        `/admin/promoters/${p.id}?error=adjust_amount#adjust`,
      );

      // Undoing the sale takes its commission back too.
      const id = admin_.match(/adjust\/(\d+)\/undo/g)!.map((m) => Number(m.match(/\d+/)![0])).sort((a, b) => a - b)[0]!;
      expect(location(await admin.post(`/admin/promoters/${p.id}/adjust/${id}/undo`))).toContain('ok=undone');
      expect(available(await p.client.page('/payouts'))).toBe('$28.50');
    });

    test('invalid changes are refused with a reason', async () => {
      const p = await newPromoter(server, admin);
      const back = `/admin/promoters/${p.id}`;
      expect(location(await admin.post(`${back}/adjust`, { kind: 'money', amount: '40', label: ' ' }))).toBe(`${back}?error=adjust_reason#adjust`);
      for (const amount of ['abc', '0', '10.555', '20000']) {
        expect(location(await admin.post(`${back}/adjust`, { kind: 'money', amount, label: 'x' }))).toBe(`${back}?error=adjust_amount#adjust`);
      }
      expect(location(await admin.post(`${back}/adjust`, { kind: 'merch', quantity: '1.5', label: 'x' }))).toBe(`${back}?error=adjust_amount#adjust`);
      // Free tickets only for one of their upcoming events.
      expect(location(await admin.post(`${back}/adjust`, { kind: 'free_tickets', event_id: '4', quantity: '1', label: 'x' }))).toBe(`${back}?error=adjust_event#adjust`);
      expect(available(await p.client.page('/payouts'))).toBe('$28.50');
    });
  });

  describe('payout requests', () => {
    const request = (client: Client, amount: string, method = 'Interac e-Transfer') =>
      client.post('/payouts', { currency: 'CAD', amount, method, details: 'max@example.com', note: '' });

    test('cash is paid in $50 steps and never more than the balance', async () => {
      const p = await newPromoter(server, admin);
      // $28.50: not enough for any cash payout.
      let res = await request(p.client, '50', 'Cash');
      expect(res.status).toBe(400);
      expect(flashError(await res.text())).toBe('That is more than your available balance.');

      await addMoney(p.id, '100');
      expect(available(await p.client.page('/payouts'))).toBe('$128.50');
      for (const amount of ['25', '75', '50.50']) {
        res = await request(p.client, amount, 'Cash');
        expect(res.status).toBe(400);
        expect(flashError(await res.text())).toStartWith('Cash is paid in steps of $50');
      }
      res = await request(p.client, '150', 'Cash');
      expect(flashError(await res.text())).toBe('That is more than your available balance.');
      res = await request(p.client, '128.51');
      expect(flashError(await res.text())).toBe('That is more than your available balance.');
      for (const amount of ['abc', '-5', '0', '1.234', '']) {
        res = await request(p.client, amount);
        expect(res.status).toBe(400);
      }
      res = await p.client.post('/payouts', { currency: 'CAD', amount: '10', method: 'Gift card', details: '', note: '' });
      expect(flashError(await res.text())).toBe('Choose how we should pay you.');
      res = await p.client.post('/payouts', { currency: 'USD', amount: '10', method: 'Cash', details: '', note: '' });
      expect(res.status).toBe(400);

      res = await request(p.client, '100', 'Cash');
      expect(location(res)).toBe('/payouts?ok=requested');
      const html = await p.client.page('/payouts');
      expect(available(html)).toBe('$28.50');
      expect(balanceRow(html, 'Requested, not paid yet')).toBe('−$100.00');
    });

    test('two submits at once create one request', async () => {
      const p = await newPromoter(server, admin);
      const results = await Promise.all([request(p.client, '10'), request(p.client, '10'), request(p.client, '5')]);
      expect(results.map((r) => r.status).sort()).toEqual([302, 400, 400]);
      const html = await p.client.page('/payouts');
      expect(html.match(/class="status pending"/g)).toHaveLength(1);
      expect(html).toContain('You have a request waiting.');
      // One open request per currency.
      const again = await request(p.client, '5');
      expect(flashError(await again.text())).toBe('You already have a request waiting for this currency.');
    });

    test('admins are emailed, mark it paid, and the promoter is emailed and can ask again', async () => {
      const p = await newPromoter(server, admin);
      expect(location(await request(p.client, '20'))).toBe('/payouts?ok=requested');
      const adminMail = await waitForSubject(server.adminEmail, `Payout request from ${p.name} (${p.email}): $20.00`);
      expect(adminMail.Text).toContain('Pay with: Interac e-Transfer');
      expect(adminMail.Text).toContain('Send to: max@example.com');

      const queue = await admin.page('/admin/payouts');
      const id = queue.match(new RegExp(`${p.name}[\\s\\S]*?action="/admin/payouts/(\\d+)/paid"`))![1]!;
      // Declining needs a reason.
      expect(location(await admin.post(`/admin/payouts/${id}/reject`, { admin_note: ' ' }))).toBe('/admin/payouts');
      expect(location(await admin.post(`/admin/payouts/${id}/paid`, { admin_note: 'REF-42' }))).toBe('/admin/payouts?ok=payout_paid');
      expect(location(await admin.post(`/admin/payouts/${id}/paid`, { admin_note: 'twice' }))).toBe('/admin/payouts?error=payout_gone');

      const paidMail = await waitForEmail(p.email, 2); // the invite, then this
      expect(paidMail.Subject).toBe('Your payout of $20.00 was sent');
      expect(paidMail.Text).toContain('Reference: REF-42');

      const html = await p.client.page('/payouts');
      expect(balanceRow(html, 'Already paid to you')).toBe('−$20.00');
      expect(available(html)).toBe('$8.50');
      expect(location(await request(p.client, '8.50'))).toBe('/payouts?ok=requested');
    });

    test('a declined amount becomes available again', async () => {
      const p = await newPromoter(server, admin);
      await request(p.client, '28.50');
      expect(available(await p.client.page('/payouts'))).toBe('$0.00');
      const id = (await admin.page('/admin/payouts')).match(new RegExp(`${p.name}[\\s\\S]*?action="/admin/payouts/(\\d+)/reject"`))![1]!;
      expect(location(await admin.post(`/admin/payouts/${id}/reject`, { admin_note: 'Wrong email' }))).toBe('/admin/payouts?ok=payout_rejected');
      const html = await p.client.page('/payouts');
      expect(available(html)).toBe('$28.50');
      expect(text(html)).toContain('Declined');
      expect((await waitForEmail(p.email, 2)).Subject).toBe('About your payout request of $28.50');
    });
  });

  describe('reward requests', () => {
    const ticket = (client: Client, eventId: string, quantity = '1') =>
      client.post('/rewards/ticket', { event_id: eventId, quantity, details: 'Guest +1' });

    test('a free ticket per upcoming event, once; declined ones can be requested again', async () => {
      const p = await newPromoter(server, admin);
      const before = await p.client.page('/payouts');
      expect(before).toContain('action="/rewards/ticket"');

      expect((await ticket(p.client, '1', '2')).status).toBe(400); // 4 sold → 1 earned
      expect(location(await ticket(p.client, '1'))).toBe('/payouts?ok=reward_requested#rewards');
      const again = await ticket(p.client, '1');
      expect(again.status).toBe(400);
      expect(flashError(await again.text())).toBe('That reward is not available any more.');
      // The past event offers nothing.
      expect((await ticket(p.client, '4')).status).toBe(400);
      expect((await ticket(p.client, '999')).status).toBe(400);
      const adminMail = await waitForSubject(server.adminEmail, `Reward request from ${p.name} (${p.email})`);
      expect(adminMail.Text).toContain('Reward: 1 free ticket for Warehouse Night');

      const queue = await admin.page('/admin/payouts');
      const id = queue.match(new RegExp(`${p.name}[\\s\\S]*?action="/admin/rewards/(\\d+)/reject"`))![1]!;
      expect(location(await admin.post(`/admin/rewards/${id}/reject`, { admin_note: 'Guest list closed' }))).toBe('/admin/payouts?ok=reward_rejected');
      expect((await waitForEmail(p.email, 2)).Subject).toBe('About your reward request');
      expect(location(await ticket(p.client, '1'))).toBe('/payouts?ok=reward_requested#rewards');

      const second = (await admin.page('/admin/payouts')).match(new RegExp(`${p.name}[\\s\\S]*?action="/admin/rewards/(\\d+)/fulfil"`))![1]!;
      expect(location(await admin.post(`/admin/rewards/${second}/fulfil`, { admin_note: 'On the list' }))).toBe('/admin/payouts?ok=reward_fulfilled');
      expect(text(await p.client.page('/payouts'))).toContain('Given');
    });

    test('merch needs the item and size, and an unlocked item', async () => {
      const p = await newPromoter(server, admin);
      let res = await p.client.post('/rewards/merch', { details: '' });
      expect(flashError(await res.text())).toBe('Tell us which item and size you would like.');
      res = await p.client.post('/rewards/merch', { details: 'T-shirt L' });
      expect(flashError(await res.text())).toBe('That reward is not available any more.');

      expect(location(await admin.post(`/admin/promoters/${p.id}/adjust`, { kind: 'merch', quantity: '1', label: 'Top seller' }))).toContain('ok=adjusted');
      expect(location(await p.client.post('/rewards/merch', { details: 'T-shirt L' }))).toBe('/payouts?ok=reward_requested#rewards');
      res = await p.client.post('/rewards/merch', { details: 'Cap' });
      expect(res.status).toBe(400);
    });

    test('free tickets given by the team can be requested', async () => {
      const p = await newPromoter(server, admin);
      expect(location(await ticket(p.client, '2'))).toBe('/payouts?ok=reward_requested#rewards');
      expect((await ticket(p.client, '2')).status).toBe(400);
      const res = await admin.post(`/admin/promoters/${p.id}/adjust`, { kind: 'free_tickets', event_id: '2', quantity: '2', label: 'Flyers' });
      expect(location(res)).toContain('ok=adjusted');
      expect(location(await ticket(p.client, '2', '2'))).toBe('/payouts?ok=reward_requested#rewards');
      expect(await emailsTo(p.email)).toHaveLength(1); // only the invite: requests email the admins
    });
  });
});
