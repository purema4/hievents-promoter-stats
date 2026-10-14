import nodemailer from 'nodemailer';
import { getBrand } from './brand';
import { config } from './config';
import { getReplyTo, renderEmail, type EmailType } from './email-templates';
import { db } from './local-db';

// One pooled connection is reused for every email instead of reconnecting each time.
const transport = config.smtp.host
  ? nodemailer.createTransport({
      pool: true,
      maxConnections: 2,
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
      // Fail fast when the mail server is unreachable (the default waits two minutes).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

// Printing links is only for local testing: anyone who can read the log could sign in as that promoter.
const printLinks = !transport && process.env.NODE_ENV !== 'production';

if (!transport) {
  console.warn(
    printLinks
      ? 'SMTP_HOST is not set: sign-in links will be printed to this log instead of emailed.'
      : 'SMTP_HOST is not set: emails cannot be sent. Only password sign-in will work.',
  );
}

db.exec(`
  CREATE TABLE IF NOT EXISTS email_log (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL,
    recipient  TEXT NOT NULL,
    subject    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    attempts   INTEGER NOT NULL,
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type EmailLogEntry = {
  id: number;
  type: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  attempts: number;
  error: string | null;
  created_at: string;
};

export function recentEmails(): EmailLogEntry[] {
  return db.query<EmailLogEntry, []>('SELECT * FROM email_log ORDER BY id DESC LIMIT 50').all();
}

export function purgeEmailLog() {
  db.query("DELETE FROM email_log WHERE created_at < datetime('now', '-60 days')").run();
}

// The sender is the brand name with the address from MAIL_FROM, so it updates with the branding.
function sender(): { name: string; address: string } {
  const address = config.smtp.from.match(/<([^>]+)>/)?.[1] ?? config.smtp.from.trim();
  return { name: getBrand().name, address };
}

/**
 * Renders and sends one email to each recipient. Temporary failures (connection drops, 4xx replies)
 * are retried with a growing pause; every outcome is logged for the admin. Never throws.
 */
export async function sendEmail(
  type: EmailType,
  to: { name: string; email: string }[],
  vars: Record<string, string>,
  template?: Parameters<typeof renderEmail>[2],
  // Someone waiting on the page (an admin sending an invite or a test) gets one quick try and the
  // result; background sends retry.
  options: { attempts: number } = { attempts: 3 },
): Promise<boolean> {
  let allSent = true;
  for (const person of to) {
    const email = renderEmail(type, { name: person.name, ...vars }, template);
    if (!transport) {
      if (!printLinks) {
        log(type, person.email, email.subject, 'failed', 0, 'SMTP is not configured');
        allSent = false;
        continue;
      }
      console.log(`Email to ${person.email}: ${email.subject}${vars.link ? ` (${vars.link})` : ''}`);
      log(type, person.email, email.subject, 'sent', 0, 'printed to the log, SMTP not set');
      continue;
    }
    let attempt = 0;
    let lastError = '';
    let sent = false;
    while (attempt < options.attempts && !sent) {
      attempt++;
      try {
        await transport.sendMail({
          from: sender(),
          to: { name: person.name, address: person.email },
          replyTo: getReplyTo() || undefined,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        sent = true;
      } catch (err) {
        const e = err as { responseCode?: number; message?: string };
        lastError = e.message ?? String(err);
        // 5xx means the server refused for good (bad address, rejected sender): retrying will not help.
        if (e.responseCode && e.responseCode >= 500) break;
        if (attempt < options.attempts) await Bun.sleep(attempt * 2000);
      }
    }
    log(type, person.email, email.subject, sent ? 'sent' : 'failed', attempt, sent ? null : lastError);
    if (!sent) {
      console.error(`Could not send "${email.subject}" to ${person.email}: ${lastError}`);
      allSent = false;
    }
  }
  return allSent;
}

function log(type: string, recipient: string, subject: string, status: 'sent' | 'failed', attempts: number, error: string | null) {
  db.query('INSERT INTO email_log (type, recipient, subject, status, attempts, error) VALUES (?, ?, ?, ?, ?, ?)').run(
    type,
    recipient,
    subject,
    status,
    attempts,
    error?.slice(0, 300) ?? null,
  );
}
