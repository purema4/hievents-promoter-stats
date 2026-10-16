import { describe, expect, test } from 'bun:test';
import { addAdjustment } from '../../src/adjustments';
import {
  freeTicketsEarned,
  levelFor,
  merchEarned,
  requestReward,
  rewardRequestsFor,
  rewardsFor,
  salesToNextFreeTicket,
  salesToNextMerch,
  settleReward,
} from '../../src/rewards';
import { event, newUser } from './helpers';

describe('free tickets (REWARD_TICKET_EVERY = 5)', () => {
  test.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [5, 1],
    [6, 2],
    [10, 2],
    [11, 3],
    [-3, 0],
  ])('%p sold → %p free', (sold, free) => {
    expect(freeTicketsEarned(sold)).toBe(free);
  });

  test.each([
    [0, 1],
    [1, 5],
    [5, 1],
    [6, 5],
    [10, 1],
  ])('%p sold → next one in %p', (sold, next) => {
    expect(salesToNextFreeTicket(sold)).toBe(next);
  });
});

describe('merch (MERCH_EVERY = 50)', () => {
  test.each([
    [0, 0, 50],
    [49, 0, 1],
    [50, 1, 50],
    [99, 1, 1],
    [149, 2, 1],
    [150, 3, 50],
  ])('%p sold → %p items, next in %p', (sold, items, next) => {
    expect(merchEarned(sold)).toBe(items);
    expect(salesToNextMerch(sold)).toBe(next);
  });
});

describe('levelFor', () => {
  test.each([
    [0, 'Rookie', 'Bronze', 0],
    [9, 'Rookie', 'Bronze', 90],
    [10, 'Bronze', 'Silver', 0],
    [24, 'Bronze', 'Silver', 93],
    [25, 'Silver', 'Gold', 0],
    [49, 'Silver', 'Gold', 96],
    [50, 'Gold', 'Platinum', 0],
    [100, 'Platinum', 'Diamond', 0],
    [249, 'Platinum', 'Diamond', 99],
    [250, 'Diamond', null, 100],
    [5000, 'Diamond', null, 100],
  ])('%p sold → %p (next %p, %p%%)', (sold, level, next, progress) => {
    const result = levelFor(sold);
    expect(result.level.name).toBe(level);
    expect(result.next?.name ?? null).toBe(next);
    expect(result.progress).toBe(progress);
  });
});

describe('rewardsFor and requestReward', () => {
  test('free tickets are offered for upcoming events only', async () => {
    const user = await newUser();
    const rewards = rewardsFor(user.id, [event(1, 6, 10), event(2, 4, -30), event(3, 0, 5)]);
    expect(rewards.totalSold).toBe(10);
    expect(rewards.tickets.map((t) => [t.event.id, t.earned, t.available, t.nextIn])).toEqual([
      [1, 2, 2, 5],
      [3, 0, 0, 1],
    ]);
    expect(rewards.merch).toEqual({ earned: 0, bonus: 0, used: 0, available: 0, nextIn: 40, progress: 20, nextLabel: '', readyLabel: '' });
  });

  test('requested tickets are used up; declined ones become available again', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    const events = [event(1, 6, 10, 'Warehouse Night')];
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'ticket', eventId: 1, quantity: 3, details: '' })).toBe('not_available');
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'ticket', eventId: 1, quantity: 2, details: ' Max +1 ' })).toBe('ok');
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'ticket', eventId: 1, quantity: 1, details: '' })).toBe('not_available');
    const [request] = rewardRequestsFor(user.id);
    expect(request).toMatchObject({ kind: 'ticket', event_id: 1, event_title: 'Warehouse Night', quantity: 2, details: 'Max +1', status: 'pending' });

    expect(settleReward(request!.id, admin.id, 'rejected', 'Sold out')).toBe(true);
    expect(settleReward(request!.id, admin.id, 'fulfilled', '')).toBe(false); // already handled
    expect(rewardsFor(user.id, events).tickets[0]!.available).toBe(2);
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'ticket', eventId: 1, quantity: 1, details: '' })).toBe('ok');
  });

  test('stale numbers cannot claim the same reward twice', async () => {
    const user = await newUser();
    const events = [event(1, 1, 10)];
    const stale = rewardsFor(user.id, events);
    expect(requestReward(user, stale, { kind: 'ticket', eventId: 1, quantity: 1, details: '' })).toBe('ok');
    expect(requestReward(user, stale, { kind: 'ticket', eventId: 1, quantity: 1, details: '' })).toBe('not_available');
  });

  test('unknown events, past events and bad quantities are refused', async () => {
    const user = await newUser();
    const rewards = rewardsFor(user.id, [event(1, 6, 10), event(2, 6, -10)]);
    expect(requestReward(user, rewards, { kind: 'ticket', eventId: 99, quantity: 1, details: '' })).toBe('not_available');
    expect(requestReward(user, rewards, { kind: 'ticket', eventId: 2, quantity: 1, details: '' })).toBe('not_available');
    expect(requestReward(user, rewards, { kind: 'ticket', eventId: 1, quantity: 0, details: '' })).toBe('not_available');
    expect(requestReward(user, rewards, { kind: 'ticket', eventId: 1, quantity: 1.5, details: '' })).toBe('not_available');
  });

  test('merch needs details and an unlocked item; team bonuses count', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    const events = [event(1, 49, 10)];
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'merch', quantity: 1, details: '' })).toBe('missing_details');
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'merch', quantity: 1, details: 'T-shirt L' })).toBe('not_available');

    // One more ticket sold outside Hi.Events reaches 50.
    addAdjustment(admin, user.id, { kind: 'tickets_sold', quantity: 1, label: 'Door sales' });
    const rewards = rewardsFor(user.id, events);
    expect(rewards.totalSold).toBe(50);
    expect(rewards.outsideSold).toBe(1);
    expect(rewards.merch.available).toBe(1);
    expect(requestReward(user, rewards, { kind: 'merch', quantity: 1, details: 'T-shirt L' })).toBe('ok');
    expect(requestReward(user, rewardsFor(user.id, events), { kind: 'merch', quantity: 1, details: 'Cap' })).toBe('not_available');

    addAdjustment(admin, user.id, { kind: 'merch', quantity: 1, label: 'Top seller' });
    const withBonus = rewardsFor(user.id, events);
    expect(withBonus.merch).toMatchObject({ earned: 2, bonus: 1, used: 1, available: 1 });
  });

  test('free tickets given by the team add to an event, and taking back never goes below zero', async () => {
    const user = await newUser();
    const admin = await newUser('Admin', true);
    const events = [event(7, 1, 10)];
    addAdjustment(admin, user.id, { kind: 'free_tickets', quantity: 2, eventId: 7, label: 'Flyers' });
    expect(rewardsFor(user.id, events).tickets[0]).toMatchObject({ earned: 3, bonus: 2, available: 3 });
    addAdjustment(admin, user.id, { kind: 'free_tickets', quantity: -10, eventId: 7, label: 'Mistake' });
    expect(rewardsFor(user.id, events).tickets[0]).toMatchObject({ earned: 0, available: 0 });
  });
});
