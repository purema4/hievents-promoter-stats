import webpush from 'web-push';
import { config } from './config';
import { db, findUser, listUsers } from './local-db';
import { t, withLang } from './i18n';

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    link       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, read_at);
  -- What admins sent themselves (to one promoter, a team or everyone), for the list on the send page.
  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY,
    sent_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    audience   TEXT NOT NULL, -- like "Everyone", "Maya Tremblay's team" or "Kai Morin"
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    link       TEXT,
    recipients INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type Notification = {
  id: number;
  user_id: number;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

// --- Web Push keys -----------------------------------------------------------------------------
// Generated once and kept in the database, so installed apps stay subscribed across restarts.

function vapidKeys(): { publicKey: string; privateKey: string } {
  const row = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'vapid'").get();
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys();
  db.query("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

const keys = vapidKeys();
// The contact push services can use about these messages: the admin email, or the app's address.
// Push services only accept a mailto: or https: contact.
const contact = config.adminEmail
  ? `mailto:${config.adminEmail}`
  : config.appUrl.startsWith('https:')
    ? config.appUrl
    : 'mailto:admin@localhost';
webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);

export const pushPublicKey = keys.publicKey;

// The browser chooses where pushes are delivered. Only real push services are accepted, so a
// signed-in user cannot make the server send requests to an address of their choosing.
const pushHosts = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && pushHosts.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

// A browser subscription carries an uncompressed P-256 public key (65 bytes, starting 0x04) and a
// 16-byte secret; anything else cannot be encrypted for and is refused when subscribing.
export function isPushKeys(p256dh: string, auth: string): boolean {
  try {
    const key = Buffer.from(p256dh, 'base64url');
    return key.length === 65 && key[0] === 0x04 && Buffer.from(auth, 'base64url').length === 16;
  } catch {
    return false;
  }
}

export function savePushSubscription(userId: number, sub: { endpoint: string; p256dh: string; auth: string }) {
  db.query(
    'INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth',
  ).run(sub.endpoint, userId, sub.p256dh, sub.auth);
}

export function removePushSubscription(userId: number, endpoint: string) {
  db.query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
}

export function pushDeviceCount(userId: number): number {
  return db.query<{ n: number }, [number]>('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId)!.n;
}

async function sendPush(
  userId: number,
  payload: { title: string; body: string; url: string; unread: number },
): Promise<{ devices: number; delivered: number }> {
  const subs = db
    .query<{ endpoint: string; p256dh: string; auth: string }, [number]>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    )
    .all(userId);
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
        TTL: 24 * 3600,
        timeout: 8000,
      });
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404 and 410 mean the app was uninstalled or notifications were turned off.
      if (status === 404 || status === 410) db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      else console.error(`Push to user ${userId} failed:`, status ?? err);
    }
  }
  return { devices: subs.length, delivered };
}

// One test every 30 seconds per person is plenty to check a device.
const lastTest = new Map<number, number>();

export type TestResult = { devices: number; delivered: number } | 'too_soon';

/** Like notify(), but waits for the push services so the page can say what happened. */
export async function sendTestNotification(userId: number): Promise<TestResult> {
  if (Date.now() - (lastTest.get(userId) ?? 0) < 30_000) return 'too_soon';
  lastTest.set(userId, Date.now());
  const message = withLang(findUser(userId)?.lang, () => ({
    title: t('Test notification', 'Notification de test'),
    body: t('Notifications work on this device.', 'Les notifications fonctionnent sur cet appareil.'),
    link: '/notifications',
  }));
  db.query('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)').run(userId, message.title, message.body, message.link);
  return sendPush(userId, { title: message.title, body: message.body, url: message.link, unread: unreadCount(userId) });
}

// --- Notifications -----------------------------------------------------------------------------

export type Recipient = number | 'admins';
export type NotificationMessage = { title: string; body: string; link: string };

/**
 * Stores the notification for each recipient and pushes it to their devices, without waiting.
 * A function is worded once per recipient, in their language: () => ({ title: t('…', '…'), … }).
 */
export function notify(to: Recipient | Recipient[], wording: NotificationMessage | (() => NotificationMessage)) {
  const list = Array.isArray(to) ? to : [to];
  const ids = new Set(list.flatMap((r) => (r === 'admins' ? listUsers().filter((u) => u.is_admin).map((u) => u.id) : [r])));
  for (const userId of ids) {
    const message = typeof wording === 'function' ? withLang(findUser(userId)?.lang, wording) : wording;
    const { id } = db.query<{ id: number }, [number, string, string, string]>('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?) RETURNING id').get(userId, message.title, message.body, message.link)!;
    const unread = unreadCount(userId);
    // Tapping it on the phone marks it as read too, then goes to its link.
    setTimeout(() => void sendPush(userId, { title: message.title, body: message.body, url: `/notifications/${id}`, unread }), 0);
  }
}

export function unreadCount(userId: number): number {
  return db.query<{ n: number }, [number]>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId)!.n;
}

export function notificationsFor(userId: number): Notification[] {
  return db
    .query<Notification, [number]>('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(userId);
}

export function markAllRead(userId: number) {
  db.query("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
}

/** One of their notifications, marked as read unless `peek` (an admin viewing as them). */
export function openNotification(userId: number, id: number, peek = false): Notification | null {
  const n = db.query<Notification, [number, number]>('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, userId);
  if (n && !n.read_at && !peek) db.query("UPDATE notifications SET read_at = datetime('now') WHERE id = ?").run(id);
  return n;
}

// --- Sent by admins -------------------------------------------------------------------------------

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 300;

export type Announcement = { id: number; sent_by: number | null; sender: string | null; audience: string; title: string; body: string; link: string | null; recipients: number; created_at: string };

/** A link inside the app ("/payouts"), or nothing; never another site. */
export function announcementLink(raw: string): string | null | undefined {
  const link = raw.trim();
  if (!link) return null;
  return /^\/(?![/\\])[^\s]{0,199}$/.test(link) ? link : undefined;
}

/** Sends a message from the team to these promoters, in the app and on their phones, and keeps a record. */
export function sendAnnouncement(by: number, audience: string, userIds: number[], message: { title: string; body: string; link: string | null }): number {
  const ids = [...new Set(userIds)];
  if (ids.length > 0) notify(ids, { title: message.title, body: message.body, link: message.link ?? '/notifications' });
  db.query('INSERT INTO announcements (sent_by, audience, title, body, link, recipients) VALUES (?, ?, ?, ?, ?, ?)').run(by, audience, message.title, message.body, message.link, ids.length);
  return ids.length;
}

export function recentAnnouncements(): Announcement[] {
  return db
    .query<Announcement, []>('SELECT a.*, u.name AS sender FROM announcements a LEFT JOIN users u ON u.id = a.sent_by ORDER BY a.id DESC LIMIT 30')
    .all();
}

export function purgeOldNotifications() {
  db.query("DELETE FROM notifications WHERE created_at < datetime('now', '-90 days')").run();
}
