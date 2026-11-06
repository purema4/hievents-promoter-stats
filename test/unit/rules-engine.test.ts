import { describe, expect, test } from 'bun:test';
import { parseRule, RULE_MAX_LINES } from '../../src/rules-engine';
import { emptyInputs, RULE_VARIABLES } from '../../src/rule-variables';

describe('parseRule: lines, without the engine', () => {
  test('name = expression lines; comments and blank lines skipped; line numbers kept', () => {
    const { lines, problems } = parseRule('# Ash\n\ncommission  = tickets_sold * 5.00\n  vip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list=floor(tickets_sold / 5)\n');
    expect(problems).toEqual([]);
    expect(lines).toEqual([
      { line: 3, name: 'commission', expr: 'tickets_sold * 5.00' },
      { line: 4, name: 'vip_tickets', expr: 'tickets_sold >= 1 ? 2 : 0' },
      { line: 5, name: 'ga_list', expr: 'floor(tickets_sold / 5)' },
    ]);
  });

  test('== in the expression is not taken for the name\'s =', () => {
    expect(parseRule("bonus = level == 'Gold' ? 50 : 0").lines[0]).toEqual({ line: 1, name: 'bonus', expr: "level == 'Gold' ? 50 : 0" });
  });

  test('problems carry their line', () => {
    expect(parseRule('commission = 1\ncommission = 2\njust text\n= 3\n2x = 4').problems).toEqual([
      { line: 2, message: 'commission is already given on another line.' },
      { line: 3, message: 'Write it as name = expression.' },
      { line: 4, message: 'Write it as name = expression.' },
      { line: 5, message: 'Write it as name = expression.' },
    ]);
  });

  test('size limits', () => {
    const many = Array.from({ length: RULE_MAX_LINES + 1 }, (_, i) => `r${i} = 1`).join('\n');
    expect(parseRule(many).problems.at(-1)!.message).toContain(`${RULE_MAX_LINES} lines at most`);
    expect(parseRule('x = ' + '1'.repeat(10_001)).problems[0]!.message).toContain('longer than');
  });
});

test('one list of variables, each explained in both languages', () => {
  const names = RULE_VARIABLES.map((v) => v.name);
  expect(new Set(names).size).toBe(names.length);
  for (const v of RULE_VARIABLES) expect(v.en.length * v.fr.length).toBeGreaterThan(0);
  expect(emptyInputs()).toMatchObject({ tickets_sold: 0, level: '', is_team_lead: false });
});
