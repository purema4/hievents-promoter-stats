import { describe, expect, test } from 'bun:test';
import { addAdjustment } from '../../src/adjustments';
import { findUser } from '../../src/local-db';
import type { Totals } from '../../src/money';
import { balances, cashAvailable, payoutsFor, requestPayout, settlePayout, type Balance } from '../../src/payouts';
import { newUser } from './helpers';

const cad = (commission: number): Totals => ({ currency: 'CAD', fullPrice: commission * 10, paid: 0, commission, tickets: 0, pending: 0, orders: 0 });
const balanceOf = (userId: number, commission: number, currency = 'CAD') =>
  balances(userId, [cad(commission)]).find((b) => b.currency === currency)!;
const interac = (amountCents: number) => ({ amountCents, method: 'Interac e-Transfer', details: ' max@example.com ', note: '' });
const cash = (amountCents: number) => ({ amountCents, method: 'Cash', details: '', note: '' });

describe('requestPayout', () => {
  test('refuses more than the available balance', async () => {
    const user = await newUser();
    expect(requestPayout(user, balanceOf(user.id, 2850), interac(2851))).toBe('too_much');
    expect(payoutsFor(user.id)).toHaveLength(0);
  });

  test('refuses unknown methods and amounts that are not whole cents above zero', async () => {
    const user = await newUser();
    const balance = balanceOf(user.id, 2850);
    expect(requestPayout(user, balance, { ...interac(1000), method: 'Bitcoin' })).toBe('missing_method');
    expect(requestPayout(user, balance, interac(0))).toBe('invalid_amount');
    expect(requestPayout(user, balance, interac(-100))).toBe('invalid_amount');
    expect(requestPayout(user, balance, interac(10.5))).toBe('invalid_amount');
    expect(requestPayout(user, balance, interac(NaN))).toBe('invalid_amount');
  });

  test('cash must be a multiple of CASH_STEP ($50)', async () => {
    const user = await newUser();
    const balance = balanceOf(user.id, 12850);
    expect(cashAvailable(balance)).toBe(10000);
    expect(requestPayout(user, balance, cash(2500))).toBe('cash_step');
    expect(requestPayout(user, balance, cash(7500))).toBe('cash_step');
    expect(requestPayout(user, balance, cash(15000))).toBe('too_much');
    expect(requestPayout(user, balance, cash(10000))).toBe('ok');
  });

  test('cashAvailable rounds down to a whole step and never goes negative', () => {
    const b = (available: number): Balance => ({ currency: 'CAD', fromSales: 0, fromTeam: 0, added: 0, earned: 0, paidOut: 0, pending: 0, available });
    expect(cashAvailable(b(2850))).toBe(0);
    expect(cashAvailable(b(5000))).toBe(5000);
    expect(cashAvailable(b(9999))).toBe(5000);
    expect(cashAvailable(b(-1000))).toBe(0);
  });

  test('one pending request per currency', async () => {
    const user = await newUser();
    expect(requestPayout(user, balanceOf(user.id, 2850), interac(1000))).toBe('ok');
    // Even a stale balance (as read before the first request) cannot add a second one.
    expect(requestPayout(user, balanceOf(user.id, 2850), interac(500))).toBe('already_pending');
    const usd: Balance = { currency: 'USD', fromSales: 1000, fromTeam: 0, added: 0, earned: 1000, paidOut: 0, pending: 0, available: 1000 };
    expect(requestPayout(user, usd, interac(1000))).toBe('ok');
    expect(payoutsFor(user.id).map((p) => [p.currency, p.amount_cents, p.status])).toEqual([
      ['USD', 1000, 'pending'],
      ['CAD', 1000, 'pending'],
    ]);
  });

  test('remembers how the promoter wants to be paid', async () => {
    const user = await newUser();
    expect(requestPayout(user, balanceOf(user.id, 2850), interac(2850))).toBe('ok');
    expect(findUser(user.id)).toMatchObject({ payout_method: 'Interac e-Transfer', payout_details: 'max@example.com' });
    expect(payoutsFor(user.id)[0]).toMatchObject({ details: 'max@example.com', note: null, promoter_email: user.email });
  });
});

describe('balances', () => {
  test('earned minus paid minus pending; declined requests free the amount again', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    expect(balanceOf(user.id, 2850)).toEqual({ currency: 'CAD', fromSales: 2850, fromTeam: 0, added: 0, earned: 2850, paidOut: 0, pending: 0, available: 2850 });

    requestPayout(user, balanceOf(user.id, 2850), interac(1000));
    expect(balanceOf(user.id, 2850)).toMatchObject({ pending: 1000, available: 1850 });

    const [first] = payoutsFor(user.id);
    expect(settlePayout(first!.id, admin.id, 'paid', 'REF-1')).toBe(true);
    expect(settlePayout(first!.id, admin.id, 'rejected', 'again')).toBe(false);
    expect(balanceOf(user.id, 2850)).toMatchObject({ paidOut: 1000, pending: 0, available: 1850 });

    requestPayout(user, balanceOf(user.id, 2850), interac(1850));
    const [second] = payoutsFor(user.id);
    expect(settlePayout(second!.id, admin.id, 'rejected', 'Wrong email')).toBe(true);
    expect(balanceOf(user.id, 2850)).toMatchObject({ paidOut: 1000, pending: 0, available: 1850 });
  });

  test('a refund after a payout makes the balance negative', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    requestPayout(user, balanceOf(user.id, 2850), interac(2850));
    settlePayout(payoutsFor(user.id)[0]!.id, admin.id, 'paid', '');
    expect(balanceOf(user.id, 2000).available).toBe(-850);
  });

  test('money added by the team counts, also in a currency with no sales', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    addAdjustment(admin, user.id, { kind: 'money', amountCents: 4000, currency: 'CAD', label: 'Bonus' });
    addAdjustment(admin, user.id, { kind: 'money', amountCents: 500, currency: 'USD', label: 'Tour' });
    const all = balances(user.id, [cad(2850)]);
    expect(all.find((b) => b.currency === 'CAD')).toMatchObject({ fromSales: 2850, fromTeam: 0, added: 4000, earned: 6850, available: 6850 });
    expect(all.find((b) => b.currency === 'USD')).toMatchObject({ fromSales: 0, fromTeam: 0, added: 500, available: 500 });
  });
});
