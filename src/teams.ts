import { addColumn, db, findUser, type User } from './local-db';
import { notify } from './notifications';

/*
 * Teams: an admin makes a promoter a team lead and puts other promoters on their team. A team lead
 * sees their team's sales (on /team) and nothing they can act on: payouts, rewards and settings stay
 * with each promoter and the admins. One level only: a team lead is not on anyone's team, and admins
 * are on no team (they see everything anyway).
 */
addColumn('users', 'is_team_lead', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'team_lead_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

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

export type TeamResult = 'ok' | 'team_admin' | 'team_not_lead' | 'team_is_lead' | 'team_self';

/** Makes a promoter a team lead, or not. A new team lead leaves their own team; one who steps down leaves their team without a lead. */
export function setTeamLead(user: User, lead: boolean): TeamResult {
  if (user.is_admin) return 'team_admin';
  if (lead === !!user.is_team_lead) return 'ok';
  db.transaction(() => {
    if (lead) db.query('UPDATE users SET is_team_lead = 1, team_lead_id = NULL WHERE id = ?').run(user.id);
    else {
      db.query('UPDATE users SET is_team_lead = 0 WHERE id = ?').run(user.id);
      db.query('UPDATE users SET team_lead_id = NULL WHERE team_lead_id = ?').run(user.id);
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
  })();
}

/** Puts a promoter on a team lead's team (moving them from any other), or on no team with null. */
export function assignTeam(user: User, leadId: number | null): TeamResult {
  if (leadId === null) {
    db.query('UPDATE users SET team_lead_id = NULL WHERE id = ?').run(user.id);
    return 'ok';
  }
  if (user.is_admin) return 'team_admin';
  if (user.is_team_lead) return 'team_is_lead';
  if (leadId === user.id) return 'team_self';
  const lead = findUser(leadId);
  if (!lead || !isTeamLead(lead)) return 'team_not_lead';
  if (user.team_lead_id === lead.id) return 'ok';
  db.query('UPDATE users SET team_lead_id = ? WHERE id = ?').run(lead.id, user.id);
  // They are told who can see their sales.
  notify(user.id, { title: 'You joined a team', body: `${lead.name} is your team lead and can now see your sales.`, link: '/' });
  return 'ok';
}
