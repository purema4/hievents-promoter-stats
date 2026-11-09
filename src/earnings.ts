import { outsideByEvent, outsideTickets } from './adjustments';
import { codesFor, db, findUser, listUsers, type User } from './local-db';
import { dailyForCodes, statsForCodes, ticketsByEventAndCode, type CodeStats } from './hievents';
import { toCents, type EventEarning, type Rate } from './money';
import { levelFor } from './reward-rules';
import { evaluateRules } from './rules-engine';
import { ruleFor, teamRuleFor, type AppliedRule } from './rules';
import { FIXED_OUTPUTS, type RuleInputs } from './rule-variables';
import { isTeamLead, teamCodes, teamMembers, teamSalesByEvent } from './teams';

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

const uses = (rules: { lines: { expr: string }[] }[], name: string) => rules.some((r) => r.lines.some((l) => l.expr.includes(name)));

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


/**
 * What a team lead's promoters earned in commission, per event (cents), from their own rules. Like the
 * team's sales, only for the days each was on the team: an event's commission is counted in the share of
 * its sales (or tickets, for free ones) made while they were. Never the team lead's own commission.
 * Promoters deleted since have no rules any more and are left out.
 */
async function teamCommissionByEvent(lead: User): Promise<Map<number, number>> {
  const rows = db
    .query<{ member_id: number; from_day: string; to_day: string | null }, [number]>(
      'SELECT member_id, from_day, to_day FROM team_memberships WHERE lead_id = ? AND member_id IS NOT NULL',
    )
    .all(lead.id);
  const windows = new Map<number, { from: string; to: string | null }[]>();
  for (const r of rows) windows.set(r.member_id, [...(windows.get(r.member_id) ?? []), { from: r.from_day, to: r.to_day }]);
  const out = new Map<number, number>();
  for (const [memberId, spans] of windows) {
    const member = findUser(memberId);
    const codes = member ? codesFor(member.id) : [];
    if (!member || isTeamLead(member) || codes.length === 0) continue;
    const rate = await earningsFor(member, await statsForCodes(codes));
    const sold = new Map<number, { tickets: number; fp: number; inTickets: number; inFp: number }>();
    for (const d of await dailyForCodes(codes)) {
      if (d.event_id === undefined) continue;
      const s = sold.get(d.event_id) ?? { tickets: 0, fp: 0, inTickets: 0, inFp: 0 };
      const fp = toCents(d.full_price);
      s.tickets += d.tickets;
      s.fp += fp;
      if (spans.some((w) => d.day >= w.from && (!w.to || d.day <= w.to))) {
        s.inTickets += d.tickets;
        s.inFp += fp;
      }
      sold.set(d.event_id, s);
    }
    for (const [eventId, earning] of rate.events) {
      const s = sold.get(eventId);
      if (!s || earning.commission <= 0) continue;
      const share = s.fp > 0 ? s.inFp / s.fp : s.tickets > 0 ? s.inTickets / s.tickets : 0;
      if (share > 0) out.set(eventId, (out.get(eventId) ?? 0) + Math.round(earning.commission * share));
    }
  }
  return out;
}

/** The variables of each event for a promoter, with `sold` tickets instead of the real number when given. */
async function inputsBuilder(promoter: User, events: EventBasics[], allRules: { lines: { expr: string }[] }[]) {
  const outside = outsideByEvent(promoter.id);
  const lifetime = events.reduce((sum, e) => sum + e.tickets, 0) + outsideTickets(promoter.id);
  const lead = isTeamLead(promoter);
  const facts = uses(allRules, 'event_tickets_sold') || uses(allRules, 'event_promoters') ? await eventFacts(events.map((e) => e.id)) : new Map();
  const team =
    lead && (uses(allRules, 'team_tickets_sold') || uses(allRules, 'team_full_price_sales'))
      ? await teamSalesByEvent(promoter)
      : new Map<number, { tickets: number; fullPrice: number }>();
  const teamCommission = lead && uses(allRules, 'team_commission') ? await teamCommissionByEvent(promoter) : new Map<number, number>();
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
      // The team lead's own tickets and their promoters'; the sales are their promoters' alone (what team commission is on).
      team_tickets_sold: e.tickets + (team.get(e.id)?.tickets ?? 0) + extra,
      team_full_price_sales: (team.get(e.id)?.fullPrice ?? 0) / 100,
      team_commission: (teamCommission.get(e.id) ?? 0) / 100,
    };
  };

  return { inputsFor };
}

/**
 * Each event's variables for a promoter, for previewing a rule that is not saved: `lines` are the
 * draft's, so whole-event and team numbers are fetched when it reads them.
 */
export async function previewInputs(promoter: User, rows: CodeStats[], lines: { expr: string }[]): Promise<Map<number, (sold?: number) => RuleInputs>> {
  const events = basics(rows);
  const { inputsFor } = await inputsBuilder(promoter, events, [{ lines }]);
  return new Map(events.map((e) => [e.id, (sold?: number) => inputsFor(e, sold)]));
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
  const { inputsFor } = await inputsBuilder(promoter, events, allRules);

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
  // Team leads: their team rule, on top, on every event their team sells (and their own).
  const team = new Map<string, number>();
  const teamRule = isTeamLead(promoter) ? teamRuleFor(promoter.id) : null;
  if (teamRule && teamRule.lines.length > 0) {
    const memberRows = await statsForCodes(teamCodes(promoter.id));
    const currencyOf = new Map([...rows, ...memberRows].map((r) => [r.event_id, r.currency]));
    // Events only the team sold: their dates, none of the team lead's own sales.
    const teamOnly = basics(memberRows)
      .filter((e) => !events.some((x) => x.id === e.id))
      .map((e) => ({ ...e, tickets: 0, pending: 0, orders: 0, fullPrice: 0, paid: 0, codesUsed: 0 }));
    const all = [...events, ...teamOnly];
    const { inputsFor: teamInputs } = await inputsBuilder(promoter, all, [teamRule]);
    const { results, stale: teamStale } = await evaluateRules(
      { version: teamRule.key, lines: teamRule.lines },
      all.map((e) => ({ subject: `u${promoter.id}:e${e.id}:team`, variables: teamInputs(e) })),
    );
    stale ||= teamStale;
    for (const e of all) {
      const r = results.get(`u${promoter.id}:e${e.id}:team`);
      const currency = currencyOf.get(e.id) ?? 'CAD';
      for (const [name, value] of Object.entries(r?.outputs ?? {})) {
        if (!(value >= 0)) continue;
        if (name === 'commission' || name === 'bonus') team.set(currency, (team.get(currency) ?? 0) + Math.round(value * 100));
        else {
          // Rewards from the team rule land on the team lead's own events only.
          const own = byEvent.get(e.id);
          if (!own) continue;
          if (name === 'merch') own.merch += Math.floor(value);
          else own.rewards[name] = (own.rewards[name] ?? 0) + Math.floor(value);
        }
      }
    }
  }
  const versionIds = [...new Set([...allRules, ...(teamRule ? [teamRule] : [])].flatMap((r) => r.versionIds))].sort((a, b) => a - b);
  return { events: byEvent, stale, versionIds, team };
}
