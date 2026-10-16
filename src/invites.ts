import { addColumn, db, findUser, type User } from './local-db';

/*
 * Invite links: anyone with one can make a promoter account by entering their name and email, and gets
 * a sign-in link by email (so the address is theirs before they can sign in). Admins make them, and so
 * do team leads, whose links put new promoters on their own team. A link can expire and be limited to
 * a number of sign-ups, and can be turned off. New promoters have no promo codes until an admin adds them.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_links (
    id           INTEGER PRIMARY KEY,
    token        TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    team_lead_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    max_uses     INTEGER,
    uses         INTEGER NOT NULL DEFAULT 0,
    expires_at   INTEGER,
    disabled_at  INTEGER,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL
  );
`);
// Which invite link a promoter joined with, for their admin page.
addColumn('users', 'joined_with_invite', 'INTEGER');

export type InviteLink = {
  id: number;
  token: string;
  label: string;
  team_lead_id: number | null;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  disabled_at: number | null;
  created_by: number | null;
  created_at: number;
};

const now = () => Math.floor(Date.now() / 1000);

export function createInvite(by: User, input: { label: string; teamLeadId: number | null; maxUses: number | null; days: number | null }): InviteLink {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');
  return db
    .query<InviteLink, [string, string, number | null, number | null, number | null, number, number]>(
      'INSERT INTO invite_links (token, label, team_lead_id, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .get(token, input.label, input.teamLeadId, input.maxUses, input.days ? now() + input.days * 86400 : null, by.id, now())!;
}

/** Every link, newest first (admins), or only the ones a team lead made for their team. */
export function invitesFor(viewer: User): InviteLink[] {
  return viewer.is_admin
    ? db.query<InviteLink, []>('SELECT * FROM invite_links ORDER BY id DESC').all()
    : db.query<InviteLink, [number, number]>('SELECT * FROM invite_links WHERE team_lead_id = ? AND created_by = ? ORDER BY id DESC').all(viewer.id, viewer.id);
}

export function findInvite(id: number): InviteLink | null {
  return db.query<InviteLink, [number]>('SELECT * FROM invite_links WHERE id = ?').get(id);
}

/** Whether this person may turn the link off or on: admins, and the team lead who made it. */
export const canManageInvite = (viewer: User, invite: InviteLink) =>
  !!viewer.is_admin || (invite.team_lead_id === viewer.id && invite.created_by === viewer.id);

export function setInviteDisabled(id: number, disabled: boolean) {
  db.query('UPDATE invite_links SET disabled_at = ? WHERE id = ?').run(disabled ? now() : null, id);
}

export type InviteState = 'open' | 'off' | 'expired' | 'full';

export function inviteState(invite: InviteLink): InviteState {
  if (invite.disabled_at) return 'off';
  if (invite.expires_at && invite.expires_at < now()) return 'expired';
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) return 'full';
  return 'open';
}

/** The link behind a token from the address bar, whether or not it still works. */
export function inviteByToken(token: string): InviteLink | null {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return db.query<InviteLink, [string]>('SELECT * FROM invite_links WHERE token = ?').get(token);
}

/** Counts a sign-up, if the link still has room: checked and counted at once, so it never goes over. */
export function useInvite(id: number): boolean {
  return (
    db
      .query(
        'UPDATE invite_links SET uses = uses + 1 WHERE id = ? AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at >= ?) AND (max_uses IS NULL OR uses < max_uses)',
      )
      .run(id, now()).changes === 1
  );
}

export function markJoined(userId: number, inviteId: number) {
  db.query('UPDATE users SET joined_with_invite = ? WHERE id = ?').run(inviteId, userId);
}

/** The team lead a link puts new promoters with, when they are still a team lead. */
export function inviteTeamLead(invite: InviteLink): User | null {
  const lead = invite.team_lead_id ? findUser(invite.team_lead_id) : null;
  return lead && lead.is_team_lead && !lead.is_admin ? lead : null;
}

// At most 20 sign-ups an hour on one link, so a link that leaks cannot be used to send lots of email
// (sign-in links to one address are limited too). Counted per link: addresses can be shared or faked.
const signups = new Map<number, number[]>();
export function allowSignup(inviteId: number): boolean {
  const recent = (signups.get(inviteId) ?? []).filter((t) => t > Date.now() - 3600_000);
  if (recent.length >= 20) return false;
  signups.set(inviteId, [...recent, Date.now()]);
  if (signups.size > 10_000) signups.delete(signups.keys().next().value!);
  return true;
}
