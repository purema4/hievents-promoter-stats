import { previewInputs } from './earnings';
import { statsForCodes, type CodeStats } from './hievents';
import { codesFor, findUser, listUsers, type User } from './local-db';
import { formatMoney } from './money';
import { levelFor } from './reward-rules';
import { checkRule, evaluateRules, parseRule, RulesEngineUnavailable, type RuleLine, type RuleNode, type RuleProblem } from './rules-engine';
import { currentRule, listRewardTypes, ruleFor, ruleOutputs, type RuleScope, type RuleTarget } from './rules';
import { emptyInputs, type RuleInputs } from './rule-variables';
import { describeLine, type Lang, type Unit } from './rule-words';

/*
 * What the rule screens need: checking a draft (errors per line, including outputs that go negative),
 * putting it into words, and a preview with real promoters' numbers and made-up sales.
 */

export const unitOf = (name: string): Unit => (name === 'commission' || name === 'bonus' ? 'money' : 'count');

export function labelOf(name: string, lang: Lang): string {
  if (name === 'commission') return 'Commission';
  if (name === 'bonus') return 'Bonus';
  if (name === 'merch') return 'Merch';
  const type = listRewardTypes().find((t) => t.key === name);
  return type ? (lang === 'fr' ? type.label_fr : type.label_en) : name;
}

/** Each line of a rule in words, in its order. */
export function ruleInWords(lines: RuleLine[], trees: Map<string, RuleNode>, lang: Lang): string[] {
  return lines.filter((l) => trees.has(l.name)).map((l) => describeLine(labelOf(l.name, lang), trees.get(l.name)!, unitOf(l.name), lang));
}

/** The lines that apply with a draft at one level, the other levels as saved (see ruleFor). */
export function linesWithDraft(scope: RuleScope, target: RuleTarget, draft: string): RuleLine[] {
  // A template is a rule of its own; a team rule is added on top of the team lead's rule, line for line.
  if (scope === 'template' || scope === 'team') return parseRule(draft).lines;
  const levels: [RuleScope, RuleTarget][] = [
    ['default', {}],
    ['promoter', { userId: target.userId }],
    ['event', { eventId: target.eventId }],
    ['promoter_event', { userId: target.userId, eventId: target.eventId }],
  ];
  const byName = new Map<string, RuleLine>();
  for (const [level, t] of levels) {
    // A level that needs a promoter or an event this preview does not have is left out.
    if ((level === 'promoter' || level === 'promoter_event') && !target.userId) continue;
    if ((level === 'event' || level === 'promoter_event') && !target.eventId) continue;
    const text = level === scope ? draft : (currentRule(level, t)?.text ?? '');
    for (const line of parseRule(text).lines) byName.set(line.name, line);
  }
  return [...byName.values()];
}

// Made-up sales a rule is tried on before it is saved, so an output that goes negative is caught.
function probes(): RuleInputs[] {
  const out: RuleInputs[] = [];
  for (const sold of [0, 1, 2, 4, 5, 6, 10, 12, 20, 25, 50, 100, 500]) {
    for (const days of [-1, 0, 30]) {
      for (const lead of [false, true]) {
        out.push({
          ...emptyInputs(),
          tickets_sold: sold,
          orders: Math.ceil(sold / 2),
          full_price_sales: sold * 25,
          paid_by_customers: sold * 22.5,
          codes_used: sold > 0 ? 1 : 0,
          outside_tickets: sold > 10 ? 2 : 0,
          outside_sales: sold > 10 ? 50 : 0,
          event_tickets_sold: sold * 3,
          event_promoters: 3,
          days_before_event: days,
          event_dates: 1,
          lifetime_tickets: sold * 2,
          events_promoted: 2,
          level: levelFor(sold * 2).level.name,
          is_team_lead: lead,
          team_size: lead ? 4 : 0,
          team_tickets_sold: lead ? sold * 4 : sold,
          team_full_price_sales: lead ? sold * 3 * 25 : 0,
          team_commission: lead ? sold * 3 * 2.5 : 0,
        });
      }
    }
  }
  return out;
}

const describeProbe = (i: RuleInputs) => `${i.tickets_sold} tickets sold`;

