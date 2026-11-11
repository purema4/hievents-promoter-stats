import { earningsFor } from './earnings';
import type { Context } from 'hono';
import { alertAdmins } from './alert-prefs';
import { audit } from './audit';
import { createLoginToken } from './auth';
import { config } from './config';
import { currentEventCodes, publishedUpcomingEvents, statsForCodes } from './hievents';
import { codesFor, listUsers, type User } from './local-db';
import { sendEmail } from './mail';
import { allEventBanners } from './banners';
import { allMediaDrives } from './media-drives';
import { formatMoney, totalsByCurrency } from './money';
import { notify } from './notifications';
import { plural, t, withLang, type Lang } from './i18n';
import { balances, settlePayout, type PayoutRequest, withTeamRule } from './payouts';
import { summarizeEvents } from './promoter-views';
import { describeReward, isDeposit, rewardsFor, settleReward, type RewardRequest } from './rewards';
import { hadTeam, teamCommission, type TeamCommission } from './teams';
import { rangeBounds, type Range } from './chart';

/*
 * What the pages and the API (api.ts) both do: the data behind a promoter's pages, and the actions
 * that also tell people about them (emails, notifications, alerts to admins).
 */

export async function emailLoginLink(
  user: User,
  kind: 'invite' | 'login',
  waiting?: { id: string; from: string },
  attempts = 3,
  // The language of the browser that asked, when the person asked themselves (sign-in form, invite
  // link); otherwise the one saved on their account, or English for someone who never visited.
  language?: Lang,
): Promise<boolean> {
  const seconds = kind === 'invite' ? config.inviteLinkDays * 86400 : config.loginLinkMinutes * 60;
  const { token, code } = createLoginToken(user.id, seconds, waiting);
  const link = `${config.appUrl}/login/verify?token=${token}`;
  // Worded in the person's language: theirs when saved, or the browser's asking for a sign-in link.
  const expiry = () =>
    kind === 'invite'
      ? plural(config.inviteLinkDays, ['day', 'jour'], ['days', 'jours'])
      : plural(config.loginLinkMinutes, ['minute', 'minute'], ['minutes', 'minutes']);
  return sendEmail(kind, [language ? { ...user, lang: language } : user], () => ({ link, code, expiry: expiry() }), undefined, { attempts });
}

/**
 * A team lead's team commission for a period, as on My team: the share of the Teams page on their
 * promoters' sales, plus what their team rule gives on the events that start in the period.
 */
export async function teamTotals(lead: User, range: Range = 'all'): Promise<TeamCommission[]> {
  const [share, rate] = await Promise.all([teamCommission(lead, range), statsForCodes(codesFor(lead.id)).then((rows) => earningsFor(lead, rows))]);
  const from = range === 'all' ? '' : rangeBounds(range, []).from;
  const out = new Map(share.map((t) => [t.currency, { ...t, rule: 0 }]));
  for (const e of rate.teamByEvent?.values() ?? []) {
    if (from && (!e.start || e.start.toISOString().slice(0, 10) < from)) continue;
    const t = out.get(e.currency) ?? { currency: e.currency, sales: 0, commission: 0, rule: 0 };
    t.commission += e.cents;
    t.rule += e.cents;
    out.set(e.currency, t);
  }
  return [...out.values()];
}

// Everything a promoter's pages need; admins load the same data to see exactly what a promoter sees.
export async function promoterData(promoter: User) {
  const codes = codesFor(promoter.id);
  const [rows, team, ticketEvents] = await Promise.all([
    statsForCodes(codes),
    hadTeam(promoter.id) ? teamCommission(promoter) : [],
    publishedUpcomingEvents(),
  ]);
  // What the rules give on each event; `percent` keeps its old name across the pages.
  const percent = await earningsFor(promoter, rows, { next: true });
  return {
    codes,
    percent,
    /** The rules engine was down: the numbers are the last ones known. */
    stale: percent.stale,
    rows,
    team,
    balances: balances(promoter.id, totalsByCurrency(rows, percent), withTeamRule(team, percent.team)),
    rewards: rewardsFor(promoter.id, summarizeEvents(rows, percent), percent),
    ticketEvents,
    media: allMediaDrives(),
    banners: allEventBanners(),
  };
}

/** Events that are not over (drafts included), each with the promoters who have one of its codes. */
export async function commissionEvents() {
  const codes = await currentEventCodes();
  const promoters = listUsers().filter((u) => u.codes.length > 0);
  const events = new Map<number, { id: number; title: string; start: Date | null; timezone: string | null; currency: string; promoters: User[] }>();
  for (const row of codes) {
    const event = events.get(row.event_id) ?? { id: row.event_id, title: row.title, start: row.start, timezone: row.timezone, currency: row.currency, promoters: [] };
    for (const p of promoters) if (p.codes.includes(row.code) && !event.promoters.includes(p)) event.promoters.push(p);
    events.set(row.event_id, event);
  }
  return [...events.values()].filter((e) => e.promoters.length > 0);
}

