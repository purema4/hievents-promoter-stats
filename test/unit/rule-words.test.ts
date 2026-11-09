import { describe, expect, test } from 'bun:test';
import { describeLine } from '../../src/rule-words';
import type { RuleNode } from '../../src/rules-engine';

// Trees as the rules engine sends them (numbers are doubles; 0 comes without a value).
const n = (v: number): RuleNode => (v === 0 ? { k: 'num' } : { k: 'num', v });
const v = (s: string): RuleNode => ({ k: 'var', s });
const c = (s: string, ...a: RuleNode[]): RuleNode => ({ k: 'call', s, a });

describe('rules in words', () => {
  test("Ash's deal", () => {
    expect(describeLine('Commission', c('_*_', v('tickets_sold'), n(5)), 'money', 'en')).toBe('Commission: $5.00 per ticket sold.');
    expect(describeLine('Commission', c('_*_', v('tickets_sold'), n(5)), 'money', 'fr')).toBe('Commission : 5,00 $ par billet vendu.');
    const vip = c('_?_:_', c('_>=_', v('tickets_sold'), n(1)), n(2), n(0));
    expect(describeLine('VIP', vip, 'count', 'en')).toBe('VIP: 2 from your first sale.');
    expect(describeLine('VIP', vip, 'count', 'fr')).toBe('VIP : 2 dès ta première vente.');
    const ga = c('floor', c('_/_', v('tickets_sold'), n(5)));
    expect(describeLine('GA list', ga, 'count', 'en')).toBe('GA list: 1 for every 5 tickets sold.');
    expect(describeLine('Liste GA', ga, 'count', 'fr')).toBe('Liste GA : 1 par tranche de 5 billets vendus.');
  });

  test('whether a commission is earned', () => {
    const vip = c('_?_:_', c('_>_', v('commission'), n(0)), n(2), n(0));
    expect(describeLine('VIP', vip, 'count', 'en')).toBe('VIP: 2 if you earn a commission.');
    expect(describeLine('VIP', vip, 'count', 'fr')).toBe('VIP : 2 si tu touches une commission.');
    const team = c('_?_:_', c('_>_', v('team_commission'), n(0)), c('_*_', v('team_full_price_sales'), n(0.05)), n(0));
    expect(describeLine('Commission', team, 'money', 'en')).toContain('if your team earns a commission');
  });

  test('caps and floors', () => {
    const capped = c('min', c('floor', c('_/_', v('tickets_sold'), n(5))), n(10));
    expect(describeLine('Liste GA', capped, 'count', 'fr')).toBe('Liste GA : 1 par tranche de 5 billets vendus, jusqu’à 10.');
    expect(describeLine('GA list', capped, 'count', 'en')).toBe('GA list: 1 for every 5 tickets sold, up to 10.');
    expect(describeLine('Bonus', c('max', c('_*_', v('tickets_sold'), n(2)), n(20)), 'money', 'en')).toBe('Bonus: $2.00 per ticket sold, at least $20.00.');
  });

  test('a percentage of sales, as migrated from the old rates', () => {
    const tenPercent = c('_/_', c('_*_', c('_+_', v('full_price_sales'), v('outside_sales')), n(10)), n(100));
    expect(describeLine('Commission', tenPercent, 'money', 'en')).toBe('Commission: 10% of your sales at full price, outside Hi.Events too.');
    expect(describeLine('Commission', tenPercent, 'money', 'fr')).toBe('Commission : 10 % de tes ventes au plein prix, hors Hi.Events compris.');
    expect(describeLine('Commission', c('_*_', v('full_price_sales'), n(0.125)), 'money', 'en')).toBe('Commission: 12.5% of your sales at full price.');
    expect(describeLine('Bonus', c('_*_', v('team_full_price_sales'), n(0.02)), 'money', 'en')).toBe('Bonus: 2% of your team’s sales at full price.');
    expect(describeLine('Bonus', c('_*_', v('team_full_price_sales'), n(0.02)), 'money', 'fr')).toBe('Bonus : 2 % des ventes au plein prix de ton équipe.');
  });

  test('thresholds, if/else and sums', () => {
    const tiers = c('_?_:_', c('_>=_', v('tickets_sold'), n(20)), c('_*_', v('tickets_sold'), n(6)), c('_*_', v('tickets_sold'), n(5)));
    expect(describeLine('Commission', tiers, 'money', 'en')).toBe('Commission: $6.00 per ticket sold from 20 tickets sold, otherwise $5.00 per ticket sold.');
    expect(describeLine('Bonus', c('_?_:_', c('_==_', v('level'), { k: 'str', s: 'Gold' }), n(50), n(0)), 'money', 'fr')).toBe('Bonus : 50,00 $ si ton niveau est Gold.');
    // The free-ticket track migrated from Levels & rewards.
    const track = c(
      '_+_',
      c('_?_:_', c('_>=_', v('tickets_sold'), n(1)), n(1), n(0)),
      c('_?_:_', c('_>_', v('tickets_sold'), n(1)), c('_*_', c('floor', c('_/_', c('_-_', v('tickets_sold'), n(1)), n(5))), n(1)), n(0)),
    );
    expect(describeLine('Free tickets', track, 'count', 'en')).toBe('Free tickets: 1 from your first sale, then 1 more for every 5 tickets sold after the first one.');
    expect(describeLine('Billets gratuits', track, 'count', 'fr')).toBe('Billets gratuits : 1 dès ta première vente, puis 1 de plus par tranche de 5 billets vendus après le premier.');
  });

  test('anything else is described by what it reads', () => {
    const odd = c('_*_', c('_-_', v('event_tickets_sold'), v('tickets_sold')), v('days_before_event'));
    expect(describeLine('Bonus', odd, 'money', 'en')).toBe('Bonus: worked out from tickets sold for the whole event, tickets sold, days before the event.');
    expect(describeLine('Bonus', n(50), 'money', 'en')).toBe('Bonus: $50.00.');
  });
});
