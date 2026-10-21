import type { Context } from 'hono';
import { announcePayoutRequest, announceRewardRequest, commissionEvents, emailLoginLink, finishPayout, finishReward, promoterData } from './actions';
import { audit } from './audit';
import type { ApiToken } from './api-tokens';
import { rangeBounds, today, type Range } from './chart';
import { rateFor, setEventRule } from './commission';
import { config } from './config';
import { allPromoCodes, dailyForCodes } from './hievents';
import { leaderboard, type Sort } from './leaderboard';
import { pageLink, setAlias, suggestAlias } from './links';
import { codeOwners, codesFor, createUser, findUser, findUserByEmail, listUsers, normalizeCodes, setCodes, usualRuleFor, type User } from './local-db';
import { commissionOn, describeRate, describeRule, formatMoney, toCents, totalsByCurrency, type EventRule } from './money';
import { findPayout, listPayouts, payoutsFor, requestPayout, type PayoutRequest, type RequestResult } from './payouts';
import { filterCodes } from './promo-code-list';
import { summarizeEvents } from './promoter-views';
import { findRewardRequest, levelFor, listRewardRequests, requestReward, rewardRequestsFor, type RewardRequest, type RewardResult } from './rewards';
import { pageShortLink, prepareShortLinks, shareLink } from './short-links';
import { isTeamLead, teamLeadOf, teamMember, teamMembers } from './teams';

/*
 * Everything the API and the MCP server can do, described once: the REST routes (api.ts) and the MCP
 * tools are both made from this list. Every operation runs as the person the key or connection
 * belongs to, and sees exactly what they see in the app. Money is always in cents, with its currency.
 */

export type Call = { user: User; token: ApiToken; c: Context };

export class ApiError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 429,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// --- Input: a small subset of JSON Schema, checked by hand -------------------------------------------

type Field =
  | { type: 'string'; description: string; enum?: readonly string[]; maxLength?: number; default?: string }
  | { type: 'integer'; description: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description: string; default?: boolean }
  | { type: 'array'; description: string; items: { type: 'string'; maxLength: number }; maxItems: number };

type Input = { properties: Record<string, Field>; required?: string[] };

export function inputSchema(input: Input) {
  return { type: 'object', properties: input.properties, required: input.required ?? [], additionalProperties: false };
}

/** The checked input. From a query string, numbers and true/false arrive as text and are converted. */
export function parseInput(input: Input, raw: Record<string, unknown>, fromQuery = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(raw)) {
    if (!Object.hasOwn(input.properties, name)) throw new ApiError(400, 'invalid_input', `Unknown field "${name}".`);
  }
  for (const [name, field] of Object.entries(input.properties)) {
    let value = raw[name];
    if (value === undefined || value === null || (fromQuery && value === '')) {
      if (input.required?.includes(name)) throw new ApiError(400, 'invalid_input', `"${name}" is required.`);
      if ('default' in field && field.default !== undefined) out[name] = field.default;
      continue;
    }
    const wrong = (what: string) => new ApiError(400, 'invalid_input', `"${name}" must be ${what}.`);
    if (field.type === 'integer') {
      if (fromQuery && typeof value === 'string' && /^-?[0-9]{1,15}$/.test(value)) value = Number(value);
      if (typeof value !== 'number' || !Number.isInteger(value)) throw wrong('a whole number');
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) {
        throw wrong(`from ${field.minimum ?? '…'} to ${field.maximum ?? '…'}`);
      }
    } else if (field.type === 'boolean') {
      if (fromQuery && (value === 'true' || value === 'false')) value = value === 'true';
      if (typeof value !== 'boolean') throw wrong('true or false');
    } else if (field.type === 'string') {
      if (typeof value !== 'string') throw wrong('text');
      if (field.enum && !field.enum.includes(value)) throw wrong(`one of: ${field.enum.join(', ')}`);
      if (field.maxLength && value.length > field.maxLength) throw wrong(`at most ${field.maxLength} characters`);
    } else {
      if (fromQuery && typeof value === 'string') value = value.split(',');
      if (!Array.isArray(value) || value.length > field.maxItems || value.some((v) => typeof v !== 'string' || v.length > field.items.maxLength)) {
        throw wrong(`a list of at most ${field.maxItems} texts`);
      }
    }
    out[name] = value;
  }
  return out;
}

