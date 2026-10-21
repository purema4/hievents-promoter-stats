import type { Context } from 'hono';
import { alertAdmins } from './alert-prefs';
import { audit } from './audit';
import { createLoginToken } from './auth';
import { rateFor } from './commission';
import { config } from './config';
import { currentEventCodes, statsForCodes } from './hievents';
import { codesFor, listUsers, type User } from './local-db';
import { sendEmail } from './mail';
import { allMediaDrives } from './media-drives';
import { formatMoney, totalsByCurrency } from './money';
import { notify } from './notifications';
import { balances, settlePayout, type PayoutRequest } from './payouts';
import { summarizeEvents } from './promoter-views';
import { describeReward, rewardsFor, settleReward, type RewardRequest } from './rewards';
import { hadTeam, teamCommission } from './teams';

/*
 * What the pages and the API (api.ts) both do: the data behind a promoter's pages, and the actions
 * that also tell people about them (emails, notifications, alerts to admins).
 */

export async function emailLoginLink(
  user: User,
  kind: 'invite' | 'login',
  waiting?: { id: string; from: string },
  attempts = 3,
): Promise<boolean> {
  const seconds = kind === 'invite' ? config.inviteLinkDays * 86400 : config.loginLinkMinutes * 60;
  const { token, code } = createLoginToken(user.id, seconds, waiting);
  const link = `${config.appUrl}/login/verify?token=${token}`;
  const expiry = kind === 'invite' ? `${config.inviteLinkDays} days` : `${config.loginLinkMinutes} minutes`;
  return sendEmail(kind, [user], { link, code, expiry }, undefined, { attempts });
}

// Everything a promoter's pages need; admins load the same data to see exactly what a promoter sees.
export async function promoterData(promoter: User) {
  const codes = codesFor(promoter.id);
  const percent = rateFor(promoter);
  const [rows, team] = await Promise.all([statsForCodes(codes), hadTeam(promoter.id) ? teamCommission(promoter) : []]);
  return {
    codes,
    percent,
    rows,
    team,
    balances: balances(promoter.id, totalsByCurrency(rows, percent), team),
    rewards: rewardsFor(promoter.id, summarizeEvents(rows, percent)),
    media: allMediaDrives(),
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
  alertAdmins(
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
  );
}

/** Tells the admins about a new reward request. */
export function announceRewardRequest(user: User, request: RewardRequest) {
  alertAdmins(
    'reward_requested',
    { title: `${user.name} requested a reward`, body: describeReward(request), link: '/admin/payouts' },
    {
      promoter: `${user.name} (${user.email})`,
      reward: describeReward(request),
      details: request.details ?? 'None',
      link: `${config.appUrl}/admin/payouts`,
    },
  );
}

/**
 * Marks a payout request paid or declined, and tells the promoter (notification and email). False when
 * it was already handled. A decline needs a note: the promoter is told why.
 */
export function finishPayout(c: Context, admin: User, payout: PayoutRequest, status: 'paid' | 'rejected', adminNote: string, via?: string): boolean {
  if (!settlePayout(payout.id, admin.id, status, adminNote)) return false;
  audit(c, `payout.${status}`, { by: admin.id, payoutId: payout.id, userId: payout.user_id, ...(via ? { via } : {}) });
  const amount = formatMoney(payout.amount_cents, payout.currency);
  if (payout.user_id) {
    notify(payout.user_id, {
      title: status === 'paid' ? `Payout sent: ${amount}` : `Payout request declined: ${amount}`,
      body:
        status === 'paid'
          ? `By ${payout.method}${payout.details ? ` to ${payout.details}` : ''}.${adminNote.trim() ? ` Reference: ${adminNote.trim()}` : ''}`
          : `${adminNote.trim()} The amount is available to request again.`,
      link: '/payouts',
    });
  }
  const to = [{ name: payout.promoter_name, email: payout.promoter_email }];
  setTimeout(
    () =>
      void sendEmail(status === 'paid' ? 'payout_paid' : 'payout_declined', to, {
        amount,
        method: payout.method,
        details: payout.details ? `to ${payout.details}` : '',
        note: status === 'paid' ? (adminNote.trim() ? `Reference: ${adminNote.trim()}` : '') : adminNote.trim(),
        link: `${config.appUrl}/payouts`,
      }),
    0,
  );
  return true;
}

/** Marks a reward request given or declined, and tells the promoter. False when it was already handled. */
export function finishReward(c: Context, admin: User, reward: RewardRequest, status: 'fulfilled' | 'rejected', adminNote: string, via?: string): boolean {
  if (!settleReward(reward.id, admin.id, status, adminNote)) return false;
  audit(c, `reward.${status}`, { by: admin.id, rewardId: reward.id, userId: reward.user_id, ...(via ? { via } : {}) });
  const what = describeReward(reward);
  if (reward.user_id) {
    notify(reward.user_id, {
      title: status === 'fulfilled' ? 'Reward on its way' : 'Reward request declined',
      body: `${what}${adminNote.trim() ? `: ${adminNote.trim()}` : ''}`,
      link: '/payouts#rewards',
    });
  }
  setTimeout(
    () =>
      void sendEmail(status === 'fulfilled' ? 'reward_given' : 'reward_declined', [{ name: reward.promoter_name, email: reward.promoter_email }], {
        reward: what,
        note: adminNote.trim(),
        link: `${config.appUrl}/payouts#rewards`,
      }),
    0,
  );
  return true;
}
