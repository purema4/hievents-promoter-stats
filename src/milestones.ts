import { hasAdjustments } from './adjustments';
import { codesFor, commissionPercentFor, db, listUsers, type User } from './local-db';
import { statsForCodes } from './hievents';
import { notify } from './notifications';
import { alertAdmins } from './alert-prefs';
import { config } from './config';
import { summarizeEvents } from './promoter-views';
import { levelFor, rewardsFor, type Rewards } from './rewards';
import { labelOf, rewardRules } from './reward-rules';

/*
 * Milestones come from live Hi.Events sales, so they are found by comparing each promoter's current
 * numbers with the last ones seen. The first look at a promoter only records where they stand, so
 * turning this on does not send a burst of notifications about the past.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS milestone_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

function state(userId: number): Map<string, number> {
  const rows = db.query<{ key: string; value: number }, [number]>('SELECT key, value FROM milestone_state WHERE user_id = ?').all(userId);
  return new Map(rows.map((r) => [r.key, r.value]));
}

function setState(userId: number, key: string, value: number) {
  db.query('INSERT INTO milestone_state (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value').run(
    userId,
    key,
    value,
  );
}

export function checkMilestones(promoter: User, rewards: Rewards) {
  const seen = state(promoter.id);
  const firstLook = seen.size === 0;
  const { level, next } = levelFor(rewards.totalSold);

  const previousSold = seen.get('sold');
  if (!firstLook && previousSold !== undefined && levelFor(previousSold).level.name !== level.name && rewards.totalSold > previousSold) {
    notify(promoter.id, {
      title: `You reached ${level.name}`,
      body: `${rewards.totalSold} tickets sold in total.${next ? ` Next: ${next.name} at ${next.at}.` : ' That is the top level.'}`,
      link: '/',
    });
    alertAdmins(
      'promoter_level',
      { title: `${promoter.name} reached ${level.name}`, body: `${rewards.totalSold} tickets sold with their codes.`, link: `/admin/promoters/${promoter.id}` },
      {
        promoter: promoter.name,
        milestone: `reached ${level.name}`,
        details: `${rewards.totalSold} tickets sold with their codes.`,
        link: `${config.appUrl}/admin/promoters/${promoter.id}`,
      },
    );
  }
  setState(promoter.id, 'sold', rewards.totalSold);

  const previousMerch = seen.get('merch');
  if (!firstLook && previousMerch !== undefined && rewards.merch.earned > previousMerch) {
    const item = labelOf(rewardRules().merch, rewards.merch.earned);
    notify(promoter.id, {
      title: item ? `${item} unlocked` : 'Merch unlocked',
      body: `You sold ${rewards.totalSold} tickets: ${item ? 'request it' : 'pick your merch'} on Payouts & rewards.`,
      link: '/payouts#rewards',
    });
    alertAdmins(
      'promoter_merch',
      {
        title: `${promoter.name} unlocked ${item || 'merch'}`,
        body: `${rewards.totalSold} tickets sold. They can now request a merch item.`,
        link: `/admin/promoters/${promoter.id}`,
      },
      {
        promoter: promoter.name,
        milestone: `unlocked ${item || 'merch'}`,
        details: `${rewards.totalSold} tickets sold. They can now request a merch item.`,
        link: `${config.appUrl}/admin/promoters/${promoter.id}`,
      },
    );
  }
  setState(promoter.id, 'merch', rewards.merch.earned);

  for (const t of rewards.tickets) {
    const key = `free:${t.event.id}`;
    const previous = seen.get(key);
    // A new event counts as "0 before", so the first free ticket for it is announced too.
    if (!firstLook && t.earned > (previous ?? 0)) {
      notify(promoter.id, {
        title: `Free ticket earned for ${t.event.title}`,
        body:
          t.earned === 1
            ? 'Your sales for this event earned you a free ticket. Request it on Payouts & rewards.'
            : `${t.earned} free tickets earned for this event so far. Request them on Payouts & rewards.`,
        link: '/payouts#rewards',
      });
    }
    setState(promoter.id, key, t.earned);
  }
}

/** Runs for every promoter; called on a timer, so sales show up as notifications without anyone visiting. */
export async function checkAllMilestones() {
  for (const promoter of listUsers()) {
    const codes = codesFor(promoter.id);
    if (codes.length === 0 && !hasAdjustments(promoter.id)) continue;
    try {
      const percent = commissionPercentFor(promoter);
      const rows = await statsForCodes(codes);
      checkMilestones(promoter, rewardsFor(promoter.id, summarizeEvents(rows, percent)));
    } catch (err) {
      console.error(`Milestone check for user ${promoter.id} failed:`, err);
    }
  }
}
