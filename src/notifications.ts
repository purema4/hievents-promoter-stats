import webpush from 'web-push';
import { config } from './config';
import { db, listUsers } from './local-db';

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
  const message = { title: 'Test notification', body: 'Notifications work on this device.', link: '/notifications' };
  db.query('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)').run(userId, message.title, message.body, message.link);
  return sendPush(userId, { title: message.title, body: message.body, url: message.link, unread: unreadCount(userId) });
}

// --- Notifications -----------------------------------------------------------------------------

export type Recipient = number | 'admins';

/** Stores the notification for each recipient and pushes it to their devices, without waiting. */
export function notify(to: Recipient | Recipient[], message: { title: string; body: string; link: string }) {
  const list = Array.isArray(to) ? to : [to];
  const ids = new Set(list.flatMap((r) => (r === 'admins' ? listUsers().filter((u) => u.is_admin).map((u) => u.id) : [r])));
  for (const userId of ids) {
    db.query('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)').run(userId, message.title, message.body, message.link);
    const unread = unreadCount(userId);
    setTimeout(() => void sendPush(userId, { title: message.title, body: message.body, url: message.link, unread }), 0);
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

export function purgeOldNotifications() {
  db.query("DELETE FROM notifications WHERE created_at < datetime('now', '-90 days')").run();
}
