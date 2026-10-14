import { type EmailType } from './email-templates';
import { db, listUsers, type User } from './local-db';
import { sendEmail } from './mail';
import { notify } from './notifications';

/*
 * What each admin wants to hear about, and how: by email, as an app notification (the bell and
 * phone push), both, or not at all. Stored per admin; anything not saved uses the defaults below.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS alert_prefs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert   TEXT NOT NULL,
    email   INTEGER NOT NULL,
    app     INTEGER NOT NULL,
    PRIMARY KEY (user_id, alert)
  );
`);

export type AlertKey = 'payout_requested' | 'reward_requested' | 'promoter_level' | 'promoter_merch' | 'new_signin';

export const alerts: { key: AlertKey; label: string; hint: string; email: EmailType; defaults: { email: boolean; app: boolean } }[] = [
  { key: 'payout_requested', label: 'A promoter requested a payout', hint: 'So you can pay them.', email: 'payout_requested', defaults: { email: true, app: true } },
  { key: 'reward_requested', label: 'A promoter requested a reward', hint: 'Free tickets or merch.', email: 'reward_requested', defaults: { email: true, app: true } },
  { key: 'promoter_level', label: 'A promoter reached a new level', hint: 'Bronze, Silver, Gold…', email: 'promoter_milestone', defaults: { email: false, app: true } },
  { key: 'promoter_merch', label: 'A promoter unlocked merch', hint: 'They can now request an item.', email: 'promoter_milestone', defaults: { email: false, app: true } },
  { key: 'new_signin', label: 'A new sign-in on your account', hint: 'From a kind of device not seen before.', email: 'new_signin', defaults: { email: false, app: true } },
];

export type Prefs = Record<AlertKey, { email: boolean; app: boolean }>;

export function prefsFor(userId: number): Prefs {
  const rows = db.query<{ alert: string; email: number; app: number }, [number]>('SELECT alert, email, app FROM alert_prefs WHERE user_id = ?').all(userId);
  return Object.fromEntries(
    alerts.map((a) => {
      const row = rows.find((r) => r.alert === a.key);
      return [a.key, row ? { email: !!row.email, app: !!row.app } : { ...a.defaults }];
    }),
  ) as Prefs;
}

export function savePrefs(userId: number, prefs: Prefs) {
  db.transaction(() => {
    for (const a of alerts) {
      db.query(
        'INSERT INTO alert_prefs (user_id, alert, email, app) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, alert) DO UPDATE SET email = excluded.email, app = excluded.app',
      ).run(userId, a.key, prefs[a.key].email ? 1 : 0, prefs[a.key].app ? 1 : 0);
    }
  })();
}

type Message = { title: string; body: string; link: string };

/** Sends one alert to one person, the way they chose. Never waits on email. */
export function alertUser(user: User, key: AlertKey, message: Message, emailVars: Record<string, string>) {
  const pref = prefsFor(user.id)[key];
  if (pref.app) notify(user.id, message);
  if (pref.email) {
    const def = alerts.find((a) => a.key === key)!;
    setTimeout(() => void sendEmail(def.email, [user], emailVars), 0);
  }
}

/** Sends an alert to every admin, each according to their own settings. */
export function alertAdmins(key: AlertKey, message: Message, emailVars: Record<string, string>) {
  for (const admin of listUsers().filter((u) => u.is_admin)) alertUser(admin, key, message, emailVars);
}
