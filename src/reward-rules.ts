import { config } from './config';
import { db } from './local-db';

/*
 * Levels and reward milestones, set by admins on /admin/rewards and kept as JSON in settings. Until
 * an admin saves them, the defaults below apply (free tickets and merch from REWARD_TICKET_EVERY and
 * MERCH_EVERY). Rewards are always counted from the current rules, so a change applies to everyone
 * at once; rewards already requested stay requested.
 */

// Badge colors come from a fixed set of CSS classes: the pages allow no inline styles.
export const levelColors = ['gray', 'bronze', 'silver', 'gold', 'teal', 'blue', 'purple', 'pink', 'red', 'green'] as const;
export type LevelColor = (typeof levelColors)[number];

export type Level = { name: string; at: number; color: LevelColor };

/** A reward reached at a number of tickets sold, `count` at a time, optionally named (like "Hoodie"). */
export type Milestone = { at: number; count: number; label: string };

/** Milestones, then `count` more every `every` tickets after the last one (0: no more). */
export type Track = { milestones: Milestone[]; every: number; count: number; label: string };

/** Free tickets count the sales for one event; merch counts all tickets sold. */
export type RewardRules = { levels: Level[]; tickets: Track; merch: Track };

export const LIMITS = { levels: 20, milestones: 30, tickets: 1_000_000, count: 50, name: 30, label: 60 };

export function defaultRules(): RewardRules {
  return {
    // Gold lines up with the first merch unlock at the default MERCH_EVERY of 50.
    levels: [
      { name: 'Rookie', at: 0, color: 'gray' },
      { name: 'Bronze', at: 10, color: 'bronze' },
      { name: 'Silver', at: 25, color: 'silver' },
      { name: 'Gold', at: 50, color: 'gold' },
      { name: 'Platinum', at: 100, color: 'teal' },
      { name: 'Diamond', at: 250, color: 'blue' },
    ],
    // 1 free ticket from the first sale, then 1 more every REWARD_TICKET_EVERY sales (1 → 1, 6 → 2, 11 → 3).
    tickets: { milestones: [{ at: 1, count: 1, label: '' }], every: config.rewardTicketEvery, count: 1, label: '' },
    merch: { milestones: [], every: config.merchEvery, count: 1, label: '' },
  };
}

const KEY = 'rewards:rules';
let cached: RewardRules | null = null;

export function rewardRules(): RewardRules {
  if (cached) return cached;
  const raw = db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(KEY)?.value;
  let rules: RewardRules | null = null;
  if (raw) {
    try {
      rules = checkRules(JSON.parse(raw));
    } catch {
      rules = null;
    }
    if (!rules) console.error('The saved levels and rewards are not valid; using the defaults.');
  }
  cached = rules ?? defaultRules();
  return cached;
}

export function saveRewardRules(rules: RewardRules | null) {
  if (rules) {
    db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(rules));
  } else {
    db.query('DELETE FROM settings WHERE key = ?').run(KEY);
  }
  cached = null;
}

export const isCustomized = () => !!db.query('SELECT 1 FROM settings WHERE key = ?').get(KEY);

// --- Checking ----------------------------------------------------------------------------------

const whole = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value);

/** The rules if they are complete and sensible, else null. Used for saved JSON and for the admin form. */
export function checkRules(value: unknown): RewardRules | null {
  return describeProblem(value) ? null : (value as RewardRules);
}

/** What is wrong with the rules, in words for the admin, or null when they are fine. */
export function describeProblem(value: unknown): string | null {
  const v = value as Partial<RewardRules> | null;
  if (!v || !Array.isArray(v.levels) || !v.tickets || !v.merch) return 'The rules are incomplete.';
  const levels = v.levels;
  if (levels.length === 0) return 'Keep at least one level.';
  if (levels.length > LIMITS.levels) return `Use ${LIMITS.levels} levels at most.`;
  for (const l of levels) {
    if (!text(l?.name, LIMITS.name) || !l.name.trim()) return `Each level needs a name of ${LIMITS.name} characters at most.`;
    if (!whole(l.at, 0, LIMITS.tickets)) return `The tickets for ${l.name} must be a whole number from 0.`;
    if (!levelColors.includes(l.color)) return `Pick a color for ${l.name}.`;
  }
  if (levels[0]!.at !== 0) return 'The first level must start at 0 tickets, so every promoter has one.';
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]!.at <= levels[i - 1]!.at) return 'Each level needs more tickets than the one before it.';
  }
  if (new Set(levels.map((l) => l.name.trim().toLowerCase())).size !== levels.length) return 'Two levels have the same name.';
  for (const [name, track] of [['free tickets', v.tickets], ['merch', v.merch]] as const) {
    if (!Array.isArray(track.milestones) || track.milestones.length > LIMITS.milestones) return `Use ${LIMITS.milestones} milestones at most for ${name}.`;
    for (const m of track.milestones) {
      if (!whole(m?.at, 1, LIMITS.tickets)) return `Milestones for ${name} need a number of tickets from 1.`;
      if (!whole(m.count, 1, LIMITS.count)) return `Each milestone for ${name} gives 1 to ${LIMITS.count}.`;
      if (!text(m.label, LIMITS.label)) return `Names for ${name} can have ${LIMITS.label} characters at most.`;
    }
    for (let i = 1; i < track.milestones.length; i++) {
      if (track.milestones[i]!.at <= track.milestones[i - 1]!.at) return `Two milestones for ${name} are at the same number of tickets.`;
    }
    if (!whole(track.every, 0, LIMITS.tickets)) return `"Then every" for ${name} must be a whole number (0 for none).`;
    if (!whole(track.count, 1, LIMITS.count)) return `"Then every" for ${name} gives 1 to ${LIMITS.count}.`;
    if (!text(track.label, LIMITS.label)) return `Names for ${name} can have ${LIMITS.label} characters at most.`;
  }
  return null;
}

