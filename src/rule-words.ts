import type { RuleNode } from './rules-engine';

/*
 * A rule line in plain words, in English or French, from the tree the rules engine sends back (no AI).
 * The common shapes read naturally: per ticket, a percentage of sales, thresholds, "every N", caps,
 * if/else, sums. Anything else is described by what it reads.
 */

export type Lang = 'en' | 'fr';
export type Unit = 'money' | 'count';

type Ctx = { lang: Lang; unit: Unit };

const VAR_WORDS: Record<string, { en: string; fr: string }> = {
  tickets_sold: { en: 'tickets sold', fr: 'billets vendus' },
  tickets_awaiting: { en: 'tickets awaiting payment', fr: 'billets en attente de paiement' },
  orders: { en: 'orders', fr: 'commandes' },
  full_price_sales: { en: 'sales at full price', fr: 'ventes au plein prix' },
  paid_by_customers: { en: 'what customers paid', fr: 'ce que les clients ont payé' },
  codes_used: { en: 'codes used', fr: 'codes utilisés' },
  outside_tickets: { en: 'tickets sold outside the ticketing site', fr: 'billets vendus hors billetterie' },
  outside_sales: { en: 'sales outside the ticketing site', fr: 'ventes hors billetterie' },
  event_tickets_sold: { en: 'tickets sold for the whole event', fr: 'billets vendus pour tout l’événement' },
  event_promoters: { en: 'promoters selling the event', fr: 'promoteurs qui vendent l’événement' },
  days_before_event: { en: 'days before the event', fr: 'jours avant l’événement' },
  event_dates: { en: 'dates of the event', fr: 'dates de l’événement' },
  lifetime_tickets: { en: 'tickets sold in all', fr: 'billets vendus en tout' },
  events_promoted: { en: 'events promoted', fr: 'événements promus' },
  level: { en: 'level', fr: 'niveau' },
  is_team_lead: { en: 'team lead', fr: 'chef d’équipe' },
  team_size: { en: 'promoters on the team', fr: 'promoteurs dans l’équipe' },
  team_tickets_sold: { en: 'tickets sold by the team', fr: 'billets vendus par l’équipe' },
  team_full_price_sales: { en: 'the team’s sales at full price', fr: 'ventes au plein prix de l’équipe' },
  team_commission: { en: 'the team’s commission', fr: 'commission de l’équipe' },
  commission: { en: 'your commission', fr: 'ta commission' },
};

const TICKETS = new Set(['tickets_sold', 'outside_tickets']);
const SALES = new Set(['full_price_sales', 'outside_sales']);

const w = (ctx: Ctx, en: string, fr: string) => (ctx.lang === 'en' ? en : fr);

function fmtNumber(n: number, lang: Lang): string {
  const s = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
  return lang === 'fr' ? s.replace('.', ',') : s;
}

function fmtMoney(n: number, lang: Lang): string {
  const fixed = n.toFixed(2);
  return lang === 'en' ? `$${fixed}` : `${fixed.replace('.', ',')} $`;
}

const value = (n: number, ctx: Ctx) => (ctx.unit === 'money' ? fmtMoney(n, ctx.lang) : fmtNumber(n, ctx.lang));

const isNum = (n: RuleNode): n is { k: 'num'; v?: number } => n.k === 'num';
const num = (n: RuleNode) => (isNum(n) ? (n.v ?? 0) : NaN);
const call = (n: RuleNode, op: string) => n.k === 'call' && n.s === op;
const args = (n: RuleNode) => (n.k === 'call' ? (n.a ?? []) : []);

/** The variables a sum reads, when it is only variables added together (tickets_sold + outside_tickets). */
function varSum(n: RuleNode): string[] | null {
  if (n.k === 'var') return [n.s];
  if (call(n, '_+_')) {
    const [a, b] = args(n);
    const left = a && varSum(a);
    const right = b && varSum(b);
    return left && right ? [...left, ...right] : null;
  }
  return null;
}

/** expr × k (or k × expr, expr × k / 100, expr / k): the variables and the factor; null otherwise. */
function linear(n: RuleNode): { vars: string[]; factor: number } | null {
  const vars = varSum(n);
  if (vars) return { vars, factor: 1 };
  if (call(n, '_*_')) {
    const [a, b] = args(n);
    if (a && b && isNum(b)) {
      const inner = linear(a);
      return inner && { vars: inner.vars, factor: inner.factor * num(b) };
    }
    if (a && b && isNum(a)) {
      const inner = linear(b);
      return inner && { vars: inner.vars, factor: inner.factor * num(a) };
    }
  }
  if (call(n, '_/_')) {
    const [a, b] = args(n);
    if (a && b && isNum(b) && num(b) !== 0) {
      const inner = linear(a);
      return inner && { vars: inner.vars, factor: inner.factor / num(b) };
    }
  }
  return null;
}

