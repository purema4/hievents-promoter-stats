function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Public URL the app is reached at, e.g. https://promoters.example.com. Used for CSRF origin checks.
  appUrl: required('APP_URL').replace(/\/$/, ''),
  // Read-only connection string to the Hi.Events Postgres database.
  hieventsDatabaseUrl: required('HIEVENTS_DATABASE_URL'),
  // Optional comma-separated Hi.Events account ids. When set, only events from these accounts are visible.
  accountIds: (process.env.HIEVENTS_ACCOUNT_IDS ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0),
  dataDir: process.env.DATA_DIR ?? './data',
  // Where Hi.Events serves uploaded images from: its APP_CDN_URL, or its storage URL. Covers are
  // fetched from here by the server and passed on, so they also work on a phone and keep the CSP strict.
  // Hi.Events' public site (its FRONTEND_URL), for event links. Admins can also set it on /admin/links.
  hieventsPublicUrl: (process.env.HIEVENTS_PUBLIC_URL ?? '').replace(/\/$/, ''),
  imageBaseUrl: (process.env.HIEVENTS_IMAGE_BASE_URL ?? '').replace(/\/$/, ''),
  cookieSecure: bool('COOKIE_SECURE', true),
  // Share of sales (after discounts, before taxes and fees) paid back to promoters. Can be overridden per promoter.
  commissionPercent: Number(process.env.COMMISSION_PERCENT ?? 10),
  // Optional password login for the first admin, so there is a way in even if email is down.
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  milestoneCheckMinutes: Math.max(1, Number(process.env.MILESTONE_CHECK_MINUTES ?? 5)),
  // Days in the sales chart are counted in this time zone.
  timezone: process.env.APP_TIMEZONE || 'America/Toronto',
  // Rewards: 1 free ticket for an event once a promoter sells 1 ticket for it, then 1 more every
  // REWARD_TICKET_EVERY tickets; 1 merch item every MERCH_EVERY tickets sold in total.
  rewardTicketEvery: Math.max(1, Number(process.env.REWARD_TICKET_EVERY ?? 5)),
  merchEvery: Math.max(1, Number(process.env.MERCH_EVERY ?? 50)),
  // Choices in the payout request form, comma separated.
  payoutMethods: (process.env.PAYOUT_METHODS || 'Interac e-Transfer,Cash')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  // Cash is handed over in round amounts: payouts by this method must be a multiple of CASH_STEP dollars.
  cashMethod: process.env.CASH_METHOD || 'Cash',
  cashStepCents: Math.max(1, Math.round(Number(process.env.CASH_STEP ?? 50) * 100)),
  loginLinkMinutes: Number(process.env.LOGIN_LINK_MINUTES ?? 30),
  // Invites sent by an admin stay valid longer than links a promoter requests themselves.
  inviteLinkDays: Number(process.env.INVITE_LINK_DAYS ?? 7),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: bool('SMTP_SECURE', false),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM ?? 'Promoter stats <no-reply@example.com>',
  },
};
