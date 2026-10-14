import { describe, expect, test } from 'bun:test';
import {
  addAdjustment,
  adjustmentsByDay,
  adjustmentsFor,
  describeAdjustment,
  findAdjustment,
  freeTicketBonus,
  hasAdjustments,
  merchBonus,
  moneyAdjustments,
  moneyAdjustmentsBetween,
  outsideTickets,
  removeAdjustment,
} from '../../src/adjustments';
import { formatMoney } from '../../src/money';
import { newUser } from './helpers';

const today = () => new Date().toISOString().slice(0, 10);

describe('adjustments', () => {
  test('sums per kind, per currency and per event', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    expect(hasAdjustments(user.id)).toBe(false);
    addAdjustment(admin, user.id, { kind: 'money', amountCents: 4000, currency: 'CAD', label: 'Bonus' });
    addAdjustment(admin, user.id, { kind: 'money', amountCents: -1250, currency: 'CAD', label: 'Correction' });
    addAdjustment(admin, user.id, { kind: 'money', amountCents: 500, label: 'No currency means CAD' });
    addAdjustment(admin, user.id, { kind: 'money', amountCents: 700, currency: 'USD', label: 'Tour' });
    addAdjustment(admin, user.id, { kind: 'tickets_sold', quantity: 12, label: 'Door' });
    addAdjustment(admin, user.id, { kind: 'tickets_sold', quantity: -2, label: 'Door correction' });
    addAdjustment(admin, user.id, { kind: 'free_tickets', quantity: 2, eventId: 7, label: 'Flyers' });
    addAdjustment(admin, user.id, { kind: 'free_tickets', quantity: -1, eventId: 7, label: 'Flyers fix' });
    addAdjustment(admin, user.id, { kind: 'free_tickets', quantity: 1, eventId: 8, label: 'Other' });
    addAdjustment(admin, user.id, { kind: 'merch', quantity: 1, label: 'Top seller' });

    expect(hasAdjustments(user.id)).toBe(true);
    expect(moneyAdjustments(user.id)).toEqual(new Map([['CAD', 3250], ['USD', 700]]));
    expect(outsideTickets(user.id)).toBe(10);
    expect(outsideTickets(user.id, today(), today())).toBe(10);
    expect(outsideTickets(user.id, '2000-01-01', '2000-12-31')).toBe(0);
    expect(moneyAdjustmentsBetween(user.id, today(), today())).toBe(3950);
    expect(freeTicketBonus(user.id)).toEqual(new Map([[7, 1], [8, 1]]));
    expect(merchBonus(user.id)).toBe(1);
    expect(adjustmentsByDay(user.id)).toEqual([{ day: today(), tickets: 10, cents: 3950 }]);
  });

  test('undo removes the entry from every sum', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    const keep = addAdjustment(admin, user.id, { kind: 'money', amountCents: 1000, currency: 'CAD', label: 'Keep' });
    const undo = addAdjustment(admin, user.id, { kind: 'money', amountCents: 4000, currency: 'CAD', label: 'Undo me' });
    expect(moneyAdjustments(user.id).get('CAD')).toBe(5000);
    removeAdjustment(undo);
    expect(findAdjustment(undo)).toBeNull();
    expect(findAdjustment(keep)).toMatchObject({ user_id: user.id, kind: 'money', amount_cents: 1000, created_by: admin.id });
    expect(moneyAdjustments(user.id).get('CAD')).toBe(1000);
  });

  test('a user without entries sums to nothing', async () => {
    const user = await newUser();
    expect(moneyAdjustments(user.id).size).toBe(0);
    expect(outsideTickets(user.id)).toBe(0);
    expect(merchBonus(user.id)).toBe(0);
    expect(freeTicketBonus(user.id).size).toBe(0);
  });

  test('labels are trimmed and cut to 200 characters; newest first', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    addAdjustment(admin, user.id, { kind: 'merch', quantity: 1, label: '  first  ' });
    addAdjustment(admin, user.id, { kind: 'merch', quantity: 1, label: 'x'.repeat(300) });
    const [newest, oldest] = adjustmentsFor(user.id);
    expect(newest!.label).toHaveLength(200);
    expect(oldest!.label).toBe('first');
  });

  test('describeAdjustment', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    const describe = (entry: Parameters<typeof addAdjustment>[2]) =>
      describeAdjustment(findAdjustment(addAdjustment(admin, user.id, entry))!, formatMoney);
    expect(describe({ kind: 'money', amountCents: 4000, currency: 'CAD', label: 'a' })).toBe('+$40.00');
    expect(describe({ kind: 'money', amountCents: -1250, currency: 'CAD', label: 'a' })).toBe('−$12.50');
    expect(describe({ kind: 'tickets_sold', quantity: 12, label: 'a' })).toBe('+12 tickets sold');
    expect(describe({ kind: 'tickets_sold', quantity: -1, label: 'a' })).toBe('−1 ticket sold');
    expect(describe({ kind: 'free_tickets', quantity: 1, eventId: 1, label: 'a' })).toBe('+1 free ticket');
    expect(describe({ kind: 'merch', quantity: -2, label: 'a' })).toBe('−2 merch items');
  });
});
