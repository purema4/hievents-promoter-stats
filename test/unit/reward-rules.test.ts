import { afterEach, describe, expect, test } from 'bun:test';
import {
  defaultRules,
  describeProblem,
  describeTrack,
  earnedOn,
  isCustomized,
  labelOf,
  levelFor,
  nextOn,
  rewardRules,
  saveRewardRules,
  type RewardRules,
  type Track,
} from '../../src/reward-rules';
import { rewardsFor } from '../../src/rewards';
import { event, newUser } from './helpers';

const track = (milestones: [number, number, string?][], every = 0, count = 1, label = ''): Track => ({
  milestones: milestones.map(([at, n, l]) => ({ at, count: n, label: l ?? '' })),
  every,
  count,
  label,
});

afterEach(() => saveRewardRules(null));

describe('counting on a track', () => {
  // T-shirt at 20, hoodie at 50, then a cap every 100 more.
  const merch = track([[20, 1, 'T-shirt'], [50, 1, 'Hoodie']], 100, 1, 'Cap');

  test.each([
    [0, 0, 20, 0],
    [19, 0, 1, 95],
    [20, 1, 30, 0],
    [49, 1, 1, 96],
    [50, 2, 100, 0],
    [149, 2, 1, 99],
    [150, 3, 100, 0],
    [-5, 0, 20, 0],
  ])('%p sold → %p earned, next in %p (%p%%)', (sold, earned, nextIn, progress) => {
    expect(earnedOn(merch, sold)).toBe(earned);
    expect(nextOn(merch, sold)).toMatchObject({ in: nextIn, progress });
  });

  test('what each reward is', () => {
    expect([1, 2, 3, 4].map((n) => labelOf(merch, n))).toEqual(['T-shirt', 'Hoodie', 'Cap', 'Cap']);
    expect(nextOn(merch, 10)!.label).toBe('T-shirt');
    expect(nextOn(merch, 60)!.label).toBe('Cap');
  });

  test('milestones that give several at once, and no repeat', () => {
    const tickets = track([[3, 2], [10, 1]]);
    expect([0, 3, 9, 10, 500].map((n) => earnedOn(tickets, n))).toEqual([0, 2, 2, 3, 3]);
    expect(nextOn(tickets, 10)).toBeNull();
    expect(nextOn(tickets, 4)).toMatchObject({ at: 10, in: 6, count: 1 });
  });

  test('off: nothing earned and nothing next', () => {
    expect(earnedOn(track([]), 1000)).toBe(0);
    expect(nextOn(track([]), 1000)).toBeNull();
  });
});

describe('the rules in words', () => {
  test.each([
    [defaultRules().tickets, 'ticket', '1 free ticket at 1 sale, then 1 free ticket every 5 more sales.'],
    [defaultRules().merch, 'merch', '1 merch item every 50 tickets sold.'],
    [track([[20, 1, 'T-shirt'], [50, 2, 'Sticker']], 100, 1, 'Cap'), 'merch', 'T-shirt at 20 tickets sold, 2 × Sticker at 50 tickets sold, then Cap every 100 more tickets sold.'],
    [track([[3, 2]]), 'ticket', '2 free tickets at 3 sales.'],
    [track([]), 'ticket', 'No free tickets for now.'],
  ] as const)('%#', (t, unit, words) => {
    expect(describeTrack(t, unit)).toBe(words);
  });
});

describe('checking the rules', () => {
  const rules = (change: (r: RewardRules) => void) => {
    const r = defaultRules();
    change(r);
    return describeProblem(r);
  };

  test('the defaults are fine', () => {
    expect(describeProblem(defaultRules())).toBeNull();
  });

  test.each([
    ['no levels', (r: RewardRules) => (r.levels = []), 'Keep at least one level.'],
    ['first level above 0', (r: RewardRules) => (r.levels[0]!.at = 5), 'The first level must start at 0 tickets'],
    ['levels out of order', (r: RewardRules) => (r.levels[2]!.at = 10), 'more tickets than the one before'],
    ['same name twice', (r: RewardRules) => (r.levels[1]!.name = 'rookie'), 'same name'],
    ['empty name', (r: RewardRules) => (r.levels[1]!.name = '  '), 'needs a name'],
    ['unknown color', (r: RewardRules) => ((r.levels[1] as { color: string }).color = 'url(x)'), 'Pick a color'],
    ['not a whole number', (r: RewardRules) => (r.levels[1]!.at = 2.5), 'whole number'],
    ['milestone at 0', (r: RewardRules) => (r.tickets.milestones[0]!.at = 0), 'from 1'],
    ['two milestones at once', (r: RewardRules) => r.merch.milestones.push({ at: 5, count: 1, label: '' }, { at: 5, count: 1, label: '' }), 'same number of tickets'],
    ['negative repeat', (r: RewardRules) => (r.merch.every = -1), '0 for none'],
    ['NaN', (r: RewardRules) => (r.tickets.every = NaN), '0 for none'],
    ['too many', (r: RewardRules) => (r.tickets.count = 51), '1 to 50'],
    ['long label', (r: RewardRules) => (r.merch.label = 'x'.repeat(61)), '60 characters'],
  ])('%s', (_, change, message) => {
    expect(rules(change)).toContain(message);
  });

  test('anything that is not rules', () => {
    expect(describeProblem(null)).not.toBeNull();
    expect(describeProblem({ levels: 'x' })).not.toBeNull();
  });
});

describe('saved rules', () => {
  test('apply at once to levels and rewards, and reset to the defaults', async () => {
    const custom: RewardRules = {
      levels: [
        { name: 'Newbie', at: 0, color: 'gray' },
        { name: 'Legend', at: 5, color: 'purple' },
      ],
      tickets: track([[2, 3]]),
      merch: track([[4, 1, 'Hoodie']]),
    };
    saveRewardRules(custom);
    expect(isCustomized()).toBe(true);
    expect(rewardRules().levels.map((l) => l.name)).toEqual(['Newbie', 'Legend']);
    expect(levelFor(6)).toMatchObject({ level: { name: 'Legend' }, next: null, progress: 100 });

    const user = await newUser();
    const rewards = rewardsFor(user.id, [event(1, 2, 10), event(2, 3, 20)]);
    expect(rewards.tickets.map((t) => [t.earned, t.nextIn])).toEqual([
      [3, null],
      [3, null],
    ]);
    expect(rewards.merch).toMatchObject({ earned: 1, available: 1, readyLabel: 'Hoodie', nextIn: null });

    saveRewardRules(null);
    expect(isCustomized()).toBe(false);
    expect(levelFor(6).level.name).toBe('Rookie');
  });
});