// --- The operations ---------------------------------------------------------------------------------

export type Op = {
  name: string;
  title: string;
  description: string;
  method: 'GET' | 'POST';
  // Under /api/v1; :name parts are filled into the input.
  path: string;
  // Who may use it: anyone (default); admins and anyone on a team; admins and team leads; admins only.
  who?: 'team' | 'lead' | 'admin';
  // Changes something: only for keys and connections allowed to make changes.
  write?: boolean;
  // Cannot be taken back from here (MCP clients may ask before using it).
  destructive?: boolean;
  input: Input;
  run: (call: Call, input: any) => Promise<unknown> | unknown;
};

const promoterId: Field = {
  type: 'integer',
  description: 'Whose numbers: leave out for your own. Admins can give any promoter id, team leads one of their promoters.',
  minimum: 1,
};
const range: Field = { type: 'string', enum: ['7', '30', '90', 'all'], default: '30', description: 'The last 7, 30 or 90 days, or all time.' };
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const roleOf = (u: User) => (u.is_admin ? 'admin' : isTeamLead(u) ? 'team_lead' : 'promoter');
const isOver = (end: Date | null) => !!end && end.getTime() < Date.now();

/** The promoter a call is about: the caller, or someone they are allowed to see. */
function promoterFor(user: User, id: number | undefined): User {
  if (id === undefined || id === user.id) return user;
  const other = user.is_admin ? findUser(id) : teamMember(user, id);
  if (!other) throw new ApiError(404, 'not_found', 'No promoter with that id that you can see.');
  return other;
}

/** Payouts and rewards: only one's own, except for admins. */
function selfOrAdmin(user: User, id: number | undefined): User | null {
  if (id === undefined) return user.is_admin ? null : user;
  if (id === user.id) return user;
  if (!user.is_admin) throw new ApiError(404, 'not_found', 'No promoter with that id that you can see.');
  const other = findUser(id);
  if (!other) throw new ApiError(404, 'not_found', 'No promoter with that id.');
  return other;
}

const payoutOut = (p: PayoutRequest) => ({
  id: p.id,
  promoter_id: p.user_id,
  promoter_name: p.promoter_name,
  amount_cents: p.amount_cents,
  currency: p.currency,
  method: p.method,
  details: p.details,
  note: p.note,
  status: p.status === 'rejected' ? 'declined' : p.status,
  team_note: p.admin_note,
  requested_at: p.created_at,
  handled_at: p.processed_at,
});

const rewardOut = (r: RewardRequest) => ({
  id: r.id,
  promoter_id: r.user_id,
  promoter_name: r.promoter_name,
  kind: r.kind,
  event_id: r.event_id,
  event_title: r.event_title,
  quantity: r.quantity,
  details: r.details,
  status: r.status === 'fulfilled' ? 'given' : r.status === 'rejected' ? 'declined' : r.status,
  team_note: r.admin_note,
  requested_at: r.created_at,
  handled_at: r.processed_at,
});

const payoutProblem: Record<Exclude<RequestResult, 'ok'>, string> = {
  invalid_amount: 'amount_cents must be a whole number of cents above 0.',
  too_much: 'That is more than the balance available to request.',
  already_pending: 'There is already a request waiting for this currency.',
  missing_method: `method must be one of: ${config.payoutMethods.join(', ')}.`,
  cash_step: `Cash is paid in steps of ${formatMoney(config.cashStepCents, 'CAD')}.`,
};
const rewardProblem: Record<Exclude<RewardResult, 'ok'>, string> = {
  not_available: 'That reward is not available: see rewards in get_promoter_stats for what can be requested.',
  missing_details: 'For merch, say which item and size in details.',
};

