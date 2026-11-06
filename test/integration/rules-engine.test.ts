import { afterAll, expect, test } from 'bun:test';
import { config } from '../../src/config';
import { checkRule, evaluateRules, rulesEngineUp } from '../../src/rules-engine';
import { emptyInputs } from '../../src/rule-variables';
import { earnedOn, type Track } from '../../src/reward-rules';
import { trackExpression } from '../../src/rules';
import { describeIntegration, uid } from './harness';

/* The app's side of the rules engine, against the test stack's engine (docker-compose.test.yml). */
const ash = 'commission  = tickets_sold * 5.00\nvip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list     = floor(tickets_sold / 5)';
const outputs = ['commission', 'bonus', 'merch', 'vip_tickets', 'ga_list'];
const inputs = (sold: number) => ({ ...emptyInputs(), tickets_sold: sold });

describeIntegration('rules engine', () => {
  const url = config.rulesEngineUrl;
  afterAll(() => {
    config.rulesEngineUrl = url;
  });

  test("Ash's deal", async () => {
    const checked = await checkRule(ash, outputs);
    expect(checked.problems).toEqual([]);
    const version = `ash-${uid()}`;
    const { results, stale } = await evaluateRules(
      { version, lines: checked.lines },
      [1, 4, 5, 12, 20].map((sold) => ({ subject: `${version}:${sold}`, variables: inputs(sold) })),
    );
    expect(stale).toBe(false);
    expect([1, 4, 5, 12, 20].map((sold) => results.get(`${version}:${sold}`)!.outputs)).toEqual([
      { commission: 5, vip_tickets: 2, ga_list: 0 },
      { commission: 20, vip_tickets: 2, ga_list: 0 },
      { commission: 25, vip_tickets: 2, ga_list: 1 },
      { commission: 60, vip_tickets: 2, ga_list: 2 },
      { commission: 100, vip_tickets: 2, ga_list: 4 },
    ]);
  });

  test('75 and 75.0 are the same; strings and booleans work', async () => {
    const checked = await checkRule("commission = tickets_sold * 75\nbonus = level == 'Gold' && !is_team_lead ? 75.0 : 0", outputs);
    expect(checked.problems).toEqual([]);
    const version = `mix-${uid()}`;
    const { results } = await evaluateRules({ version, lines: checked.lines }, [{ subject: version, variables: { ...inputs(2), level: 'Gold' } }]);
    expect(results.get(version)!.outputs).toEqual({ commission: 150, bonus: 75 });
  });

  test('errors carry the line: unknown names, unknown variables, syntax, not a number', async () => {
    const checked = await checkRule('# deal\ncommision = tickets_sold * 5\nbonus = tickets * 2\nmerch = tickets_sold >\nvip_tickets = tickets_sold >= 1', outputs);
    expect(checked.problems.map((p) => p.line)).toEqual([2, 3, 4, 5]);
    expect(checked.problems[0]!.message).toContain('commision is not something a rule can give');
    expect(checked.problems[1]!.message).toBe('tickets is not a variable a rule can read.');
    expect(checked.problems[3]!.message).toContain('must be a number');
  });

  test('the parsed tree comes back, for putting rules into words', async () => {
    const checked = await checkRule('ga_list = floor(tickets_sold / 5)', outputs);
    expect(checked.trees.get('ga_list')).toEqual({
      k: 'call',
      s: 'floor',
      a: [{ k: 'call', s: '_/_', a: [{ k: 'var', s: 'tickets_sold' }, { k: 'num', v: 5 }] }],
    });
  });

  test('results are cached; when the engine is down, the last ones are given, marked stale', async () => {
    const lines = (await checkRule(ash, outputs)).lines;
    const subject = `cache-${uid()}`;
    const rule = { version: `v-${uid()}`, lines };
    expect((await evaluateRules(rule, [{ subject, variables: inputs(12) }])).results.get(subject)!.outputs.commission).toBe(60);

    config.rulesEngineUrl = 'http://127.0.0.1:1'; // nothing listens there
    // Same rule, same sales: from the cache, not stale.
    const same = await evaluateRules(rule, [{ subject, variables: inputs(12) }]);
    expect(same).toMatchObject({ stale: false });
    expect(same.results.get(subject)!.outputs.commission).toBe(60);
    // New sales: the last result known, marked stale.
    const later = await evaluateRules(rule, [{ subject, variables: inputs(20) }, { subject: `${subject}-new`, variables: inputs(1) }]);
    expect(later.stale).toBe(true);
    expect(later.results.get(subject)!.outputs.commission).toBe(60);
    expect(later.results.get(`${subject}-new`)).toEqual({ outputs: {}, errors: { '*': 'The rules engine is not available' } });
    expect(await rulesEngineUp()).toBe(false);
    await expect(checkRule(ash, outputs)).rejects.toThrow('rules engine is not available');

    config.rulesEngineUrl = url;
    expect(await rulesEngineUp()).toBe(true);
    expect((await evaluateRules(rule, [{ subject, variables: inputs(20) }])).results.get(subject)!.outputs.commission).toBe(100);
  });

  test('free-ticket tracks become expressions with the same counts', async () => {
    const tracks: Track[] = [
      { milestones: [{ at: 1, count: 1, label: '' }], every: 5, count: 1, label: '' },
      { milestones: [{ at: 2, count: 3, label: '' }, { at: 10, count: 1, label: '' }], every: 4, count: 2, label: '' },
      { milestones: [], every: 7, count: 1, label: '' },
      { milestones: [{ at: 3, count: 2, label: '' }], every: 0, count: 1, label: '' },
    ];
    for (const [i, track] of tracks.entries()) {
      const version = `track-${i}-${uid()}`;
      const lines = [{ line: 1, name: 'free_tickets', expr: trackExpression(track) }];
      const sold = Array.from({ length: 61 }, (_, n) => n);
      const { results } = await evaluateRules({ version, lines }, sold.map((n) => ({ subject: `${version}:${n}`, variables: inputs(n) })));
      expect(sold.map((n) => results.get(`${version}:${n}`)!.outputs.free_tickets)).toEqual(sold.map((n) => earnedOn(track, n)));
    }
  });
});
