import { config } from './config';
import { addColumn, db, listUsers } from './local-db';
import type { EventRule } from './money';
import { rewardRules, trackOn, type Track } from './reward-rules';
import { parseRule, type RuleLine } from './rules-engine';
import { FIXED_OUTPUTS } from './rule-variables';

/*
 * Where promoter rules live. A rule is text (`name = expression` lines, see rules-engine.ts), saved as a
 * new version each time: nothing is ever overwritten, so a past payout can always be explained.
 *
 * Rules apply from the most specific to the least, line by line:
 *   1. a promoter on one event   2. the event   3. the promoter   4. the default rule
 * A more specific rule only replaces the lines it gives: a promoter's commission on one event leaves
 * the event's free tickets alone. Write `bonus = 0` to cancel a line from a broader rule.
 *
 * Templates are named rules admins copy into an event's rule. Reward types (VIP, GA list…) are the
 * names, beyond commission, bonus and merch, that a rule can give.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS rule_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL CHECK (scope IN ('default', 'promoter', 'event', 'promoter_event', 'template')),
    user_id     INTEGER, -- promoter and promoter_event (kept when the promoter is deleted: history)
    event_id    INTEGER, -- event and promoter_event (a Hi.Events event id)
    template_id INTEGER, -- template
    text        TEXT NOT NULL, -- '' when the rule was removed
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS rule_versions_lookup ON rule_versions (scope, user_id, event_id, template_id, id);
  CREATE TABLE IF NOT EXISTS rule_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    removed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reward_types (
    key        TEXT PRIMARY KEY, -- the name a rule gives, like vip_tickets
    label_en   TEXT NOT NULL,
    label_fr   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type RuleScope = 'default' | 'promoter' | 'event' | 'promoter_event' | 'template';
export type RuleTarget = { userId?: number | null; eventId?: number | null; templateId?: number | null };
export type RuleVersion = { id: number; scope: RuleScope; user_id: number | null; event_id: number | null; template_id: number | null; text: string; created_by: number | null; created_at: string };

// --- Versions ---------------------------------------------------------------------------------------

/** The current version of one rule, or null when there never was one or it was removed. */
export function currentRule(scope: RuleScope, target: RuleTarget = {}): RuleVersion | null {
  const row = db
    .query<RuleVersion, [string, number | null, number | null, number | null]>(
      'SELECT * FROM rule_versions WHERE scope = ? AND user_id IS ? AND event_id IS ? AND template_id IS ? ORDER BY id DESC LIMIT 1',
    )
    .get(scope, target.userId ?? null, target.eventId ?? null, target.templateId ?? null);
  return row && row.text.trim() !== '' ? row : null;
}

export function findRuleVersion(id: number): RuleVersion | null {
  return db.query<RuleVersion, [number]>('SELECT * FROM rule_versions WHERE id = ?').get(id);
}

/** Every version of one rule, newest first. */
export function ruleHistory(scope: RuleScope, target: RuleTarget = {}): RuleVersion[] {
  return db
    .query<RuleVersion, [string, number | null, number | null, number | null]>(
      'SELECT * FROM rule_versions WHERE scope = ? AND user_id IS ? AND event_id IS ? AND template_id IS ? ORDER BY id DESC',
    )
    .all(scope, target.userId ?? null, target.eventId ?? null, target.templateId ?? null);
}

/**
 * Saves a new version ('' removes the rule) and returns its id; saving the same text again keeps the
 * current version. The text must already be checked (checkRule): this only stores it.
 */