function linearWords(l: { vars: string[]; factor: number }, ctx: Ctx): string | null {
  const tickets = l.vars.every((v) => TICKETS.has(v));
  const sales = l.vars.every((v) => SALES.has(v));
  const outside = l.vars.some((v) => v.startsWith('outside_'));
  if (tickets) {
    const each = value(l.factor, ctx);
    return outside
      ? w(ctx, `${each} per ticket sold, sales outside the ticketing site included`, `${each} par billet vendu, ventes hors billetterie comprises`)
      : w(ctx, `${each} per ticket sold`, `${each} par billet vendu`);
  }
  if (l.vars.length === 1 && l.vars[0] === 'team_full_price_sales' && ctx.unit === 'money') {
    const percent = `${fmtNumber(Number((l.factor * 100).toFixed(4)), ctx.lang)}${ctx.lang === 'fr' ? ' %' : '%'}`;
    return w(ctx, `${percent} of your team’s sales at full price`, `${percent} des ventes au plein prix de ton équipe`);
  }
  if (sales && ctx.unit === 'money') {
    const percent = `${fmtNumber(Number((l.factor * 100).toFixed(4)), ctx.lang)}${ctx.lang === 'fr' ? ' %' : '%'}`;
    return outside
      ? w(ctx, `${percent} of your sales at full price, sales outside the ticketing site included`, `${percent} de tes ventes au plein prix, ventes hors billetterie comprises`)
      : w(ctx, `${percent} of your sales at full price`, `${percent} de tes ventes au plein prix`);
  }
  if (l.vars.length === 1) {
    const v = VAR_WORDS[l.vars[0]!];
    if (v) return w(ctx, `${value(l.factor, ctx)} per ${v.en.replace(/s$/, '')}`, `${value(l.factor, ctx)} par ${v.fr.replace(/s$/, '').replace(/s /, ' ')}`);
  }
  return null;
}

/** "from 5 tickets sold", "from your first sale", "if your level is Gold"… for a condition. */
function condition(n: RuleNode, ctx: Ctx): string | null {
  if (call(n, '_>_') || call(n, '_!=_')) {
    const [a, b] = args(n);
    // "commission > 0": whether a commission is earned at all.
    if (a?.k === 'var' && b && isNum(b) && num(b) === 0) {
      if (a.s === 'commission') return w(ctx, 'if you earn a commission', 'si tu touches une commission');
      if (a.s === 'team_commission') return w(ctx, 'if your team earns a commission', 'si ton équipe touche une commission');
    }
  }
  if (call(n, '_>=_') || call(n, '_>_')) {
    const [a, b] = args(n);
    if (a?.k === 'var' && b && isNum(b)) {
      const at = call(n, '_>_') ? num(b) + 1 : num(b);
      if (TICKETS.has(a.s) || a.s === 'tickets_sold') {
        return at <= 1 ? w(ctx, 'from your first sale', 'dès ta première vente') : w(ctx, `from ${fmtNumber(at, 'en')} tickets sold`, `dès ${fmtNumber(at, 'fr')} billets vendus`);
      }
      const v = VAR_WORDS[a.s];
      if (v) return w(ctx, `once ${v.en} reach ${fmtNumber(at, 'en')}`, `dès ${fmtNumber(at, 'fr')} ${v.fr}`);
    }
  }
  if (call(n, '_==_')) {
    const [a, b] = args(n);
    if (a?.k === 'var' && a.s === 'level' && b?.k === 'str') return w(ctx, `if your level is ${b.s}`, `si ton niveau est ${b.s}`);
  }
  if (n.k === 'var' && n.s === 'is_team_lead') return w(ctx, 'if you are a team lead', 'si tu es chef d’équipe');
  if (call(n, '_&&_')) {
    const [a, b] = args(n);
    const left = a && condition(a, ctx);
    const right = b && condition(b, ctx);
    if (left && right) return `${left} ${w(ctx, 'and', 'et')} ${right}`;
  }
  return null;
}

