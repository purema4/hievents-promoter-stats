import { rangeBounds, today, type Range } from './chart';
import { dailyForCodes } from './hievents';
import { outsideSales } from './adjustments';
import { addColumn, codesFor, db, findUser, type User } from './local-db';
import { toCents } from './money';
import { notify } from './notifications';

/*
 * Teams: an admin makes a promoter a team lead and puts other promoters on their team. A team lead
 * sees their team's sales (on /team) and nothing they can act on: payouts, rewards and settings stay
 * with each promoter and the admins. A team lead can also earn a team commission on their promoters' sales. One level only: a team lead is not on anyone's team, and admins
 * are on no team (they see everything anyway).
 */
addColumn('users', 'is_team_lead', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'team_lead_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
// The team lead's share of their promoters' sales (full price, like promoters' own commission), on top
// of what the promoters earn. Not of the team lead's own sales. NULL means none yet.
addColumn('users', 'team_commission_percent', 'REAL');

/*
 * Who was on which team, and when: a team lead earns on a promoter's sales from the day they join the
 * team (in APP_TIMEZONE) through the day they leave; a promoter who moves joins the next team the day
 * after, so no day counts twice. So moving promoters never takes back what a team lead already earned.
 * When a promoter is deleted, their codes are kept here for the same reason.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS team_memberships (
    id        INTEGER PRIMARY KEY,
    lead_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    codes     TEXT,
    from_day  TEXT NOT NULL,
    to_day    TEXT
  );
  CREATE INDEX IF NOT EXISTS team_memberships_lead ON team_memberships (lead_id);
  CREATE INDEX IF NOT EXISTS team_memberships_member ON team_memberships (member_id);
`);
// A deleted promoter's sales outside Hi.Events, kept like their codes.
addColumn('team_memberships', 'outside', 'TEXT');
// Teams set up before memberships were kept: counted from today.
db.query(
  `INSERT INTO team_memberships (lead_id, member_id, from_day)
   SELECT team_lead_id, id, ? FROM users u WHERE team_lead_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM team_memberships m WHERE m.member_id = u.id AND m.to_day IS NULL)`,
).run(today());

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Today, or tomorrow when they left a team today (that day counted for it). */
function joinDay(memberId: number): string {
  const left = db.query('SELECT 1 FROM team_memberships WHERE member_id = ? AND to_day >= ? LIMIT 1').get(memberId, today());
  return left ? nextDay(today()) : today();
}

function closeMemberships(where: 'member_id' | 'lead_id', userId: number) {
  db.query(`UPDATE team_memberships SET to_day = ? WHERE ${where} = ? AND to_day IS NULL`).run(today(), userId);
}

/** Before a promoter is deleted: their team lead keeps what they earned on them. */
export function keepTeamHistory(userId: number) {
  db.query('UPDATE team_memberships SET codes = ?, outside = ? WHERE member_id = ?').run(
    JSON.stringify(codesFor(userId)),
    JSON.stringify(outsideSales(userId)),
    userId,
  );
  closeMemberships('member_id', userId);
}

export const teamCommissionPercentFor = (lead: User) => lead.team_commission_percent ?? 0;

export function setTeamCommission(leadId: number, percent: number | null) {
  db.query('UPDATE users SET team_commission_percent = ? WHERE id = ?').run(percent, leadId);
}

export type TeamCommission = { currency: string; sales: number; commission: number }; // cents

/**
 * What a team lead earned on their promoters' sales, all time or for a period: every promoter who was
 * on their team, for the days they were on it.
 */
export async function teamCommission(lead: User, range: Range = 'all'): Promise<TeamCommission[]> {
  const rows = db
    .query<{ member_id: number | null; codes: string | null; outside: string | null; from_day: string; to_day: string | null }, [number]>(
      'SELECT member_id, codes, outside, from_day, to_day FROM team_memberships WHERE lead_id = ?',
    )
    .all(lead.id);
  const from = range === 'all' ? '' : rangeBounds(range, []).from;
  const sales = new Map<string, number>();
  for (const row of rows) {
    const counts = (day: string) => day >= row.from_day && (!row.to_day || day <= row.to_day) && day >= from;
    const codes: string[] = row.codes ? JSON.parse(row.codes) : row.member_id ? codesFor(row.member_id) : [];
    for (const d of await dailyForCodes(codes)) {
      if (counts(d.day)) sales.set(d.currency, (sales.get(d.currency) ?? 0) + toCents(d.full_price));
    }
    // Sales outside Hi.Events count by the day an admin entered them.
    const outside: { day: string; currency: string; cents: number }[] = row.outside ? JSON.parse(row.outside) : row.member_id ? outsideSales(row.member_id) : [];
    for (const o of outside) {
      if (counts(o.day)) sales.set(o.currency, (sales.get(o.currency) ?? 0) + o.cents);
    }
  }
  const percent = teamCommissionPercentFor(lead);
  return [...sales].map(([currency, cents]) => ({ currency, sales: cents, commission: Math.round((cents * percent) / 100) }));
}

/** True when someone ever was on this person's team, so they may have team commission. */
export const hadTeam = (leadId: number) => !!db.query('SELECT 1 FROM team_memberships WHERE lead_id = ? LIMIT 1').get(leadId);

export const isTeamLead = (user: User) => !!user.is_team_lead && !user.is_admin;

export function teamLeads(): User[] {
  return db.query<User, []>('SELECT * FROM users WHERE is_team_lead = 1 AND is_admin = 0 ORDER BY name COLLATE NOCASE').all();
}

export function teamMembers(leadId: number): User[] {
  return db.query<User, [number]>('SELECT * FROM users WHERE team_lead_id = ? ORDER BY name COLLATE NOCASE').all(leadId);
}

/** The promoter, when they are on this team lead's team; null otherwise. */
export function teamMember(lead: User, memberId: number): User | null {
  const member = Number.isInteger(memberId) ? findUser(memberId) : null;
  return member && isTeamLead(lead) && member.team_lead_id === lead.id ? member : null;
}

/** The team lead of a promoter's team, when they are on one. */
export function teamLeadOf(user: User): User | null {
  const lead = user.team_lead_id ? findUser(user.team_lead_id) : null;
  return lead && isTeamLead(lead) ? lead : null;
}

/** True when the other person is on the same team as this promoter (their team lead included). */
export function sameTeam(viewer: User, otherId: number): boolean {
  const lead = teamLeadOf(viewer);
  if (!lead || !Number.isInteger(otherId)) return false;
  return otherId === lead.id || findUser(otherId)?.team_lead_id === lead.id;
}

export type TeamResult = 'ok' | 'team_admin' | 'team_not_lead' | 'team_is_lead' | 'team_self';

/** Makes a promoter a team lead, or not. A new team lead leaves their own team; one who steps down leaves their team without a lead. */
export function setTeamLead(user: User, lead: boolean): TeamResult {
  if (user.is_admin) return 'team_admin';
  if (lead === !!user.is_team_lead) return 'ok';
  db.transaction(() => {
    if (lead) {
      db.query('UPDATE users SET is_team_lead = 1, team_lead_id = NULL WHERE id = ?').run(user.id);
      closeMemberships('member_id', user.id);
    } else {
      db.query('UPDATE users SET is_team_lead = 0 WHERE id = ?').run(user.id);
      db.query('UPDATE users SET team_lead_id = NULL WHERE team_lead_id = ?').run(user.id);
      closeMemberships('lead_id', user.id);
    }
  })();
  if (lead) notify(user.id, { title: 'You are a team lead', body: 'You can now follow the sales of your team under My team.', link: '/team' });
  return 'ok';
}

/** For an account that becomes an admin: off every team, and no longer a team lead. */
export function leaveTeams(userId: number) {
  db.transaction(() => {
    db.query('UPDATE users SET is_team_lead = 0, team_lead_id = NULL WHERE id = ?').run(userId);
    db.query('UPDATE users SET team_lead_id = NULL WHERE team_lead_id = ?').run(userId);
    closeMemberships('member_id', userId);
    closeMemberships('lead_id', userId);
  })();
}

/** Puts a promoter on a team lead's team (moving them from any other), or on no team with null. */
export function assignTeam(user: User, leadId: number | null): TeamResult {
  if (leadId === null) {
    db.transaction(() => {
      db.query('UPDATE users SET team_lead_id = NULL WHERE id = ?').run(user.id);
      closeMemberships('member_id', user.id);
    })();
    return 'ok';
  }
  if (user.is_admin) return 'team_admin';
  if (user.is_team_lead) return 'team_is_lead';
  if (leadId === user.id) return 'team_self';
  const lead = findUser(leadId);
  if (!lead || !isTeamLead(lead)) return 'team_not_lead';
  if (user.team_lead_id === lead.id) return 'ok';
  db.transaction(() => {
    db.query('UPDATE users SET team_lead_id = ? WHERE id = ?').run(lead.id, user.id);
    closeMemberships('member_id', user.id);
    db.query('INSERT INTO team_memberships (lead_id, member_id, from_day) VALUES (?, ?, ?)').run(lead.id, user.id, joinDay(user.id));
  })();
  // They are told who can see their sales.
  notify(user.id, {
    title: 'You joined a team',
    body: `${lead.name} is your team lead and can now see your sales. Your team's tickets and sales are under My team.`,
    link: '/team',
  });
  return 'ok';
}