// --- Counting ----------------------------------------------------------------------------------

export const trackOn = (t: Track) => t.milestones.length > 0 || t.every > 0;

/** Where the repeating part starts: after the last milestone. */
const repeatFrom = (t: Track) => t.milestones.at(-1)?.at ?? 0;

/** How many rewards `sold` tickets have earned. */
export function earnedOn(t: Track, sold: number): number {
  if (sold <= 0) return 0;
  let n = 0;
  for (const m of t.milestones) if (sold >= m.at) n += m.count;
  if (t.every > 0 && sold > repeatFrom(t)) n += Math.floor((sold - repeatFrom(t)) / t.every) * t.count;
  return n;
}

export type Next = { at: number; in: number; count: number; label: string; progress: number };

/** The next milestone after `sold` tickets, with how far along the way from the previous one; null when there is none. */
export function nextOn(t: Track, sold: number): Next | null {
  const s = Math.max(0, sold);
  const passed = [0, ...t.milestones.map((m) => m.at)].filter((at) => at <= s);
  let previous = Math.max(...passed);
  let next: { at: number; count: number; label: string } | undefined = t.milestones.find((m) => m.at > s);
  if (!next && t.every > 0) {
    const base = repeatFrom(t);
    const done = Math.floor((s - base) / t.every);
    previous = Math.max(previous, base + done * t.every);
    next = { at: base + (done + 1) * t.every, count: t.count, label: t.label };
  }
  if (!next) return null;
  const span = next.at - previous;
  return { at: next.at, in: next.at - s, count: next.count, label: next.label, progress: span > 0 ? Math.floor(((s - previous) / span) * 100) : 0 };
}

/** The name of the n-th reward earned on a track (1-based), or '' when it has none. */
export function labelOf(t: Track, n: number): string {
  let seen = 0;
  for (const m of t.milestones) {
    seen += m.count;
    if (n <= seen) return m.label;
  }
  return t.every > 0 ? t.label : '';
}

export function levelFor(totalSold: number): { level: Level; next: Level | null; progress: number } {
  const levels = rewardRules().levels;
  const index = Math.max(0, levels.findLastIndex((l) => totalSold >= l.at));
  const level = levels[index]!;
  const next = levels[index + 1] ?? null;
  const progress = next ? Math.floor(((totalSold - level.at) / (next.at - level.at)) * 100) : 100;
  return { level, next, progress };
}

// --- In words ----------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function reward(count: number, label: string, unit: 'ticket' | 'merch'): string {
  if (label) return count === 1 ? label : `${count} × ${label}`;
  return unit === 'ticket' ? plural(count, 'free ticket') : plural(count, 'merch item');
}

/** The rule for a track in one sentence, like "1 free ticket at 1 sale, then 1 free ticket every 5 more sales." */
export function describeTrack(t: Track, unit: 'ticket' | 'merch'): string {
  if (!trackOn(t)) return unit === 'ticket' ? 'No free tickets for now.' : 'No merch for now.';
  const sale = unit === 'ticket' ? 'sale' : 'ticket sold';
  const sales = unit === 'ticket' ? 'sales' : 'tickets sold';
  const parts = t.milestones.map((m) => `${reward(m.count, m.label, unit)} at ${m.at} ${m.at === 1 ? sale : sales}`);
  if (t.every > 0) {
    const more = unit === 'ticket' ? 'more sales' : 'more tickets sold';
    parts.push(`${parts.length ? 'then ' : ''}${reward(t.count, t.label, unit)} every ${t.every === 1 ? (unit === 'ticket' ? 'sale' : 'ticket sold') : `${t.every} ${parts.length ? more : sales}`}`);
  }
  const sentence = parts.join(', ');
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
}