/** Tells the admins about a new payout request. */
export function announcePayoutRequest(user: User, input: { amountCents: number; currency: string; method: string; details: string; note: string }) {
  // Admins' alerts are in English, whatever the promoter's language.
  withLang('en', () => alertAdmins(
    'payout_requested',
    {
      title: `${user.name} requested ${formatMoney(input.amountCents, input.currency)}`,
      body: `Payout by ${input.method}. Review it on Requests.`,
      link: '/admin/payouts',
    },
    {
      promoter: `${user.name} (${user.email})`,
      amount: formatMoney(input.amountCents, input.currency),
      method: input.method,
      details: input.details || 'Not needed',
      note: input.note,
      link: `${config.appUrl}/admin/payouts`,
    },
  ));
}

/** Tells the admins about a new reward request. */
export function announceRewardRequest(user: User, request: RewardRequest) {
  withLang('en', () => alertAdmins(
    'reward_requested',
    { title: `${user.name} requested a reward`, body: describeReward(request), link: '/admin/payouts' },
    {
      promoter: `${user.name} (${user.email})`,
      reward: describeReward(request),
      details: request.details ?? 'None',
      link: `${config.appUrl}/admin/payouts`,
    },
  ));
}

/** Tells the admins about a cart from the rewards shop, in one alert. */
export function announceRewardOrder(user: User, requests: RewardRequest[]) {
  if (requests.length === 1) return announceRewardRequest(user, requests[0]!);
  withLang('en', () => {
    const list = requests.map(describeReward).join('; ');
    alertAdmins(
      'reward_requested',
      { title: `${user.name} requested ${requests.length} rewards`, body: list, link: '/admin/payouts' },
      {
        promoter: `${user.name} (${user.email})`,
        reward: list,
        details: requests.map((r) => r.details).filter(Boolean).join(' / ') || 'None',
        link: `${config.appUrl}/admin/payouts`,
      },
    );
  });
}

/**
 * Marks a payout request paid or declined, and tells the promoter (notification and email). False when
 * it was already handled. A decline needs a note: the promoter is told why.
 */
export function finishPayout(c: Context, admin: User, payout: PayoutRequest, status: 'paid' | 'rejected', adminNote: string, via?: string): boolean {
  if (!settlePayout(payout.id, admin.id, status, adminNote)) return false;
  audit(c, `payout.${status}`, { by: admin.id, payoutId: payout.id, userId: payout.user_id, ...(via ? { via } : {}) });
  // Worded for the promoter, in their language (amounts too).
  const amount = () => formatMoney(payout.amount_cents, payout.currency);
  const note = adminNote.trim();
  if (payout.user_id) {
    notify(payout.user_id, () => ({
      title: status === 'paid' ? t(`Payout sent: ${amount()}`, `Paiement envoyé : ${amount()}`) : t(`Payout request declined: ${amount()}`, `Demande de paiement refusée : ${amount()}`),
      body:
        status === 'paid'
          ? t(
              `By ${payout.method}${payout.details ? ` to ${payout.details}` : ''}.${note ? ` Reference: ${note}` : ''}`,
              `Par ${payout.method}${payout.details ? ` à ${payout.details}` : ''}.${note ? ` Référence : ${note}` : ''}`,
            )
          : t(`${note} The amount is available to request again.`, `${note} Tu peux redemander ce montant.`),
      link: '/payouts',
    }));
  }
  const to = [{ name: payout.promoter_name, email: payout.promoter_email }];
  setTimeout(
    () =>
      void sendEmail(status === 'paid' ? 'payout_paid' : 'payout_declined', to, () => ({
        amount: amount(),
        method: payout.method,
        details: payout.details ? t(`to ${payout.details}`, `à ${payout.details}`) : '',
        note: status === 'paid' ? (note ? t(`Reference: ${note}`, `Référence : ${note}`) : '') : note,
        link: `${config.appUrl}/payouts`,
      })),
    0,
  );
  return true;
}

/** Marks a reward request given or declined, and tells the promoter. False when it was already handled. */
export function finishReward(c: Context, admin: User, reward: RewardRequest, status: 'fulfilled' | 'rejected', adminNote: string, via?: string): boolean {
  if (!settleReward(reward.id, admin.id, status, adminNote)) return false;
  audit(c, `reward.${status}`, { by: admin.id, rewardId: reward.id, userId: reward.user_id, ...(via ? { via } : {}) });
  // Worded for the promoter, in their language.
  const note = adminNote.trim();
  if (reward.user_id) {
    notify(reward.user_id, () => ({
      title: isDeposit(reward)
        ? status === 'fulfilled'
          ? t('Rewards in your bank', 'Récompenses mises en banque')
          : t('Not put in your bank', 'Pas mises en banque')
        : status === 'fulfilled'
          ? t('Reward on its way', 'Ta récompense s’en vient')
          : t('Reward request declined', 'Demande de récompense refusée'),
      body: `${describeReward(reward)}${note ? t(`: ${note}`, ` : ${note}`) : ''}`,
      link: '/payouts#rewards',
    }));
  }
  setTimeout(
    () =>
      void sendEmail(status === 'fulfilled' ? 'reward_given' : 'reward_declined', [{ name: reward.promoter_name, email: reward.promoter_email }], () => ({
        reward: describeReward(reward),
        note,
        link: `${config.appUrl}/payouts#rewards`,
      })),
    0,
  );
  return true;
}