export type PreviewRow = { label: string; tickets: number; values: Record<string, string>; made_up?: boolean };
export type RuleCheck = { problems: RuleProblem[]; en: string[]; fr: string[]; outputs: string[]; preview: PreviewRow[] };

const show = (name: string, n: number | undefined, currency = 'CAD') =>
  n === undefined ? '—' : unitOf(name) === 'money' ? formatMoney(Math.round(n * 100), currency) : String(Math.floor(n));

/** Real promoters' sales for the preview: one promoter, or everyone with a code on the event. */
async function realRows(scope: RuleScope, target: RuleTarget): Promise<{ user: User; rows: CodeStats[] }[]> {
  if (scope === 'promoter' || scope === 'promoter_event' || scope === 'team') {
    const user = target.userId ? findUser(target.userId) : null;
    if (!user) return [];
    const rows = await statsForCodes(codesFor(user.id));
    return [{ user, rows: scope === 'promoter_event' ? rows.filter((r) => r.event_id === target.eventId) : rows }];
  }
  if (scope !== 'event' || !target.eventId) return [];
  const people = listUsers().filter((u) => u.codes.length > 0);
  const owner = new Map<string, User>();
  for (const u of people) for (const c of u.codes) owner.set(c.toLowerCase(), u);
  const rows = (await statsForCodes([...owner.keys()])).filter((r) => r.event_id === target.eventId);
  const byUser = new Map<number, { user: User; rows: CodeStats[] }>();
  for (const r of rows) {
    const u = owner.get(r.code.toLowerCase());
    if (!u) continue;
    const entry = byUser.get(u.id) ?? { user: u, rows: [] };
    entry.rows.push(r);
    byUser.set(u.id, entry);
  }
  return [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
}

/**
 * Checks a draft rule at one level: format, names, expressions, and that no output goes negative on
 * made-up sales. With no problems, it is put into words and previewed. Throws RulesEngineUnavailable.
 */
export async function checkDraft(scope: RuleScope, target: RuleTarget, text: string, testTickets?: number): Promise<RuleCheck> {
  const checked = await checkRule(text, ruleOutputs());
  const problems = [...checked.problems];
  const outputs = checked.lines.map((l) => l.name);
  if (problems.length === 0 && checked.lines.length > 0) {
    const tries = probes();
    const { results } = await evaluateRules({ version: 'probe', lines: checked.lines }, tries.map((v, i) => ({ subject: String(i), variables: v })), { cache: false });
    for (const line of checked.lines) {
      for (const [i, input] of tries.entries()) {
        const r = results.get(String(i));
        const value = r?.outputs[line.name];
        const error = r?.errors[line.name];
        if (error) {
          problems.push({ line: line.line, message: `It does not give a number with ${describeProbe(input)} (${error}).` });
          break;
        }
        if (value !== undefined && value < 0) {
          problems.push({ line: line.line, message: `It gives ${value} with ${describeProbe(input)}: a rule must give 0 or more.` });
          break;
        }
      }
    }
    problems.sort((a, b) => a.line - b.line);
  }
  if (problems.length > 0) return { problems, en: [], fr: [], outputs, preview: [] };

  const lines = linesWithDraft(scope, target, text);
  const preview: PreviewRow[] = [];
  const items: { subject: string; variables: RuleInputs; row: PreviewRow; currency: string }[] = [];
  for (const { user, rows } of await realRows(scope, target)) {
    const inputs = await previewInputs(user, rows, lines);
    for (const [eventId, at] of inputs) {
      const title = rows.find((r) => r.event_id === eventId)?.event_title ?? `Event ${eventId}`;
      const variables = at();
      const row: PreviewRow = { label: scope === 'promoter' || scope === 'team' ? title : user.name, tickets: Number(variables.tickets_sold), values: {} };
      items.push({ subject: `${user.id}:${eventId}`, variables, row, currency: rows.find((r) => r.event_id === eventId)?.currency ?? 'CAD' });
    }
  }
  const tickets = [1, 5, 12, 20, ...(testTickets !== undefined && Number.isFinite(testTickets) ? [testTickets] : [])];
  for (const sold of [...new Set(tickets)].sort((a, b) => a - b)) {
    const variables: RuleInputs = { ...emptyInputs(), tickets_sold: sold, orders: sold, full_price_sales: sold * 25, codes_used: 1, event_tickets_sold: sold, event_promoters: 1, event_dates: 1, lifetime_tickets: sold, events_promoted: 1, level: levelFor(sold).level.name, team_tickets_sold: scope === 'team' ? sold * 2 : sold, team_full_price_sales: scope === 'team' ? sold * 25 : 0, team_commission: scope === 'team' ? sold * 2.5 : 0 };
    const label = scope === 'team' ? `Team sold ${sold} at $25` : `${sold} tickets at $25`;
    items.push({ subject: `test:${sold}`, variables, row: { label, tickets: sold, values: {}, made_up: true }, currency: 'CAD' });
  }
  const { results } = await evaluateRules({ version: 'preview', lines }, items, { cache: false });
  for (const item of items) {
    const r = results.get(item.subject);
    for (const line of lines) item.row.values[line.name] = show(line.name, r?.outputs[line.name], item.currency);
    preview.push(item.row);
  }
  return {
    problems,
    en: ruleInWords(checked.lines, checked.trees, 'en'),
    fr: ruleInWords(checked.lines, checked.trees, 'fr'),
    outputs: lines.map((l) => l.name),
    preview,
  };
}

// --- For promoters: their deal on an event, in words ------------------------------------------------

const dealCache = new Map<string, string[]>();

const isZero = (n: RuleNode | undefined) => !!n && n.k === 'num' && !n.v;

/**
 * The rule that applies to a promoter on an event, line by line in words, in their language; lines that
 * always give 0 are left out. Never the rule itself. Empty when the engine cannot be reached.
 */
export async function dealInWords(userId: number, eventId: number, lang: Lang): Promise<string[]> {
  const rule = ruleFor(userId, eventId);
  const types = listRewardTypes();
  const key = `${rule.key}:${lang}:${types.map((t) => `${t.key}=${t.label_en}/${t.label_fr}`).join(',')}`;
  const cached = dealCache.get(key);
  if (cached) return cached;
  try {
    const checked = await checkRule(rule.lines.map((l) => `${l.name} = ${l.expr}`).join('\n'), ruleOutputs());
    const lines = checked.lines.filter((l) => !isZero(checked.trees.get(l.name)));
    const words = ruleInWords(lines, checked.trees, lang);
    if (dealCache.size > 500) dealCache.clear();
    dealCache.set(key, words);
    return words;
  } catch (err) {
    if (err instanceof RulesEngineUnavailable) return [];
    throw err;
  }
}

/** "You sold 12: $60.00, 2 × VIP, 2 × GA list." / "Tu as vendu 12 : 60,00 $, 2 × VIP, 2 × Liste GA." */
export function resultSentence(
  tickets: number,
  earning: { commission: number; bonus: number; rewards: Record<string, number> } | undefined,
  outputs: string[],
  currency: string,
  lang: Lang,
): string {
  const money = (cents: number) =>
    lang === 'fr' ? `${(cents / 100).toFixed(2).replace('.', ',')} $` : formatMoney(cents, currency);
  const parts: string[] = [];
  if (outputs.includes('commission')) parts.push(money(earning?.commission ?? 0));
  if (outputs.includes('bonus') && (earning?.bonus ?? 0) > 0) parts.push(`${money(earning!.bonus)} ${lang === 'fr' ? 'de bonus' : 'bonus'}`);
  for (const name of outputs) {
    if (name === 'commission' || name === 'bonus' || name === 'merch') continue;
    const n = earning?.rewards[name];
    // The label is the reward's name, which cannot be put in the plural: "4 × Free ticket".
    if (n !== undefined) parts.push(`${n} × ${labelOf(name, lang)}`);
  }
  const sold = lang === 'fr' ? `Tu as vendu ${tickets}` : `You sold ${tickets}`;
  return parts.length ? `${sold}${lang === 'fr' ? ' : ' : ': '}${parts.join(', ')}.` : `${sold}.`;
}

