import { outsideByEvent, outsideTickets } from './adjustments';
import { codesFor, listUsers, type User } from './local-db';
import { statsForCodes, ticketsByEventAndCode, type CodeStats } from './hievents';
import { toCents, type EventEarning, type Rate } from './money';
import { levelFor } from './reward-rules';
import { evaluateRules } from './rules-engine';
import { ruleFor, type AppliedRule } from './rules';
import { FIXED_OUTPUTS, type RuleInputs } from './rule-variables';
import { isTeamLead, teamMembers } from './teams';

/*
 * What each promoter earns, event by event, from their rules: commission, bonus, merch and rewards by
 * type. The variables of rule-variables.ts are filled in here, and every event of a promoter goes to the
 * rules engine in one call (one per distinct rule).
 */

const DAY = 86_400_000;
// How far to look for the next reward: sales up from now, and down to where the current one started.
const NEXT_WINDOW = 60;
const fixed = new Set<string>(FIXED_OUTPUTS.map((o) => o.name));

type EventBasics = {
  id: number;
  start: Date | null;
  end: Date | null;
  dates: number;
  tickets: number;
  pending: number;
  orders: number;
  fullPrice: number; // cents
  paid: number; // cents
  codesUsed: number;
};

function basics(rows: CodeStats[]): EventBasics[] {
  const events = new Map<number, EventBasics>();
  for (const r of rows) {
    const e = events.get(r.event_id) ?? {
      id: r.event_id, start: r.event_start, end: r.event_end, dates: r.event_dates,
      tickets: 0, pending: 0, orders: 0, fullPrice: 0, paid: 0, codesUsed: 0,
    };
    e.tickets += r.tickets_sold;
    e.pending += r.tickets_pending;
    e.orders += r.orders;
    e.fullPrice += toCents(r.full_price);
    e.paid += toCents(r.paid);
    if (r.tickets_sold > 0) e.codesUsed += 1;
    events.set(r.event_id, e);
  }
  return [...events.values()];
}

const uses = (rules: AppliedRule[], name: string) => rules.some((r) => r.lines.some((l) => l.expr.includes(name)));

// Whole events (every code), asked only when a rule reads them, and shared for a minute.
let factsCache: { at: number; byEvent: Map<number, { tickets: number; promoters: number }> } | null = null;
async function eventFacts(eventIds: number[]): Promise<Map<number, { tickets: number; promoters: number }>> {
  if (factsCache && Date.now() - factsCache.at < 60_000 && eventIds.every((id) => factsCache!.byEvent.has(id))) return factsCache.byEvent;
  const owner = new Map<string, number>();
  for (const u of listUsers()) for (const c of u.codes) owner.set(c.toLowerCase(), u.id);
  const byEvent = new Map<number, { tickets: number; sellers: Set<number> }>();
  for (const row of await ticketsByEventAndCode(eventIds)) {
    const e = byEvent.get(row.event_id) ?? { tickets: 0, sellers: new Set<number>() };
    e.tickets += row.tickets;
    const who = row.code ? owner.get(row.code) : undefined;
    if (who !== undefined && row.tickets > 0) e.sellers.add(who);
    byEvent.set(row.event_id, e);
  }
  const out = new Map(eventIds.map((id) => [id, { tickets: byEvent.get(id)?.tickets ?? 0, promoters: byEvent.get(id)?.sellers.size ?? 0 }]));
  factsCache = { at: Date.now(), byEvent: new Map([...(factsCache?.byEvent ?? []), ...out]) };
  return out;
}

/** Tickets the team (the team lead included) sold per event. */
async function teamTicketsByEvent(lead: User, own: EventBasics[]): Promise<Map<number, number>> {
  const out = new Map(own.map((e) => [e.id, e.tickets]));
  const codes = teamMembers(lead.id).flatMap((m) => codesFor(m.id));
  for (const r of await statsForCodes([...new Set(codes)])) out.set(r.event_id, (out.get(r.event_id) ?? 0) + r.tickets_sold);
  return out;
}

const emptyEarning = (versionIds: number[], errors: string[] = []): EventEarning => ({
  commission: 0, bonus: 0, merch: 0, rewards: {}, next: {}, versionIds, errors,
});

/**
 * A promoter's earnings on each of their events. With `next`, upcoming events also get the sales to the
 * next reward of each type, found by evaluating the rule with more (and fewer) tickets sold.
 */