export function saveRuleVersion(scope: RuleScope, target: RuleTarget, text: string, by: number | null): number {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const latest = db
    .query<{ id: number; text: string }, [string, number | null, number | null, number | null]>(
      'SELECT id, text FROM rule_versions WHERE scope = ? AND user_id IS ? AND event_id IS ? AND template_id IS ? ORDER BY id DESC LIMIT 1',
    )
    .get(scope, target.userId ?? null, target.eventId ?? null, target.templateId ?? null);
  if (latest && latest.text === normalized) return latest.id;
  if (!latest && normalized === '') return 0;
  return Number(
    db
      .query('INSERT INTO rule_versions (scope, user_id, event_id, template_id, text, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scope, target.userId ?? null, target.eventId ?? null, target.templateId ?? null, normalized, by).lastInsertRowid,
  );
}

/** Ends a deleted promoter's rules, so a later account can never pick them up. */
export function endRulesOf(userId: number, by: number | null) {
  const rows = db
    .query<{ scope: RuleScope; event_id: number | null }, [number]>(
      "SELECT DISTINCT scope, event_id FROM rule_versions WHERE user_id = ? AND scope IN ('promoter', 'promoter_event')",
    )
    .all(userId);
  for (const r of rows) saveRuleVersion(r.scope, { userId, eventId: r.event_id }, '', by);
}

/**
 * Sets one line of a rule (`line` is the whole "name = expression"), or removes it with null, keeping
 * the rule's other lines. Used by the forms that still set a rate: the usual rate, Commissions, and the
 * free-ticket track of Levels & rewards.
 */
export function setRuleLine(scope: RuleScope, target: RuleTarget, name: string, line: string | null, by: number | null): number {
  const text = currentRule(scope, target)?.text ?? '';
  const kept = text.split('\n').filter((l) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(l);
    return !m || m[1] !== name;
  });
  const next = [...kept, ...(line ? [line] : [])].join('\n').trim();
  // Only comments left: the rule is removed.
  const meaningful = next.split('\n').some((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  return saveRuleVersion(scope, target, meaningful ? next : '', by);
}

/** A promoter's usual rate, as their rule's commission line (none: the default rule's applies). */
export function setUsualRule(userId: number, commission: { percent: number | null; flatCents: number | null }, by: number | null) {
  const rule: EventRule | null =
    commission.flatCents != null ? { kind: 'flat', value: commission.flatCents } : commission.percent != null ? { kind: 'percent', value: commission.percent } : null;
  return setRuleLine('promoter', { userId }, 'commission', rule ? commissionLine(rule) : null, by);
}

// --- What applies ------------------------------------------------------------------------------------

export type AppliedRule = {
  lines: RuleLine[];
  /** The versions used, broadest first: kept with payouts and rewards to explain them later. */
  versionIds: number[];
  /** Identifies this exact set of versions, for caching results. */
  key: string;
  /** Where each line comes from. */
  from: Map<string, RuleScope>;
};

/** The rule that applies to a promoter on an event: every level, more specific lines replacing broader ones. */
export function ruleFor(userId: number, eventId: number): AppliedRule {
  const levels: [RuleScope, RuleVersion | null][] = [
    ['default', currentRule('default')],
    ['promoter', currentRule('promoter', { userId })],
    ['event', currentRule('event', { eventId })],
    ['promoter_event', currentRule('promoter_event', { userId, eventId })],
  ];
  const byName = new Map<string, RuleLine>();
  const from = new Map<string, RuleScope>();
  const versionIds: number[] = [];
  for (const [scope, version] of levels) {
    if (!version) continue;
    versionIds.push(version.id);
    for (const line of parseRule(version.text).lines) {
      byName.set(line.name, line);
      from.set(line.name, scope);
    }
  }
  return { lines: [...byName.values()], versionIds, key: versionIds.join('.') || 'none', from };
}

/** The rule a promoter has outside any event (their own, else the default): sales entered by hand. */
export function generalRuleFor(userId: number): AppliedRule {
  const levels: [RuleScope, RuleVersion | null][] = [
    ['default', currentRule('default')],
    ['promoter', currentRule('promoter', { userId })],
  ];
  const byName = new Map<string, RuleLine>();
  const from = new Map<string, RuleScope>();
  const versionIds: number[] = [];
  for (const [scope, version] of levels) {
    if (!version) continue;
    versionIds.push(version.id);
    for (const line of parseRule(version.text).lines) {
      byName.set(line.name, line);
      from.set(line.name, scope);
    }
  }
  return { lines: [...byName.values()], versionIds, key: versionIds.join('.') || 'none', from };
}

// --- Templates ----------------------------------------------------------------------------------------

export type RuleTemplate = { id: number; name: string; text: string; versionId: number | null };

export function listTemplates(): RuleTemplate[] {
  return db
    .query<{ id: number; name: string }, []>('SELECT id, name FROM rule_templates WHERE removed_at IS NULL ORDER BY name')
    .all()
    .map((t) => {
      const v = currentRule('template', { templateId: t.id });
      return { id: t.id, name: t.name, text: v?.text ?? '', versionId: v?.id ?? null };
    });
}

/** Creates or updates a template by name; returns its id. The text must already be checked. */
export function saveTemplate(name: string, text: string, by: number | null, id?: number): number {
  const clean = name.trim().slice(0, 60);
  let templateId = id;
  if (templateId) db.query('UPDATE rule_templates SET name = ?, removed_at = NULL WHERE id = ?').run(clean, templateId);
  else {
    templateId = db
      .query<{ id: number }, [string]>('INSERT INTO rule_templates (name) VALUES (?) ON CONFLICT (name) DO UPDATE SET removed_at = NULL RETURNING id')
      .get(clean)!.id;
  }
  saveRuleVersion('template', { templateId }, text, by);
  return templateId;
}

export function removeTemplate(id: number) {
  db.query("UPDATE rule_templates SET removed_at = datetime('now') WHERE id = ?").run(id);
}

// --- Reward types -------------------------------------------------------------------------------------

// What one is, in a sentence, shown to promoters so they know exactly what they ask for.
addColumn('reward_types', 'description_en', 'TEXT');
addColumn('reward_types', 'description_fr', 'TEXT');
// The first label of plain free tickets said nothing of what they are: given a clear one, unless changed.
db.query(
  "UPDATE reward_types SET label_en = 'Free ticket', label_fr = 'Billet gratuit', description_en = 'A regular entry ticket to the event, free.', description_fr = 'Un billet d’entrée régulier pour l’événement, gratuit.' WHERE key = 'free_tickets' AND label_en = 'Free tickets' AND description_en IS NULL",
).run();

export type RewardType = { key: string; label_en: string; label_fr: string; description_en?: string | null; description_fr?: string | null };

export const REWARD_KEY = /^[a-z][a-z0-9_]{1,39}$/;

export function listRewardTypes(): RewardType[] {
  return db.query<RewardType, []>('SELECT key, label_en, label_fr, description_en, description_fr FROM reward_types ORDER BY created_at, key').all();
}

export function rewardTypeOf(key: string): RewardType | null {
  return db.query<RewardType, [string]>('SELECT key, label_en, label_fr, description_en, description_fr FROM reward_types WHERE key = ?').get(key);
}

/** Adds or renames a reward type. Its key is what rules use and cannot be one of the fixed outputs. */
export function saveRewardType(key: string, labelEn: string, labelFr: string, descriptionEn = '', descriptionFr = ''): 'ok' | 'invalid' {
  if (!REWARD_KEY.test(key) || FIXED_OUTPUTS.some((o) => o.name === key)) return 'invalid';
  const en = labelEn.trim().slice(0, 40);
  const fr = labelFr.trim().slice(0, 40) || en;
  if (!en) return 'invalid';
  const dEn = descriptionEn.trim().slice(0, 200) || null;
  const dFr = descriptionFr.trim().slice(0, 200) || dEn;
  db.query(
    'INSERT INTO reward_types (key, label_en, label_fr, description_en, description_fr) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET label_en = excluded.label_en, label_fr = excluded.label_fr, description_en = excluded.description_en, description_fr = excluded.description_fr',
  ).run(key, en, fr, dEn, dFr);
  return 'ok';
}

/** Every name a rule may give: commission, bonus, merch and the reward types. */
export const ruleOutputs = (): string[] => [...FIXED_OUTPUTS.map((o) => o.name), ...listRewardTypes().map((t) => t.key)];

// --- From the rates and tracks used before rules --------------------------------------------------

// Written so the engine computes the same numbers the old code did: the percentage is applied first,
// then divided by 100, like Math.round(full price × percent) in cents.
const num = (n: number) => String(Number(n.toFixed(4)));

/** The commission line for a percentage or a flat amount per ticket (cents). */
export function commissionLine(rule: EventRule): string {
  return rule.kind === 'flat'
    ? `commission = (tickets_sold + outside_tickets) * ${num(rule.value / 100)}`
    : `commission = (full_price_sales + outside_sales) * ${num(rule.value)} / 100`;
}

/** A free-ticket track (milestones, then every N) as an expression on tickets_sold. */
export function trackExpression(t: Track): string {
  const parts = t.milestones.map((m) => `(tickets_sold >= ${m.at} ? ${m.count} : 0)`);
  if (t.every > 0) {
    const base = t.milestones.at(-1)?.at ?? 0;
    parts.push(
      base === 0
        ? `floor(tickets_sold / ${t.every}) * ${t.count}`
        : `(tickets_sold > ${base} ? floor((tickets_sold - ${base}) / ${t.every}) * ${t.count} : 0)`,
    );
  }
  return parts.length ? parts.join(' + ') : '0';
}

export const FREE_TICKETS = 'free_tickets';

/**
 * Once: turns the rates and the free-ticket track used before rules into rules, with the same results.
 * COMMISSION_PERCENT and the levels-and-rewards ticket track become the default rule, each promoter's
 * own rate a promoter rule, and each rate set on Commissions a promoter-on-event rule.
 */
export function migrateToRules() {
  if (db.query("SELECT 1 FROM settings WHERE key = 'rules:migrated'").get()) return;
  db.transaction(() => {
    if (!rewardTypeOf(FREE_TICKETS)) saveRewardType(FREE_TICKETS, 'Free ticket', 'Billet gratuit', 'A regular entry ticket to the event, free.', 'Un billet d’entrée régulier pour l’événement, gratuit.');
    const tickets = rewardRules().tickets;
    const defaultText = [
      '# Your usual deal. Events and promoters can have their own lines.',
      commissionLine({ kind: 'percent', value: config.commissionPercent }),
      ...(trackOn(tickets) ? [`${FREE_TICKETS} = ${trackExpression(tickets)}`] : []),
    ].join('\n');
    if (!currentRule('default')) saveRuleVersion('default', {}, defaultText, null);
    for (const u of listUsers()) {
      if (u.commission_flat_cents != null) saveRuleVersion('promoter', { userId: u.id }, commissionLine({ kind: 'flat', value: u.commission_flat_cents }), null);
      else if (u.commission_percent != null) saveRuleVersion('promoter', { userId: u.id }, commissionLine({ kind: 'percent', value: u.commission_percent }), null);
    }
    const hasRates = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_commissions'").get();
    const rates = hasRates
      ? db.query<{ user_id: number; event_id: number; kind: 'percent' | 'flat'; value: number }, []>('SELECT user_id, event_id, kind, value FROM event_commissions').all()
      : [];
    for (const r of rates) saveRuleVersion('promoter_event', { userId: r.user_id, eventId: r.event_id }, commissionLine({ kind: r.kind, value: r.value }), null);
    db.query("INSERT INTO settings (key, value) VALUES ('rules:migrated', ?)").run(new Date().toISOString());
  })();
}
