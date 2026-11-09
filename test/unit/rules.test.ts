import { describe, expect, test } from 'bun:test';
import { db } from '../../src/local-db';
import {
  commissionLine,
  currentRule,
  endRulesOf,
  listRewardTypes,
  listTemplates,
  removeTemplate,
  ruleFor,
  ruleHistory,
  ruleOutputs,
  saveRewardType,
  saveRuleVersion,
  saveTemplate,
  trackExpression,
} from '../../src/rules';
import { newUser } from './helpers';

describe('versions', () => {
  test('each save is a new version; nothing is overwritten; the same text keeps the version', async () => {
    const u = await newUser();
    const first = saveRuleVersion('promoter', { userId: u.id }, 'commission = tickets_sold * 2', null);
    expect(saveRuleVersion('promoter', { userId: u.id }, 'commission = tickets_sold * 2\n', null)).toBe(first);
    const second = saveRuleVersion('promoter', { userId: u.id }, 'commission = tickets_sold * 3', null);
    expect(second).toBeGreaterThan(first);
    expect(ruleHistory('promoter', { userId: u.id }).map((v) => v.text)).toEqual(['commission = tickets_sold * 3', 'commission = tickets_sold * 2']);
    // Removing is a version too.
    saveRuleVersion('promoter', { userId: u.id }, '', null);
    expect(currentRule('promoter', { userId: u.id })).toBeNull();
    expect(ruleHistory('promoter', { userId: u.id })).toHaveLength(3);
  });

  test('a deleted promoter\'s rules end, so a reused id never picks them up', async () => {
    const u = await newUser();
    saveRuleVersion('promoter', { userId: u.id }, 'commission = 1', null);
    saveRuleVersion('promoter_event', { userId: u.id, eventId: 9 }, 'bonus = 1', null);
    endRulesOf(u.id, null);
    expect(currentRule('promoter', { userId: u.id })).toBeNull();
    expect(currentRule('promoter_event', { userId: u.id, eventId: 9 })).toBeNull();
  });
});

describe('which rule applies', () => {
  test('promoter on event > event > promoter > default, line by line', async () => {
    const u = await newUser();
    const other = await newUser();
    db.exec("DELETE FROM rule_versions WHERE scope IN ('default', 'event')");
    saveRuleVersion('default', {}, 'commission = full_price_sales * 10 / 100\nfree_tickets = floor(tickets_sold / 5)\nbonus = 0', null);
    saveRuleVersion('promoter', { userId: u.id }, 'commission = full_price_sales * 15 / 100', null);
    saveRuleVersion('event', { eventId: 7 }, 'free_tickets = tickets_sold >= 1 ? 2 : 0\nbonus = 50', null);
    saveRuleVersion('promoter_event', { userId: u.id, eventId: 7 }, 'commission = tickets_sold * 5', null);

    const exprs = (r: ReturnType<typeof ruleFor>) => Object.fromEntries(r.lines.map((l) => [l.name, l.expr]));
    expect(exprs(ruleFor(u.id, 7))).toEqual({ commission: 'tickets_sold * 5', free_tickets: 'tickets_sold >= 1 ? 2 : 0', bonus: '50' });
    expect(exprs(ruleFor(u.id, 8))).toEqual({ commission: 'full_price_sales * 15 / 100', free_tickets: 'floor(tickets_sold / 5)', bonus: '0' });
    expect(exprs(ruleFor(other.id, 7))).toEqual({ commission: 'full_price_sales * 10 / 100', free_tickets: 'tickets_sold >= 1 ? 2 : 0', bonus: '50' });
    const applied = ruleFor(u.id, 7);
    expect(applied.versionIds).toHaveLength(4);
    expect(applied.from.get('commission')).toBe('promoter_event');
    expect(applied.from.get('free_tickets')).toBe('event');
    expect(applied.key).toBe(applied.versionIds.join('.'));
  });
});

describe('templates and reward types', () => {
  test('templates are named rules with versions; removing hides them', () => {
    const id = saveTemplate('Gros show', 'commission = tickets_sold * 6', null);
    expect(saveTemplate('gros show', 'commission = tickets_sold * 7', null)).toBe(id); // same name
    expect(listTemplates().find((t) => t.id === id)).toMatchObject({ name: 'Gros show', text: 'commission = tickets_sold * 7' });
    removeTemplate(id);
    expect(listTemplates().some((t) => t.id === id)).toBe(false);
  });

  test('reward types become outputs; their keys are checked', () => {
    expect(saveRewardType('vip_tickets', 'VIP', 'VIP')).toBe('ok');
    expect(saveRewardType('ga_list', 'GA list', 'Liste GA')).toBe('ok');
    expect(saveRewardType('commission', 'x', 'x')).toBe('invalid');
    expect(saveRewardType('VIP tickets', 'x', 'x')).toBe('invalid');
    expect(saveRewardType('ok_key', ' ', 'x')).toBe('invalid');
    expect(listRewardTypes().find((t) => t.key === 'ga_list')).toEqual({ key: 'ga_list', label_en: 'GA list', label_fr: 'Liste GA', description_en: null, description_fr: null, guest_list: 0 });
    expect(saveRewardType('gl_tickets', 'Guest list', 'Liste d’invités', '', '', true)).toBe('ok');
    expect(listRewardTypes().find((t) => t.key === 'gl_tickets')?.guest_list).toBe(1);
    expect(saveRewardType('ga_list', 'GA list spot', 'Place liste GA', 'Your guest on the list.')).toBe('ok');
    expect(listRewardTypes().find((t) => t.key === 'ga_list')).toMatchObject({ label_en: 'GA list spot', description_en: 'Your guest on the list.', description_fr: 'Your guest on the list.' });
    expect(ruleOutputs()).toEqual(expect.arrayContaining(['commission', 'bonus', 'merch', 'vip_tickets', 'ga_list']));
  });
});

describe('from the old rates and tracks', () => {
  test('commission lines', () => {
    expect(commissionLine({ kind: 'percent', value: 12.5 })).toBe('commission = (full_price_sales + outside_sales) * 12.5 / 100');
    expect(commissionLine({ kind: 'flat', value: 250 })).toBe('commission = (tickets_sold + outside_tickets) * 2.5');
  });

  test('free-ticket tracks', () => {
    expect(trackExpression({ milestones: [{ at: 1, count: 1, label: '' }], every: 5, count: 1, label: '' })).toBe(
      '(tickets_sold >= 1 ? 1 : 0) + (tickets_sold > 1 ? floor((tickets_sold - 1) / 5) * 1 : 0)',
    );
    expect(trackExpression({ milestones: [], every: 10, count: 2, label: '' })).toBe('floor(tickets_sold / 10) * 2');
    expect(trackExpression({ milestones: [], every: 0, count: 1, label: '' })).toBe('0');
  });
});