export const ops: Op[] = [
  {
    name: 'get_me',
    title: 'Who am I',
    description: 'The account this key or connection belongs to: name, role (admin, team_lead or promoter), promo codes, public page and what the access allows.',
    method: 'GET',
    path: '/me',
    input: { properties: {} },
    run: ({ user, token }) => {
      const lead = teamLeadOf(user);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: roleOf(user),
        codes: codesFor(user.id),
        alias: user.alias ?? null,
        page_link: user.page_hidden_at ? null : (pageShortLink(user) ?? pageLink(user)),
        commission: describeRate(rateFor(user)),
        team_lead: lead ? { id: lead.id, name: lead.name } : null,
        access: token.can_write ? 'read and change' : 'read only',
        timezone: config.timezone,
      };
    },
  },
  {
    name: 'get_promoter_stats',
    title: 'Promoter stats',
    description:
      'A promoter\'s sales as on their dashboard: totals, each event (tickets sold, orders, sales at full price, commission), balances (earned, paid out, available to request), level, and the free tickets and merch they can request.',
    method: 'GET',
    path: '/stats',
    input: { properties: { promoter_id: promoterId } },
    run: async ({ user }, input: { promoter_id?: number }) => {
      const p = promoterFor(user, input.promoter_id);
      const data = await promoterData(p);
      const events = summarizeEvents(data.rows, data.percent);
      const { level, next } = levelFor(data.rewards.totalSold);
      return {
        promoter: { id: p.id, name: p.name },
        codes: data.codes,
        commission: describeRate(data.percent),
        totals: totalsByCurrency(data.rows, data.percent).map((t) => ({
          currency: t.currency,
          tickets_sold: t.tickets,
          tickets_pending: t.pending,
          orders: t.orders,
          full_price_cents: t.fullPrice,
          paid_cents: t.paid,
          commission_cents: t.commission,
        })),
        tickets_sold_all_time: data.rewards.totalSold,
        tickets_sold_outside_hievents: data.rewards.outsideSold,
        level: { name: level.name, next: next?.name ?? null, tickets_to_next: next ? Math.max(0, next.at - data.rewards.totalSold) : null },
        balances: data.balances.map((b) => ({
          currency: b.currency,
          earned_cents: b.earned,
          from_sales_cents: b.fromSales,
          from_team_cents: b.fromTeam,
          added_by_team_cents: b.added,
          paid_out_cents: b.paidOut,
          pending_cents: b.pending,
          available_cents: b.available,
        })),
        events: events.map((e) => ({
          event_id: e.id,
          title: e.title,
          start: iso(e.start),
          end: iso(e.end),
          over: isOver(e.end),
          currency: e.currency,
          codes: e.codes,
          tickets_sold: e.tickets,
          tickets_pending: e.pending,
          orders: e.orders,
          full_price_cents: e.fullPrice,
          paid_cents: e.paid,
          commission_cents: e.commission,
          commission_rate: describeRule(data.percent.events.get(e.id) ?? data.percent.usual, e.currency),
          media_drive: data.media.get(e.id) ?? null,
        })),
        rewards: {
          free_tickets: data.rewards.tickets.map((t) => ({
            event_id: t.event.id,
            event_title: t.event.title,
            available: t.available,
            earned: t.earned,
            used: t.used,
            sales_to_next: t.nextIn,
          })),
          merch: {
            available: data.rewards.merch.available,
            earned: data.rewards.merch.earned,
            used: data.rewards.merch.used,
            sales_to_next: data.rewards.merch.nextIn,
            next_item: data.rewards.merch.nextLabel || null,
          },
        },
      };
    },
  },
  {
    name: 'get_daily_sales',
    title: 'Sales by day',
    description: `Tickets sold and commission per day (in ${config.timezone}) for a period, for all of a promoter's events or one.`,
    method: 'GET',
    path: '/sales/daily',
    input: {
      properties: { promoter_id: promoterId, event_id: { type: 'integer', description: 'Only this event.', minimum: 1 }, range },
    },
    run: async ({ user }, input: { promoter_id?: number; event_id?: number; range: Range }) => {
      const p = promoterFor(user, input.promoter_id);
      const rate = rateFor(p);
      const days = await dailyForCodes(codesFor(p.id), input.event_id);
      const { from, to } = rangeBounds(input.range, days, today());
      const rows = days
        .filter((d) => d.day >= from && d.day <= to)
        .map((d) => ({
          day: d.day,
          event_id: d.event_id,
          currency: d.currency,
          tickets: d.tickets,
          full_price_cents: toCents(d.full_price),
          commission_cents: commissionOn(rate, d.event_id, d.full_price, d.tickets),
        }));
      return {
        from,
        to,
        tickets: rows.reduce((sum, r) => sum + r.tickets, 0),
        commission_cents: rows.reduce((sum, r) => sum + r.commission_cents, 0),
        days: rows,
      };
    },
  },
  {
    name: 'get_share_links',
    title: 'Links to share',
    description: "A promoter's ticket links for each upcoming event (with their promo code, short links when there are some) and their public page.",
    method: 'GET',
    path: '/links',
    input: { properties: { promoter_id: promoterId } },
    run: async ({ user }, input: { promoter_id?: number }) => {
      const p = promoterFor(user, input.promoter_id);
      const data = await promoterData(p);
      const upcoming = summarizeEvents(data.rows, data.percent).filter((e) => !isOver(e.end));
      const links = upcoming.flatMap((e) => e.codes.map((code) => ({ event: { id: e.id, title: e.title }, code, start: e.start })));
      await prepareShortLinks(p, links, { page: !p.page_hidden_at });
      return {
        page_link: p.page_hidden_at ? null : (pageShortLink(p) ?? pageLink(p)),
        events: links.map((l) => ({ event_id: l.event.id, title: l.event.title, start: iso(l.start), code: l.code, link: shareLink(p, l.event, l.code) })),
      };
    },
  },
  {
    name: 'list_payouts',
    title: 'Payout requests',
    description: 'Payout requests: your own, or for admins everyone\'s (or one promoter\'s), newest first.',
    method: 'GET',
    path: '/payouts',
    input: {
      properties: {
        promoter_id: { ...promoterId, description: 'Admins: only this promoter. Leave out for your own (admins: everyone).' },
        status: { type: 'string', enum: ['pending', 'done', 'all'], default: 'all', description: 'Waiting, handled (paid or declined), or all.' },
      },
    },
    run: ({ user }, input: { promoter_id?: number; status: 'pending' | 'done' | 'all' }) => {
      const p = selfOrAdmin(user, input.promoter_id);
      const rows = p
        ? payoutsFor(p.id).filter((r) => input.status === 'all' || (input.status === 'pending') === (r.status === 'pending'))
        : input.status === 'all'
          ? [...listPayouts('pending'), ...listPayouts('done')].sort((a, b) => b.id - a.id)
          : listPayouts(input.status);
      return { payouts: rows.map(payoutOut) };
    },
  },
  {
    name: 'list_reward_requests',
    title: 'Reward requests',
    description: 'Requests for free tickets and merch: your own, or for admins everyone\'s (or one promoter\'s), newest first.',
    method: 'GET',
    path: '/rewards',
    input: {
      properties: {
        promoter_id: { ...promoterId, description: 'Admins: only this promoter. Leave out for your own (admins: everyone).' },
        status: { type: 'string', enum: ['pending', 'done', 'all'], default: 'all', description: 'Waiting, handled (given or declined), or all.' },
      },
    },
    run: ({ user }, input: { promoter_id?: number; status: 'pending' | 'done' | 'all' }) => {
      const p = selfOrAdmin(user, input.promoter_id);
      const rows = p
        ? rewardRequestsFor(p.id).filter((r) => input.status === 'all' || (input.status === 'pending') === (r.status === 'pending'))
        : input.status === 'all'
          ? [...listRewardRequests('pending'), ...listRewardRequests('done')].sort((a, b) => b.id - a.id)
          : listRewardRequests(input.status);
      return { rewards: rows.map(rewardOut) };
    },
  },
  {
    name: 'get_leaderboard',
    title: 'Leaderboard',
    description:
      'Promoters ranked for a period. Admins see everyone; team leads their team; promoters on a team see their team\'s tickets and sales (no commission).',
    method: 'GET',
    path: '/leaderboard',
    who: 'team',
    input: {
      properties: {
        range,
        sort: { type: 'string', enum: ['tickets', 'sales', 'commission'], default: 'tickets', description: 'Rank by tickets sold, sales or commission.' },
      },
    },
    run: async ({ user }, input: { range: Range; sort: Sort }) => {
      const lead = isTeamLead(user) ? user : teamLeadOf(user);
      const withMoney = !!user.is_admin || isTeamLead(user);
      const sort = !withMoney && input.sort === 'commission' ? 'tickets' : input.sort;
      const board = await leaderboard(input.range, sort, user.is_admin ? undefined : [lead!, ...teamMembers(lead!.id)]);
      return {
        range: input.range,
        currency: board.currency,
        team_lead: user.is_admin ? null : { id: lead!.id, name: lead!.name },
        tickets: board.totals.tickets,
        full_price_cents: board.totals.fullPrice,
        ...(withMoney ? { commission_cents: board.totals.commission } : {}),
        promoters: board.entries.map((e, i) => ({
          rank: i + 1,
          promoter_id: e.user.id,
          name: e.user.name,
          tickets: e.tickets,
          full_price_cents: e.fullPrice,
          ...(withMoney ? { commission_cents: e.commission } : {}),
          ...(user.is_admin ? { owed_cents: e.owed } : {}),
          last_sale: e.lastSale,
          level: e.level.name,
          tickets_sold_all_time: e.totalSold,
        })),
      };
    },
  },
  {
    name: 'list_promoters',
    title: 'Promoters',
    description: 'Admins: every account. Team leads: themselves and their promoters. With ids to use in the other tools.',
    method: 'GET',
    path: '/promoters',
    who: 'lead',
    input: { properties: {} },
    run: ({ user }) => {
      const people = user.is_admin ? listUsers() : [user, ...teamMembers(user.id)].map((u) => ({ ...u, codes: codesFor(u.id) }));
      return {
        promoters: people.map((u) => ({
          id: u.id,
          name: u.name,
          ...(user.is_admin ? { email: u.email, team_lead_id: u.team_lead_id ?? null, commission: describeRule(usualRuleFor(u)) } : {}),
          role: roleOf(u),
          alias: u.alias ?? null,
          codes: u.codes,
          last_seen_at: u.last_seen_at ? new Date(u.last_seen_at * 1000).toISOString() : null,
        })),
      };
    },
  },
  {
    name: 'list_promo_codes',
    title: 'Promo codes',
    description: 'Admins: every promo code in Hi.Events with its event, uses and which promoters have it, 25 at a time.',
    method: 'GET',
    path: '/promo-codes',
    who: 'admin',
    input: {
      properties: {
        search: { type: 'string', maxLength: 100, description: 'Part of a code, event or promoter name.' },
        show: { type: 'string', enum: ['all', 'assigned', 'unassigned'], default: 'all', description: 'All codes, or only those a promoter has, or nobody has.' },
        when: { type: 'string', enum: ['upcoming', 'past', 'all'], default: 'upcoming', description: 'Events not over yet, over, or all.' },
        page: { type: 'integer', minimum: 1, maximum: 1000, description: 'Page number, from 1.' },
      },
    },
    run: async (_call, input: { search?: string; show: 'all' | 'assigned' | 'unassigned'; when: 'upcoming' | 'past' | 'all'; page?: number }) => {
      const result = filterCodes(await allPromoCodes(), codeOwners(), { q: (input.search ?? '').trim(), show: input.show, when: input.when, page: input.page ?? 1 });
      return {
        total: result.total,
        page: result.page,
        pages: result.pages,
        codes: result.rows.map((r) => ({ code: r.code, event_title: r.event_title, event_start: iso(r.event_start), uses: r.order_usage_count, promoters: r.owners })),
      };
    },
  },
  {
    name: 'list_events',
    title: 'Current events',
    description: 'Admins: events that are not over (drafts included) with the promoters who have a code on each, and their commission there.',
    method: 'GET',
    path: '/events',
    who: 'admin',
    input: { properties: {} },
    run: async () => ({
      events: (await commissionEvents()).map((e) => ({
        event_id: e.id,
        title: e.title,
        start: iso(e.start),
        currency: e.currency,
        promoters: e.promoters.map((p) => {
          const rate = rateFor(p);
          return { id: p.id, name: p.name, commission: describeRule(rate.events.get(e.id) ?? rate.usual, e.currency), event_rate: rate.events.has(e.id) };
        }),
      })),
    }),
  },

  // --- Changes ---

  {
    name: 'request_payout',
    title: 'Request a payout',
    description:
      'Asks the team to pay out some of your available balance. The admins are told. Method and details default to the ones used last time.',
    method: 'POST',
    path: '/payouts',
    write: true,
    input: {
      properties: {
        amount_cents: { type: 'integer', minimum: 1, maximum: 100_000_000, description: 'How much, in cents (2550 is $25.50).' },
        currency: { type: 'string', maxLength: 3, description: 'Which balance, like CAD. Needed only with more than one currency.' },
        method: { type: 'string', enum: config.payoutMethods, description: 'How to be paid.' },
        details: { type: 'string', maxLength: 200, description: 'Where to send it, like the e-Transfer email.' },
        note: { type: 'string', maxLength: 500, description: 'A note for the team.' },
      },
      required: ['amount_cents'],
    },
    run: async ({ user, c }, input: { amount_cents: number; currency?: string; method?: string; details?: string; note?: string }) => {
      const data = await promoterData(user);
      const balance = input.currency
        ? data.balances.find((b) => b.currency === input.currency!.toUpperCase())
        : data.balances.length === 1
          ? data.balances[0]
          : undefined;
      if (!balance) {
        throw new ApiError(400, 'invalid_input', data.balances.length ? `Say which currency: ${data.balances.map((b) => b.currency).join(' or ')}.` : 'There is no balance to request yet.');
      }
      const method = input.method ?? user.payout_method ?? (config.payoutMethods.length === 1 ? config.payoutMethods[0]! : '');
      const details = (input.details ?? user.payout_details ?? '').slice(0, 200);
      const note = input.note ?? '';
      const result = requestPayout(user, balance, { amountCents: input.amount_cents, method, details, note });
      if (result !== 'ok') throw new ApiError(400, result, payoutProblem[result]);
      audit(c, 'payout.requested', { userId: user.id, amountCents: input.amount_cents, currency: balance.currency, via: 'api' });
      announcePayoutRequest(user, { amountCents: input.amount_cents, currency: balance.currency, method, details, note });
      return { payout: payoutOut(payoutsFor(user.id)[0]!) };
    },
  },
  {
    name: 'request_reward',
    title: 'Request a reward',
    description: 'Asks for free tickets to an upcoming event, or a merch item, that your sales earned. The admins are told.',
    method: 'POST',
    path: '/rewards',
    write: true,
    input: {
      properties: {
        kind: { type: 'string', enum: ['ticket', 'merch'], description: 'Free tickets or merch.' },
        event_id: { type: 'integer', minimum: 1, description: 'For tickets: which event.' },
        quantity: { type: 'integer', minimum: 1, maximum: 50, description: 'For tickets: how many (1 if left out).' },
        details: { type: 'string', maxLength: 120, description: 'For merch: which item and size. For tickets: an optional note.' },
      },
      required: ['kind'],
    },
    run: async ({ user, c }, input: { kind: 'ticket' | 'merch'; event_id?: number; quantity?: number; details?: string }) => {
      const data = await promoterData(user);
      const result = requestReward(user, data.rewards, {
        kind: input.kind,
        eventId: input.kind === 'ticket' ? input.event_id : undefined,
        quantity: input.kind === 'ticket' ? (input.quantity ?? 1) : 1,
        details: input.details ?? '',
      });
      if (result !== 'ok') throw new ApiError(400, result, rewardProblem[result]);
      const request = rewardRequestsFor(user.id)[0]!;
      audit(c, 'reward.requested', { userId: user.id, kind: input.kind, rewardId: request.id, via: 'api' });
      announceRewardRequest(user, request);
      return { reward: rewardOut(request) };
    },
  },
  {
    name: 'settle_payout',
    title: 'Pay or decline a payout',
    description: 'Admins: marks a waiting payout request as paid (after sending the money) or declines it. The promoter is emailed and notified.',
    method: 'POST',
    path: '/payouts/:payout_id/settle',
    who: 'admin',
    write: true,
    destructive: true,
    input: {
      properties: {
        payout_id: { type: 'integer', minimum: 1, description: 'The request, from list_payouts.' },
        action: { type: 'string', enum: ['paid', 'decline'], description: 'Paid, or declined (the amount becomes available again).' },
        note: { type: 'string', maxLength: 200, description: 'Paid: an optional reference. Declined: the reason, which the promoter sees (needed).' },
      },
      required: ['payout_id', 'action'],
    },
    run: ({ user, c }, input: { payout_id: number; action: 'paid' | 'decline'; note?: string }) => {
      const payout = findPayout(input.payout_id);
      if (!payout) throw new ApiError(404, 'not_found', 'No payout request with that id.');
      const note = (input.note ?? '').trim();
      if (input.action === 'decline' && !note) throw new ApiError(400, 'invalid_input', 'Give the reason in note: the promoter sees it.');
      if (!finishPayout(c, user, payout, input.action === 'paid' ? 'paid' : 'rejected', note, 'api')) {
        throw new ApiError(409, 'already_handled', 'That request was already handled.');
      }
      return { payout: payoutOut(findPayout(payout.id)!) };
    },
  },
  {
    name: 'settle_reward',
    title: 'Give or decline a reward',
    description: 'Admins: marks a waiting reward request as given or declines it. The promoter is emailed and notified.',
    method: 'POST',
    path: '/rewards/:reward_id/settle',
    who: 'admin',
    write: true,
    destructive: true,
    input: {
      properties: {
        reward_id: { type: 'integer', minimum: 1, description: 'The request, from list_reward_requests.' },
        action: { type: 'string', enum: ['given', 'decline'], description: 'Given, or declined (it can be requested again).' },
        note: { type: 'string', maxLength: 200, description: 'Given: an optional note. Declined: the reason, which the promoter sees (needed).' },
      },
      required: ['reward_id', 'action'],
    },
    run: ({ user, c }, input: { reward_id: number; action: 'given' | 'decline'; note?: string }) => {
      const reward = findRewardRequest(input.reward_id);
      if (!reward) throw new ApiError(404, 'not_found', 'No reward request with that id.');
      const note = (input.note ?? '').trim();
      if (input.action === 'decline' && !note) throw new ApiError(400, 'invalid_input', 'Give the reason in note: the promoter sees it.');
      if (!finishReward(c, user, reward, input.action === 'given' ? 'fulfilled' : 'rejected', note, 'api')) {
        throw new ApiError(409, 'already_handled', 'That request was already handled.');
      }
      return { reward: rewardOut(findRewardRequest(reward.id)!) };
    },
  },
  {
    name: 'create_promoter',
    title: 'Add a promoter',
    description: 'Admins: adds a promoter account with promo codes, and emails them an invite to sign in. Admin accounts can only be made in the app.',
    method: 'POST',
    path: '/promoters',
    who: 'admin',
    write: true,
    input: {
      properties: {
        name: { type: 'string', maxLength: 100, description: 'Their name.' },
        email: { type: 'string', maxLength: 254, description: 'Their email: they sign in with links sent there.' },
        codes: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50, description: 'Their Hi.Events promo codes.' },
        commission_percent: { type: 'integer', minimum: 0, maximum: 100, description: `Their usual commission as a percentage. Leave out (and the next one) for the default, ${config.commissionPercent}%.` },
        commission_cents_per_ticket: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'Or: a flat amount per ticket, in cents.' },
        send_invite: { type: 'boolean', default: true, description: 'Email them a sign-in link now.' },
      },
      required: ['name', 'email'],
    },
    run: async ({ user, c }, input: { name: string; email: string; codes?: string[]; commission_percent?: number; commission_cents_per_ticket?: number; send_invite: boolean }) => {
      const name = input.name.trim();
      const email = input.email.trim();
      if (!name) throw new ApiError(400, 'invalid_input', 'name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'invalid_input', 'That is not a valid email address.');
      if (input.commission_percent !== undefined && input.commission_cents_per_ticket !== undefined) {
        throw new ApiError(400, 'invalid_input', 'Give commission_percent or commission_cents_per_ticket, not both.');
      }
      if (findUserByEmail(email)) throw new ApiError(409, 'exists', 'Another account already uses that email.');
      const commission = { percent: input.commission_percent ?? null, flatCents: input.commission_cents_per_ticket ?? null };
      const id = await createUser({ name, email, isAdmin: false, commission });
      setCodes(id, normalizeCodes((input.codes ?? []).join(' ')));
      setAlias(id, suggestAlias(name, id));
      audit(c, 'admin.promoter_created', { by: user.id, userId: id, isAdmin: false, commission, via: 'api' });
      const promoter = findUser(id)!;
      const inviteSent = input.send_invite ? await emailLoginLink(promoter, 'invite', undefined, 1) : false;
      return { promoter: { id, name: promoter.name, email: promoter.email, alias: promoter.alias, codes: codesFor(id) }, invite_sent: inviteSent };
    },
  },
  {
    name: 'update_promoter_codes',
    title: "Change a promoter's codes",
    description: "Admins: adds promo codes to a promoter and/or takes some away. Their sales are counted from their codes, past sales included.",
    method: 'POST',
    path: '/promoters/:promoter_id/codes',
    who: 'admin',
    write: true,
    destructive: true,
    input: {
      properties: {
        promoter_id: { type: 'integer', minimum: 1, description: 'The promoter, from list_promoters.' },
        add: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50, description: 'Codes to give them.' },
        remove: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50, description: 'Codes to take away.' },
      },
      required: ['promoter_id'],
    },
    run: ({ user, c }, input: { promoter_id: number; add?: string[]; remove?: string[] }) => {
      const promoter = findUser(input.promoter_id);
      if (!promoter) throw new ApiError(404, 'not_found', 'No promoter with that id.');
      const add = normalizeCodes((input.add ?? []).join(' '));
      const remove = new Set(normalizeCodes((input.remove ?? []).join(' ')));
      const codes = [...new Set([...codesFor(promoter.id), ...add])].filter((code) => !remove.has(code));
      setCodes(promoter.id, codes);
      audit(c, 'admin.promoter_codes_changed', { by: user.id, userId: promoter.id, add, remove: [...remove], via: 'api' });
      return { promoter_id: promoter.id, codes: codesFor(promoter.id) };
    },
  },
  {
    name: 'set_event_commission',
    title: 'Set commission for an event',
    description:
      "Admins: gives a promoter another commission on one event that is not over (a percentage or a flat amount per ticket), or puts them back on their usual one. It applies to all their sales for the event, earlier ones too.",
    method: 'POST',
    path: '/commissions',
    who: 'admin',
    write: true,
    destructive: true,
    input: {
      properties: {
        promoter_id: { type: 'integer', minimum: 1, description: 'The promoter: they must have a code on the event.' },
        event_id: { type: 'integer', minimum: 1, description: 'The event, from list_events.' },
        kind: { type: 'string', enum: ['usual', 'percent', 'flat'], description: 'Back to their usual commission, a percentage, or a flat amount per ticket.' },
        percent: { type: 'integer', minimum: 0, maximum: 100, description: 'With kind percent.' },
        cents_per_ticket: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'With kind flat, in cents.' },
      },
      required: ['promoter_id', 'event_id', 'kind'],
    },
    run: async ({ user, c }, input: { promoter_id: number; event_id: number; kind: 'usual' | 'percent' | 'flat'; percent?: number; cents_per_ticket?: number }) => {
      const event = (await commissionEvents()).find((e) => e.id === input.event_id);
      if (!event || !event.promoters.some((p) => p.id === input.promoter_id)) {
        throw new ApiError(400, 'invalid_input', 'Pick a promoter with a code on an event that is not over (see list_events).');
      }
      let rule: EventRule | null = null;
      if (input.kind === 'percent') {
        if (input.percent === undefined) throw new ApiError(400, 'invalid_input', 'Give percent.');
        rule = { kind: 'percent', value: input.percent };
      } else if (input.kind === 'flat') {
        if (input.cents_per_ticket === undefined) throw new ApiError(400, 'invalid_input', 'Give cents_per_ticket.');
        rule = { kind: 'flat', value: input.cents_per_ticket };
      }
      setEventRule(input.promoter_id, input.event_id, rule);
      audit(c, 'admin.event_commission_changed', { by: user.id, userId: input.promoter_id, eventId: input.event_id, rule, via: 'api' });
      const rate = rateFor(findUser(input.promoter_id)!);
      return { promoter_id: input.promoter_id, event_id: input.event_id, commission: describeRule(rate.events.get(input.event_id) ?? rate.usual, event.currency) };
    },
  },
];

/** May this person, with this key or connection, use the operation? */
export function canUse(op: Op, user: User, token: ApiToken): boolean {
  if (op.write && !token.can_write) return false;
  if (op.who === 'admin') return !!user.is_admin;
  if (op.who === 'lead') return !!user.is_admin || isTeamLead(user);
  if (op.who === 'team') return !!user.is_admin || isTeamLead(user) || !!teamLeadOf(user);
  return true;
}

/** Runs an operation for a caller, after checking they may and that the input is right. */
export async function runOp(op: Op, call: Call, raw: Record<string, unknown>, fromQuery = false): Promise<unknown> {
  if (op.write && !call.token.can_write) throw new ApiError(403, 'read_only', 'This key or connection can only read. Make one that can also make changes.');
  if (!canUse(op, call.user, call.token)) throw new ApiError(403, 'not_allowed', 'Your account cannot use this.');
  return op.run(call, parseInput(op.input, raw, fromQuery));
}