function words(n: RuleNode, ctx: Ctx): string | null {
  if (isNum(n)) return value(num(n), ctx);
  const l = linear(n);
  if (l) {
    const said = linearWords(l, ctx);
    if (said) return said;
  }
  // floor(x / n) × c: c for every n
  const every = everyN(n);
  if (every) {
    const [what, count, after] = every;
    const per = what.every((v) => TICKETS.has(v));
    if (per) {
      const c = value(count, ctx);
      const first = after === 1 ? w(ctx, 'the first one', 'le premier') : w(ctx, `the first ${after}`, `les ${after} premiers`);
      return after > 0
        ? w(ctx, `${c} more for every ${fmtNumber(every[3], 'en')} tickets sold after ${first}`, `${c} de plus par tranche de ${fmtNumber(every[3], 'fr')} billets vendus après ${first}`)
        : w(ctx, `${c} for every ${fmtNumber(every[3], 'en')} tickets sold`, `${c} par tranche de ${fmtNumber(every[3], 'fr')} billets vendus`);
    }
  }
  // c ? x : y
  if (call(n, '_?_:_')) {
    const [c, yes, no] = args(n);
    const when = c && condition(c, ctx);
    const then = yes && words(yes, ctx);
    const otherwise = no && words(no, ctx);
    if (when && then && otherwise) {
      return isNum(no!) && num(no!) === 0 ? `${then} ${when}` : `${then} ${when}, ${w(ctx, 'otherwise', 'sinon')} ${otherwise}`;
    }
  }
  // min(x, cap) / max(x, floor)
  if (call(n, 'min') || call(n, 'max')) {
    const parts = args(n);
    const limit = parts.find(isNum);
    const rest = parts.filter((p) => !isNum(p));
    if (limit && rest.length === 1) {
      const said = words(rest[0]!, ctx);
      if (said) return call(n, 'min') ? w(ctx, `${said}, up to ${value(num(limit), ctx)}`, `${said}, jusqu’à ${value(num(limit), ctx)}`) : w(ctx, `${said}, at least ${value(num(limit), ctx)}`, `${said}, au moins ${value(num(limit), ctx)}`);
    }
  }
  if (call(n, 'round') || call(n, 'floor') || call(n, 'ceil')) {
    const [a] = args(n);
    const said = a && words(a, ctx);
    if (said) return call(n, 'round') ? w(ctx, `${said}, rounded`, `${said}, arrondi`) : said;
  }
  // a + b: both said
  if (call(n, '_+_')) {
    const [a, b] = args(n);
    const left = a && words(a, ctx);
    const right = b && words(b, ctx);
    // "1 from your first sale, then 1 more for every 5…"; otherwise "…, plus …".
    if (left && right) return / more | de plus /.test(right) ? `${left}, ${w(ctx, 'then', 'puis')} ${right}` : `${left}, plus ${right}`;
  }
  return null;
}

/** floor((x - after) / n) × count, possibly behind a "x > after ?" guard: [vars, count, after, n]. */
function everyN(n: RuleNode): [string[], number, number, number] | null {
  if (call(n, '_?_:_')) {
    const [c, yes, no] = args(n);
    if (c && yes && no && isNum(no) && num(no) === 0 && (call(c, '_>_') || call(c, '_>=_'))) return everyN(yes);
  }
  let count = 1;
  let inner = n;
  if (call(n, '_*_')) {
    const [a, b] = args(n);
    if (a && b && isNum(b)) [inner, count] = [a, num(b)];
    else if (a && b && isNum(a)) [inner, count] = [b, num(a)];
  }
  if (!call(inner, 'floor')) return null;
  const [division] = args(inner);
  if (!division || !call(division, '_/_')) return null;
  const [top, by] = args(division);
  if (!top || !by || !isNum(by)) return null;
  const plain = varSum(top);
  if (plain) return [plain, count, 0, num(by)];
  if (call(top, '_-_')) {
    const [x, minus] = args(top);
    const vars = x && varSum(x);
    if (vars && minus && isNum(minus)) return [vars, count, num(minus), num(by)];
  }
  return null;
}

function variablesIn(n: RuleNode, out = new Set<string>()): Set<string> {
  if (n.k === 'var') out.add(n.s);
  for (const a of args(n)) variablesIn(a, out);
  return out;
}

/** One rule line in words: "VIP: 2 from your first sale." / "VIP : 2 dès ta première vente." */
export function describeLine(label: string, tree: RuleNode, unit: Unit, lang: Lang): string {
  const ctx = { lang, unit };
  const said = words(tree, ctx);
  const sep = lang === 'fr' ? ' : ' : ': ';
  if (said) return `${label}${sep}${said}.`;
  const vars = [...variablesIn(tree)].map((v) => VAR_WORDS[v]?.[lang] ?? v);
  return vars.length
    ? `${label}${sep}${w(ctx, 'worked out from', 'calculé à partir de')} ${vars.join(', ')}.`
    : `${label}${sep}${w(ctx, 'a set amount', 'un montant fixe')}.`;
}