export async function earningsFor(promoter: User, rows: CodeStats[], opts: { next?: boolean } = {}): Promise<Rate> {
  const events = basics(rows);
  const rules = new Map(events.map((e) => [e.id, ruleFor(promoter.id, e.id)]));
  const allRules = [...rules.values()];
  const outside = outsideByEvent(promoter.id);
  const lifetime = events.reduce((sum, e) => sum + e.tickets, 0) + outsideTickets(promoter.id);
  const lead = isTeamLead(promoter);
  const facts = uses(allRules, 'event_tickets_sold') || uses(allRules, 'event_promoters') ? await eventFacts(events.map((e) => e.id)) : new Map();
  const team = lead && uses(allRules, 'team_tickets_sold') ? await teamTicketsByEvent(promoter, events) : new Map<number, number>();
  const general: RuleInputs = {
    lifetime_tickets: lifetime,
    events_promoted: events.filter((e) => e.tickets > 0).length,
    level: levelFor(lifetime).level.name,
    is_team_lead: lead,
    team_size: lead ? teamMembers(promoter.id).length : 0,
  };

  const inputsFor = (e: EventBasics, sold = e.tickets): RuleInputs => {
    const out = outside.get(e.id);
    const extra = sold - e.tickets;
    const perTicket = e.tickets > 0 ? e.fullPrice / e.tickets : 0;
    return {
      ...general,
      tickets_sold: sold,
      tickets_awaiting: e.pending,
      orders: e.orders,
      full_price_sales: (e.fullPrice + extra * perTicket) / 100,
      paid_by_customers: e.paid / 100,
      codes_used: e.codesUsed,
      outside_tickets: out?.tickets ?? 0,
      outside_sales: (out?.cents ?? 0) / 100,
      event_tickets_sold: (facts.get(e.id)?.tickets ?? e.tickets) + extra,
      event_promoters: facts.get(e.id)?.promoters ?? (e.tickets > 0 ? 1 : 0),
      days_before_event: e.start ? Math.floor((e.start.getTime() - Date.now()) / DAY) : 0,
      event_dates: e.dates,
      lifetime_tickets: lifetime + extra,
      team_tickets_sold: (team.get(e.id) ?? e.tickets) + extra,
    };
  };

  // One call per distinct rule; probes for the next reward ride along in the same call.
  const groups = new Map<string, { rule: AppliedRule; items: { subject: string; variables: RuleInputs }[] }>();
  for (const e of events) {
    const rule = rules.get(e.id)!;
    const group = groups.get(rule.key) ?? { rule, items: [] };
    group.items.push({ subject: `u${promoter.id}:e${e.id}`, variables: inputsFor(e) });
    const upcoming = !e.end || e.end.getTime() >= Date.now();
    if (opts.next && upcoming && rule.lines.some((l) => !fixed.has(l.name))) {
      for (let t = Math.max(0, e.tickets - NEXT_WINDOW); t <= e.tickets + NEXT_WINDOW; t++) {
        if (t !== e.tickets) group.items.push({ subject: `u${promoter.id}:e${e.id}:t${t}`, variables: inputsFor(e, t) });
      }
    }
    groups.set(rule.key, group);
  }

  const byEvent = new Map<number, EventEarning>();
  let stale = false;
  for (const { rule, items } of groups.values()) {
    const { results, stale: groupStale } = await evaluateRules({ version: rule.key, lines: rule.lines }, items);
    stale ||= groupStale;
    for (const e of events.filter((x) => rules.get(x.id)!.key === rule.key)) {
      const r = results.get(`u${promoter.id}:e${e.id}`);
      const earning = emptyEarning(rule.versionIds, Object.entries(r?.errors ?? {}).map(([k, v]) => `${k}: ${v}`));
      for (const [name, value] of Object.entries(r?.outputs ?? {})) {
        if (!(value >= 0)) {
          earning.errors.push(`${name} gave ${value}; counted as 0`);
          continue;
        }
        if (name === 'commission') earning.commission = Math.round(value * 100);
        else if (name === 'bonus') earning.bonus = Math.round(value * 100);
        else if (name === 'merch') earning.merch = Math.floor(value);
        else earning.rewards[name] = Math.floor(value);
      }
      if (opts.next) {
        const at = (t: number) => (t === e.tickets ? r?.outputs : results.get(`u${promoter.id}:e${e.id}:t${t}`)?.outputs);
        for (const type of Object.keys(earning.rewards)) {
          const count = (t: number) => Math.floor(at(t)?.[type] ?? 0);
          const now = count(e.tickets);
          let nextAt: number | null = null;
          for (let t = e.tickets + 1; t <= e.tickets + NEXT_WINDOW && at(t); t++) {
            if (count(t) > now) {
              nextAt = t;
              break;
            }
          }
          let fromAt = Math.max(0, e.tickets - NEXT_WINDOW);
          for (let t = e.tickets; t > Math.max(0, e.tickets - NEXT_WINDOW); t--) {
            if (count(t - 1) < now) {
              fromAt = t;
              break;
            }
          }
          earning.next[type] =
            nextAt === null ? null : { in: nextAt - e.tickets, progress: Math.floor(((e.tickets - fromAt) / Math.max(1, nextAt - fromAt)) * 100) };
        }
      }
      byEvent.set(e.id, earning);
    }
  }
  return { events: byEvent, stale, versionIds: [...new Set(allRules.flatMap((r) => r.versionIds))].sort((a, b) => a - b) };
}
