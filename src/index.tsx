import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import {
  allowLinkRequest,
  markSessionApp,
  revokeOtherSessions,
  revokeSession,
  sessionsFor,
  approveWaiting,
  consumeLoginCode,
  currentUser,
  exchangeWaiting,
  startWaiting,
  summarizeDevice,
  consumeLoginToken,
  endSession,
  purgeExpiredSessions,
  requireAdmin,
  requireTeamLead,
  revokeAccess,
  canImpersonate,
  startImpersonating,
  stopImpersonating,
  requireUser,
  startSession,
  verifyLogin,
  type Env,
} from './auth';
import { config } from './config';
import { audit } from './audit';
import { alerts, prefsFor, savePrefs, type Prefs } from './alert-prefs';
import { addAdjustment, adjustmentsFor, describeAdjustment, findAdjustment, removeAdjustment } from './adjustments';
import {
  confirmSetup,
  disableTwoFactor,
  failPendingSignIn,
  finishPendingSignIn,
  hasTwoFactor,
  newRecoveryCodes,
  pendingSecret,
  pendingSignIn,
  purgePendingSignIns,
  recoveryCodesLeft,
  setupQr,
  startPendingSignIn,
  startSetup,
  verifySecondFactor,
} from './two-factor';
import { leaderboard, type Sort } from './leaderboard';
import { aliasPattern, aliasTaken, ensureAliases, eventLink, linkSettings, pageLink, saveLinkSettings, setAlias, suggestAlias } from './links';
import { avatarOf, deliverAvatar, moveAvatarsToBucket, shrinkStoredAvatars, refreshAllAvatars, refreshInstagramAvatar, saveUploadedAvatar, useInstagramAvatar } from './avatars';
import { brandCss, deliverLogo, getBrand, isHex, moveLogoToBucket, shrinkStoredLogo, removeLogo, saveLogo, updateBrand } from './brand';
import { cdnOrigin, checkStorage, type Delivery } from './storage';
import { allowImageUpload, maxImageSide, maxUploadBytes, processImage, purgeUploadCounts, type ImageProblem } from './images';
import { parseRange } from './chart';
import { checkAllMilestones, checkMilestones } from './milestones';
import {
  isPushEndpoint,
  isPushKeys,
  markAllRead,
  notificationsFor,
  notify,
  purgeOldNotifications,
  pushDeviceCount,
  pushPublicKey,
  removePushSubscription,
  savePushSubscription,
  sendTestNotification,
} from './notifications';
import { blankPng, eventCover } from './covers';
import { allPromoCodes, dailyForCodes, sql } from './hievents';
import { recentEmails, sendEmail, purgeEmailLog } from './mail';
import { emailTypes, getTemplate, renderEmail, resetTemplate, sampleVars, saveReplyTo, saveTemplate, type EmailType } from './email-templates';
import { formatMoney, usualCommissionOn, type EventRule } from './money';
import {
  findPayout,
  listPayouts,
  payoutsFor,
  requestPayout,
} from './payouts';
import { DashboardPage, EventPage, PayoutsPage, summarizeEvents } from './promoter-views';
import {
  findRewardRequest,
  listRewardRequests,
  requestReward,
  rewardRequestsFor,
} from './rewards';
import { describeProblem, isCustomized as isRulesCustomized, rewardRules, saveRewardRules, type LevelColor, type RewardRules, type Track } from './reward-rules';
import { kuttDomains, kuttEnabled, pageClicks, pageShortLink, prepareShortLinks, renamePageLink, saveShortDomain, shortLinkStatus } from './short-links';
import { MyPagePage, PageMissing, PromoterDirectoryPage, PromoterPublicPage } from './page-views';
import { hiddenByTeam, listedPages, pageEvents, pageOwner, setPageHidden } from './promoter-page';
import { allEventRules, setEventRule } from './commission';
import { allMediaDrives, parseMediaUrl, setMediaDrive } from './media-drives';
import { filterCodes, parseCodeFilter } from './promo-code-list';
import {
  allowSignup,
  canManageInvite,
  createInvite,
  findInvite,
  inviteByToken,
  inviteState,
  inviteTeamLead,
  invitesFor,
  markJoined,
  setInviteDisabled,
  useInvite,
} from './invites';
import {
  assignTeam,
  isTeamLead,
  keepTeamHistory,
  leaveTeams,
  sameTeam,
  setTeamCommission,
  setTeamLead,
  teamCommission,
  teamLeadOf,
  teamLeads,
  teamMember,
  teamMembers,
} from './teams';
import QRCode from 'qrcode';
import { publicAsset, publicText, serviceWorker } from './static';
import { announcePayoutRequest, announceRewardRequest, commissionEvents, emailLoginLink, finishPayout, finishReward, promoterData } from './actions';
import { iconUrl } from './icons';
import { isTokenPath, mountApi, purgeApiLimits, takeOAuthReturn } from './api';
import { createKey, KEY_DAYS, MAX_KEYS, type KeyDays, purgeApiTokens, revokeAllTokens, revokeToken, tokensFor } from './api-tokens';
import { ApiPage } from './api-views';
import { vendorAsset } from './vendor';
import { tidyCity } from './places';
import {
  codeOwners,
  codesFor,
  usualRuleFor,
  type UsualCommission,
  countAdmins,
  createUser,
  deleteUser,
  findUser,
  findUserByEmail,
  listUsers,
  normalizeCodes,
  setCodes,
  db,
  markAppInstalled,
  markOnboarded,
  setPassword,
  updateProfile,
  updateUser,
  type User,
} from './local-db';
import {
  AccountPage,
  AdminPage,
  AdminPagesPage,
  AdminBrandingPage,
  AdminEmailEditPage,
  AdminEmailsPage,
  AdminLinksPage,
  AdminDashboardPage,
  AdminTeamsPage,
  AdminCodesPage,
  AdminCommissionsPage,
  AdminMediaPage,
  InvitesPage,
  JoinPage,
  TeamPage,
  ReadOnlyPage,
  AdminRewardsPage,
  AdminPayoutsPage,
  ApproveDevicePage,
  NotificationsPage,
  SecurityPage,
  TwoFactorPage,
  WelcomePage,
  css,
  LoginConfirmPage,
  LoginPage,
  PromoterPage,
} from './views';

const MIN_PASSWORD = 10;
const LINK_RESPONSE_MS = 300;

// Flash messages travel as short keys in the query string so links cannot inject arbitrary text.
const messages: Record<string, string> = {
  created: 'Promoter created.',
  invited: 'Promoter created and a sign-in link was emailed to them.',
  link_sent: 'Sign-in link emailed.',
  mail_failed: 'Saved, but the email could not be sent. Check the SMTP settings and the container log.',
  commission: 'Commission must be a percentage from 0 to 100, or an amount per ticket like 2 or 2.50.',
  saved: 'Saved.',
  password: 'Password updated.',
  deleted: 'Promoter deleted.',
  short: `Passwords need at least ${MIN_PASSWORD} characters.`,
  exists: 'Another account already uses that email.',
  wrong: 'Current password is incorrect.',
  last_admin: 'You cannot remove the last admin.',
  missing: 'Name and email are required.',
  requested: 'Payout requested. The team has been notified and you will get an email once it is paid.',
  invalid_amount: 'Enter an amount like 25 or 25.50.',
  too_much: 'That is more than your available balance.',
  already_pending: 'You already have a request waiting for this currency.',
  missing_method: 'Choose how we should pay you.',
  cash_step: `Cash is paid in steps of $${config.cashStepCents / 100}: choose $${config.cashStepCents / 100}, $${(config.cashStepCents * 2) / 100} and so on.`,
  payout_paid: 'Marked as paid. The promoter has been emailed.',
  payout_rejected: 'Request declined. The promoter has been emailed and the amount is available to them again.',
  payout_gone: 'That request was already handled.',
  bad_color: 'Pick a colour with the colour picker.',
  bad_email: 'That is not a valid email address.',
  adjusted: 'Change added.',
  undone: 'Change undone.',
  adjust_reason: 'Give a reason: the promoter sees it.',
  adjust_amount: 'Enter an amount like 50 or -12.50, and whole numbers for tickets and merch (not 0).',
  adjust_event: 'Pick one of their upcoming events.',
  code_wrong: 'That code did not work. Use the newest 6-digit code from your authenticator app.',
  device_out: 'That device is signed out.',
  others_out: 'All your other devices are signed out.',
  '2fa_off': 'Two-step verification is off.',
  '2fa_reset': 'Two-step verification was reset. They can sign in with just the link and turn it on again.',
  alias_invalid: 'The alias needs 2 to 30 letters, numbers, - or _, starting with a letter or number.',
  alias_taken: 'Another promoter already uses that alias.',
  bad_url: 'Enter the full address, starting with https://',
  rewards_saved: 'Levels and rewards saved. Promoters see them right away.',
  rewards_reset: 'Back to the default levels and rewards.',
  domain_saved: 'Short link domain saved. Promoters get links on it from their next visit.',
  bad_domain: 'Pick one of the domains of the Kutt account.',
  kutt_unreachable: 'Kutt did not answer, so the domain could not be checked. Try again in a few minutes.',
  reset: 'Back to the default wording.',
  test_sent: 'Saved, and a test was sent to your email address.',
  test_failed: 'Saved, but the test could not be sent. The list of recent emails shows why.',
  photo_size: `The photo must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or less.`,
  photo_type: 'The photo must be a PNG, JPEG or WebP image.',
  photo_missing: 'Choose a photo, or skip this step for now.',
  logo_size: `The logo must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or less.`,
  logo_type: 'The logo must be a PNG, JPEG or WebP image.',
  logo_pixels: `The logo must be at most ${maxImageSide} pixels on each side.`,
  photo_pixels: `The photo must be at most ${maxImageSide} pixels on each side (50 megapixels in all).`,
  photo_rate: 'Too many photos uploaded in the last hour. Try again later.',
  photo_set: 'Photo saved. They were told the team changed it.',
  photo_removed: 'Photo removed. Their Instagram photo or initials show instead.',
  reward_requested: 'Reward requested. The team has been notified.',
  not_available: 'That reward is not available any more.',
  missing_details: 'Tell us which item and size you would like.',
  reward_fulfilled: 'Marked as given. The promoter has been emailed.',
  reward_rejected: 'Reward request declined. The promoter has been emailed and can request it again.',
  page_hidden: 'Your page is hidden.',
  page_shown: 'Your page is back.',
  page_saved: 'Saved. The page shows or hides right away.',
  short_renamed: 'Kutt link changed. The old address no longer works.',
  short_taken: 'That address is already used in Kutt. Pick another.',
  short_invalid: 'Use letters, numbers, - or _ (64 at most), starting with a letter or number.',
  short_refused: 'Kutt refused that address (some words are reserved). Pick another.',
  short_unavailable: 'Kutt did not answer. Try again in a few minutes.',
  team_saved: 'Team saved.',
  team_commission: 'Team commission saved. It applies to all their team sales so far and from now on.',
  team_lead_on: 'They are a team lead now and have been told. Add promoters to their team below.',
  team_lead_off: 'They are no longer a team lead. Their promoters have no team now.',
  team_admin: 'Admins see every team and cannot be on one.',
  team_is_lead: 'A team lead cannot be on another team.',
  team_not_lead: 'Pick one of the team leads.',
  team_self: 'A promoter cannot be on their own team.',
  team_pick: 'Choose a promoter.',
  impersonate_admin: 'Admins cannot be viewed as.',
  invite_created: 'Invite link created. Copy it below and share it.',
  invite_off: 'Invite link turned off. It no longer works.',
  invite_on: 'Invite link turned back on.',
  invite_label: 'Give the link a name.',
  invite_days: 'Pick how long the link works.',
  invite_max: 'Sign-ups must be a whole number from 1 to 1000, or empty.',
  rate_saved: 'Commission saved. It applies to all their sales for this event, earlier ones too.',
  rate_event: 'Pick one of the promoters on an event that is not over.',
  rate_percent: 'The percentage must be a number between 0 and 100.',
  rate_flat: 'The amount per ticket must be like 2 or 2.50.',
  media_saved: 'Media drive saved. Promoters on this event now see it.',
  media_removed: 'Media drive removed.',
  media_url: 'The media drive must be a link starting with https://.',
  media_event: 'Pick one of the events listed: drafts and events that are not over.',
  api_removed: 'Removed. It stops working right away.',
  api_removed_all: 'Their API keys and connected apps are removed and stop working right away.',
  api_too_many: `You can have up to ${MAX_KEYS} keys. Remove one to make another.`,
};
// Own keys only: ?ok=constructor must not pick up something from Object.prototype.
const flash = (key?: string) => (key && Object.hasOwn(messages, key) ? messages[key] : undefined);

// A promoter's usual commission from their form: the default, a percentage, or a flat amount per ticket.
function parseUsualCommission(body: Record<string, unknown>): UsualCommission | 'invalid' {
  const kind = String(body.commission_kind ?? 'default');
  if (kind === 'default') return { percent: null, flatCents: null };
  const raw = String(body.commission_value ?? '').trim().replace(',', '.');
  const value = /^[0-9]+(\.[0-9]{1,2})?$/.test(raw) ? Number(raw) : NaN;
  if (kind === 'percent') return value <= 100 ? { percent: value, flatCents: null } : 'invalid';
  if (kind === 'flat') return value <= 10_000 ? { percent: null, flatCents: Math.round(value * 100) } : 'invalid';
  return 'invalid';
}

// The team lead's team commission: '' means none, anything else must be a percentage.
function parseCommission(raw: unknown): number | null | 'invalid' {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 'invalid';
}

const app = new Hono<Env>();

// Browser features the app never uses are turned off (clipboard and share stay on for event links).
const permissionsPolicy = { camera: false, microphone: false, geolocation: false, payment: false, usb: false };
const strictHeaders = secureHeaders({
    // The pages use no scripts and no inline styles, so nothing else is allowed to load or run.
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      styleSrc: ["'self'"],
      // Photos and the logo may come from the CDN in front of the S3 bucket (CDN_URL); map tiles from
      // OpenStreetMap (the promoter maps on the admin dashboard and team pages).
      imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', ...(cdnOrigin ? [cdnOrigin] : [])],
      formAction: ["'self'"],
      // Only the admin email preview is framed, and only by this site.
      frameSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
    xFrameOptions: 'DENY',
    permissionsPolicy,
  });
// Email HTML relies on inline styles, so its preview gets its own policy: still no scripts, framed only here.
const previewHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    styleSrc: ["'unsafe-inline'"],
    // The only image is the logo, served by the app itself or its CDN.
    imgSrc: ["'self'", 'data:', ...(cdnOrigin ? [cdnOrigin] : [])],
    formAction: ["'none'"],
    frameAncestors: ["'self'"],
    baseUri: ["'none'"],
  },
  xFrameOptions: 'SAMEORIGIN',
  permissionsPolicy,
});
app.use((c, next) => (/^\/admin\/emails\/[a-z_]+\/preview$/.test(c.req.path) ? previewHeaders(c, next) : strictHeaders(c, next)));
// The API, MCP server and OAuth token endpoints take a key in a header, never the cookie (see api.tsx).
const csrfCheck = csrf({ origin: config.appUrl });
app.use((c, next) => (isTokenPath(c.req.path) ? next() : csrfCheck(c, next)));
// hono/csrf only checks form content types. JSON and other POSTs (/push/*, /login/wait,
// /account/app-installed) get the same check here, so no state change relies on CORS alone.
app.use(async (c, next) => {
  if (!/^(GET|HEAD|OPTIONS)$/.test(c.req.method) && !isTokenPath(c.req.path) && c.req.header('origin') !== config.appUrl && c.req.header('sec-fetch-site') !== 'same-origin') {
    return c.text('Forbidden', 403);
  }
  await next();
});
// An admin viewing as a promoter only looks: nothing can be sent in their name (payouts, rewards,
// profile, security, approving a device), only stopping or signing out.
app.use(async (c, next) => {
  if (/^(GET|HEAD|OPTIONS)$/.test(c.req.method) || c.req.path === '/impersonate/stop' || c.req.path === '/logout') return next();
  const viewer = currentUser(c);
  if (viewer?.impersonator) {
    audit(c, 'admin.impersonation_blocked', { by: viewer.impersonator.id, userId: viewer.id, path: c.req.path });
    return c.html(<ReadOnlyPage user={viewer} />, 403);
  }
  await next();
});
// Pages carry personal sales data: never keep them in the browser cache (shared computers, Back after
// signing out, offline). Static files set their own caching.
app.use(async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});
// A body over the limit is answered before it is read, so the connection is closed: the rest of the
// upload would otherwise be read as the next request on it, which then hangs.
const refuse = (c: Context, res: () => Response) => {
  c.header('Connection', 'close');
  return res();
};
// Every form here is a few short fields; only the branding, account and welcome photo forms carry a file.
const smallBodies = bodyLimit({ maxSize: 32 * 1024, onError: (c) => refuse(c, () => c.text('Request too large', 413)) });
// Room above the logo and photo limits so an oversized file gets a clear message from the handler;
// a file far too big is sent back to its own form.
function tooBig(path: string): string | null {
  if (path === '/admin/branding') return '/admin/branding?error=logo_size';
  if (path === '/account/profile') return '/account?error=photo_size';
  if (path === '/welcome/photo') return '/welcome?step=3&error=photo_size';
  const promoter = path.match(/^\/admin\/promoters\/(\d+)\/photo$/);
  return promoter ? `/admin/promoters/${promoter[1]}?error=photo_size#photo` : null;
}
// One file of up to maxUploadBytes, plus the form's other fields.
const fileBodies = bodyLimit({ maxSize: maxUploadBytes + 1024 * 1024, onError: (c) => refuse(c, () => c.redirect(tooBig(c.req.path)!)) });
app.use((c, next) => (tooBig(c.req.path) ? fileBodies(c, next) : smallBodies(c, next)));
mountApi(app);
const photoError: Record<ImageProblem, string> = { too_big: 'photo_size', bad_type: 'photo_type', too_many_pixels: 'photo_pixels' };

app.get('/healthz', (c) => c.text('ok'));

app.get('/app.css', (c) => {
  c.header('Content-Type', 'text/css; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(css);
});

app.get('/app.js', (c) => publicAsset(c, 'app.js'));
app.get('/map.js', (c) => publicAsset(c, 'map.js'));
app.get('/places.json', (c) => publicAsset(c, 'places.json'));
app.get('/vendor/:file', (c) => vendorAsset(c, c.req.param('file')));
// The installed app takes its name and colour from the branding.
app.get('/manifest.webmanifest', (c) => {
  const brand = getBrand();
  const manifest = JSON.parse(publicText('manifest.webmanifest'));
  c.header('Content-Type', 'application/manifest+json');
  c.header('Cache-Control', 'no-cache');
  // Icons by their versioned address: a new icon is then seen as a change, and installed apps take it.
  const icons = manifest.icons.map((icon: { src: string }) => ({ ...icon, src: iconUrl(icon.src.slice(1)) }));
  return c.body(JSON.stringify({ ...manifest, icons, name: brand.name, short_name: brand.name.slice(0, 12), theme_color: brand.accent }));
});
app.get('/brand.css', (c) => {
  c.header('Content-Type', 'text/css; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(brandCss());
});
// Sends a stored file (src/storage.ts), or sends the browser to its CDN copy; the cache time applies to either.
function sendStored(c: Context, file: Delivery | null, cache: string) {
  if (!file) return c.notFound();
  c.header('Cache-Control', cache);
  if ('redirect' in file) return c.redirect(file.redirect, 302);
  c.header('Content-Type', file.type);
  return c.body(new Uint8Array(file.bytes));
}

app.get('/brand/logo', async (c) => sendStored(c, await deliverLogo(), 'public, max-age=31536000, immutable'));
app.get('/icon.svg', (c) => publicAsset(c, 'icon.svg'));
app.get('/:icon{icon-[a-z0-9-]+\\.png}', (c) => publicAsset(c, c.req.param('icon')));
app.get('/badge-96.png', (c) => publicAsset(c, 'badge-96.png'));
app.get('/sw.js', (c) => serviceWorker(c));
app.get('/offline', (c) =>
  c.html(
    <LoginPage error="You are offline. Your numbers will show again as soon as you are back online." offline />,
  ),
);

// --- Promoters' public pages: no sign-in, and nothing about sales ----------------------------------

// Every promoter's page, with its link: the Kutt domain's homepage can point here.
app.get('/p', async (c) => {
  const promoters = listedPages();
  // At most a second for Kutt in all; a page without a short link yet shows its own address.
  await Promise.race([Promise.all(promoters.map((u) => prepareShortLinks(u, [], { waitMs: 1000, page: true }))), Bun.sleep(1000)]);
  c.header('Cache-Control', 'public, max-age=60');
  return c.html(<PromoterDirectoryPage promoters={promoters.map((u) => ({ user: u, link: pageShortLink(u) ?? pageLink(u)! }))} />);
});

app.get('/p/:alias', async (c) => {
  const alias = c.req.param('alias');
  if (alias !== alias.toLowerCase()) return c.redirect(`/p/${encodeURIComponent(alias.toLowerCase())}`, 301);
  const owner = pageOwner(alias);
  if (!owner) return c.html(<PageMissing />, 404);
  const events = await pageEvents(owner);
  // A visitor waits at most a second for Kutt; without a short link yet, the long one is used.
  await prepareShortLinks(owner, events.map((e) => ({ event: { id: e.event_id, title: e.title }, code: e.code })), { waitMs: 1000, page: true });
  // The same for everyone (no cookies are read or set here), so it can be kept briefly.
  c.header('Cache-Control', 'public, max-age=60');
  return c.html(<PromoterPublicPage owner={owner} events={events} shareUrl={pageShortLink(owner) ?? pageLink(owner)!} />);
});

app.get('/p/:alias/avatar', async (c) => {
  const owner = pageOwner(c.req.param('alias'));
  return sendStored(c, owner ? await deliverAvatar(owner.id) : null, 'public, max-age=3600');
});

// Only the covers of the events the page lists.
app.get('/p/:alias/cover/:eventId', async (c) => {
  const owner = pageOwner(c.req.param('alias'));
  const eventId = Number(c.req.param('eventId'));
  if (!owner || !Number.isInteger(eventId) || !(await pageEvents(owner)).some((e) => e.event_id === eventId && e.has_cover)) return c.notFound();
  const cover = await eventCover(eventId);
  if (!cover) return c.notFound();
  c.header('Content-Type', cover.type);
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(new Uint8Array(cover.bytes));
});

app.get('/page.js', (c) => publicAsset(c, 'page.js'));

// --- Joining with an invite link (public) --------------------------------------------------------------

/** An invite link that can still be used: open, and made by a team lead who still is one. */
function openInvite(token: string) {
  const invite = inviteByToken(token);
  if (!invite) return { invite: null, lead: null };
  const lead = inviteTeamLead(invite);
  // A team lead's own link stops when they are no longer a team lead.
  const closed = inviteState(invite) !== 'open' || (invite.team_lead_id !== null && !lead && invite.created_by === invite.team_lead_id);
  return { invite, lead, closed };
}

app.get('/join/:token', (c) => {
  const { invite, lead, closed } = openInvite(c.req.param('token'));
  if (!invite) return c.html(<JoinPage invite={null} />, 404);
  if (closed) return c.html(<JoinPage invite={{ ...invite, disabled_at: invite.disabled_at ?? 1 }} />, 410);
  return c.html(<JoinPage invite={invite} team={lead?.name} signedIn={!!currentUser(c)} />);
});

const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

app.post('/join/:token', async (c) => {
  const { invite, lead, closed } = openInvite(c.req.param('token'));
  if (!invite) return c.html(<JoinPage invite={null} />, 404);
  if (closed) return c.html(<JoinPage invite={{ ...invite, disabled_at: invite.disabled_at ?? 1 }} />, 410);
  const body = await c.req.parseBody();
  const values = {
    first_name: String(body.first_name ?? '').trim().slice(0, 60),
    last_name: String(body.last_name ?? '').trim().slice(0, 60),
    email: String(body.email ?? '').trim().slice(0, 254),
  };
  const again = (error: string, status: 400 | 429) => c.html(<JoinPage invite={invite} team={lead?.name} values={values} error={error} />, status);
  if (!values.first_name || !values.last_name) return again('Enter your first and last name.', 400);
  if (!emailPattern.test(values.email)) return again('That is not a valid email address.', 400);
  if (!allowSignup(invite.id)) return again('Too many people joined with this link in the last hour. Try again later.', 429);

  const started = Date.now();
  const waiting = { id: startWaiting(c), from: summarizeDevice(c.req.header('user-agent')) };
  const existing = findUserByEmail(values.email);
  if (existing) {
    // Already a promoter: a sign-in link, and the same answer as a new sign-up, so the page does not tell
    // who has an account.
    if (allowLinkRequest(values.email)) setTimeout(() => void emailLoginLink(existing, 'login', waiting), 0);
    audit(c, 'invite.existing_account', { inviteId: invite.id, userId: existing.id });
  } else {
    if (!useInvite(invite.id)) return c.html(<JoinPage invite={{ ...invite, disabled_at: 1 }} />, 410);
    const name = `${values.first_name} ${values.last_name}`;
    let id: number;
    try {
      id = await createUser({ name, email: values.email, isAdmin: false });
    } catch {
      // The same email sent twice at once: the first one made the account.
      await Bun.sleep(Math.max(0, LINK_RESPONSE_MS - (Date.now() - started)));
      return c.html(<LoginPage sent email={values.email} />);
    }
    db.query('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?').run(values.first_name, values.last_name, id);
    setAlias(id, suggestAlias(name, id));
    markJoined(id, invite.id);
    const user = findUser(id)!;
    if (lead) assignTeam(user, lead.id);
    audit(c, 'invite.joined', { inviteId: invite.id, userId: id, teamLeadId: lead?.id ?? null });
    const message = {
      title: 'New promoter joined',
      body: `${name} (${values.email}) joined with the invite link "${invite.label}"${lead ? ` on ${lead.name}'s team` : ''}. Give them their promo codes.`,
      link: `/admin/promoters/${id}`,
    };
    notify('admins', message);
    if (lead) notify(lead.id, { title: 'New promoter on your team', body: `${name} joined your team with your invite link "${invite.label}".`, link: '/team' });
    setTimeout(() => void emailLoginLink(findUser(id)!, 'invite', waiting), 0);
  }
  await Bun.sleep(Math.max(0, LINK_RESPONSE_MS - (Date.now() - started)));
  return c.html(<LoginPage sent email={values.email} />);
});

app.get('/login', (c) => c.html(<LoginPage withPassword={c.req.query('method') === 'password'} />));

app.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? '');
  const result = await verifyLogin(email, String(body.password ?? ''));
  if (result === 'locked') {
    audit(c, 'login.locked', { email });
    return c.html(<LoginPage withPassword email={email} error="Too many attempts. Try again in 15 minutes." />, 429);
  }
  if (!result) {
    audit(c, 'login.failed', { email });
    return c.html(<LoginPage withPassword email={email} error="Wrong email or password." />, 401);
  }
  audit(c, 'login.password', { userId: result.id });
  return c.redirect(signIn(c, result.id) ? '/' : '/login/2fa');
});

/**
 * Finishes the first step of signing in. With two-step verification on, the browser gets a
 * short-lived ticket for the code page instead of a session. Returns true when signed in.
 */
function signIn(c: Context, userId: number, approveRow?: number): boolean {
  const user = findUser(userId);
  if (user && hasTwoFactor(user)) {
    startPendingSignIn(c, userId, approveRow);
    return false;
  }
  startSession(c, userId);
  return true;
}

// The device approval question, rebuilt from the sign-in link that asked for it.
function approvalFor(rowId: number) {
  const row = db
    .query<{ requested_from: string | null; created_at: number | null }, [number]>('SELECT requested_from, created_at FROM login_tokens WHERE rowid = ?')
    .get(rowId);
  return row ? { rowId, from: row.requested_from, at: row.created_at ?? Math.floor(Date.now() / 1000) } : null;
}

// Always answers the same way so the form does not reveal which emails have accounts.
app.post('/login/link', async (c) => {
  const email = String((await c.req.parseBody()).email ?? '').trim();
  const user = email ? findUserByEmail(email) : null;
  const started = Date.now();
  // Every answer gets a wait cookie, for known and unknown emails alike.
  const waiting = { id: startWaiting(c), from: summarizeDevice(c.req.header('user-agent')) };
  if (user) {
    const allowed = allowLinkRequest(email);
    audit(c, allowed ? 'link.requested' : 'link.rate_limited', { userId: user.id });
    // Sent after the response, so waiting on SMTP cannot make known emails answer slower.
    if (allowed) setTimeout(() => void emailLoginLink(user, 'login', waiting), 0);
  }
  // Pad every answer to the same duration so timing does not reveal which emails have accounts.
  await Bun.sleep(Math.max(0, LINK_RESPONSE_MS - (Date.now() - started)));
  return c.html(<LoginPage sent email={email} />);
});

app.get('/login/verify', (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login');
  return c.html(<LoginConfirmPage token={token} />);
});

app.post('/login/verify', async (c) => {
  const link = consumeLoginToken(String((await c.req.parseBody()).token ?? ''), c);
  if (!link) {
    audit(c, 'link.invalid');
    return c.html(<LoginPage error="This link has expired or was already used. Enter your email to get a new one." />, 400);
  }
  audit(c, 'login.link', { userId: link.userId });
  if (!signIn(c, link.userId, link.waitingElsewhere?.rowId)) return c.redirect('/login/2fa');
  // Another browser or the installed app asked for this link: offer to sign it in too.
  if (link.waitingElsewhere) return c.html(<ApproveDevicePage request={link.waitingElsewhere} />);
  return c.redirect('/');
});

app.post('/login/approve', async (c) => {
  const user = currentUser(c);
  if (!user) return c.redirect('/login');
  const body = await c.req.parseBody();
  if (body.answer !== 'yes') return c.redirect('/');
  const approved = approveWaiting(Number(body.request), user.id);
  audit(c, approved ? 'login.device_approved' : 'login.device_approve_failed', { userId: user.id });
  return c.html(<ApproveDevicePage done={approved} />);
});

// Polled by the "check your email" page until the link is opened somewhere.
app.post('/login/wait', (c) => {
  if (currentUser(c)) return c.json({ signedIn: true });
  const userId = exchangeWaiting(c);
  if (!userId) return c.json({ signedIn: false });
  audit(c, 'login.waiting_device', { userId });
  // The waiting device proves the second step itself: approving it elsewhere is not enough.
  if (!signIn(c, userId)) return c.json({ signedIn: false, twoFactor: true });
  return c.json({ signedIn: true });
});

// For the installed app: a tapped email link opens the browser, so the email also carries a code.
app.post('/login/code', async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? '').trim();
  const userId = consumeLoginCode(email, String(body.code ?? '').trim());
  if (!userId) {
    audit(c, 'code.invalid', { email });
    return c.html(<LoginPage sent email={email} error="That code is wrong or has expired." />, 400);
  }
  audit(c, 'login.code', { userId });
  return c.redirect(signIn(c, userId) ? '/' : '/login/2fa');
});

app.get('/login/2fa', (c) => {
  if (!pendingSignIn(c)) return c.redirect('/login');
  return c.html(<TwoFactorPage />);
});

app.post('/login/2fa', async (c) => {
  const pending = pendingSignIn(c);
  if (!pending) return c.redirect('/login');
  const user = findUser(pending.userId);
  if (!user) return c.redirect('/login');
  const result = verifySecondFactor(user, String((await c.req.parseBody()).code ?? ''));
  if (!result) {
    audit(c, 'login.2fa_failed', { userId: user.id });
    if (!failPendingSignIn(pending)) {
      return c.html(<LoginPage error="Too many wrong codes. Sign in again from the start." />, 429);
    }
    return c.html(<TwoFactorPage error="That code did not work. Check the time on your phone and try the newest code." />, 400);
  }
  finishPendingSignIn(c, pending);
  startSession(c, user.id);
  audit(c, `login.2fa_${result}`, { userId: user.id });
  if (result === 'recovery') {
    notify(user.id, {
      title: 'A recovery code was used',
      body: `${recoveryCodesLeft(user.id)} recovery codes left. Make new ones under Security if you are running low.`,
      link: '/account/security',
    });
  }
  const approval = pending.approveRow ? approvalFor(pending.approveRow) : null;
  if (approval) return c.html(<ApproveDevicePage request={approval} />);
  return c.redirect('/');
});

app.post('/logout', (c) => {
  endSession(c);
  return c.redirect('/login');
});

app.use('/', requireUser);
app.use('/events/*', requireUser);
app.use('/payouts', requireUser);
app.use('/rewards/*', requireUser);
app.use('/event-image/*', requireUser);
app.use('/notifications', requireUser);
app.use('/notifications/*', requireUser);
app.use('/push/*', requireUser);
app.use('/avatar/*', requireUser);
app.use('/welcome', requireUser);
app.use('/welcome/*', requireUser);
app.use('/account/*', requireUser);
app.use('/account', requireUser);
app.use('/page', requireUser);
app.use('/page/*', requireUser);
// /team itself is for team leads and the promoters on their teams (checked in the route); the pages
// below it are for team leads alone. Hono's /team/* also matches /team.
app.use('/team/*', requireUser, (c, next) => (c.req.path === '/team' ? next() : requireTeamLead(c, next)));
app.use('/admin/*', requireUser, requireAdmin);
app.use('/admin', requireUser, requireAdmin);

async function renderDashboard(c: Context<Env>, promoter: User, basePath: string) {
  const data = await promoterData(promoter);
  // Also checked on a timer; checking here makes a new milestone show up the moment they look.
  if (basePath === '') checkMilestones(promoter, data.rewards);
  // Upcoming event cards carry a link with the first code; the promoter's own view also shows their page.
  const upcoming = summarizeEvents(data.rows, data.percent).filter((e) => !e.end || e.end.getTime() >= Date.now());
  const withPage = basePath === '' && !promoter.page_hidden_at;
  await prepareShortLinks(promoter, upcoming.map((e) => ({ event: { id: e.id, title: e.title }, code: e.codes[0]! })), { page: withPage });
  return c.html(
    <DashboardPage
      viewer={c.get('user')}
      promoter={promoter}
      basePath={basePath}
      codes={data.codes}
      rows={data.rows}
      daily={await dailyForCodes(data.codes)}
      balances={data.balances}
      rewards={data.rewards}
      percent={data.percent}
      media={data.media}
      range={parseRange(c.req.query('range'), '30')}
      pageLink={withPage ? (pageShortLink(promoter) ?? pageLink(promoter)) : null}
    />,
  );
}

async function renderEvent(c: Context<Env>, promoter: User, basePath: string) {
  const eventId = Number(c.req.param('eventId'));
  const data = await promoterData(promoter);
  // Only events that have one of this promoter's codes exist for them.
  if (!Number.isInteger(eventId) || !data.rows.some((r) => r.event_id === eventId)) return c.notFound();
  const event = summarizeEvents(data.rows, data.percent).find((e) => e.id === eventId)!;
  await prepareShortLinks(promoter, event.codes.map((code) => ({ event: { id: event.id, title: event.title }, code })));
  return c.html(
    <EventPage
      viewer={c.get('user')}
      promoter={promoter}
      basePath={basePath}
      rows={data.rows}
      eventId={eventId}
      daily={await dailyForCodes(data.codes, eventId)}
      rewards={data.rewards}
      percent={data.percent}
      media={data.media.get(eventId) ?? null}
      range={parseRange(c.req.query('range'), 'all')}
    />,
  );
}

app.get('/', async (c) => {
  const user = c.get('user');
  // Signed in on the way to connecting an app: back to approving it.
  const connecting = takeOAuthReturn(c);
  if (connecting) return c.redirect(connecting);
  // Admins land on the admin dashboard; their own sales, if any, are on their promoter page there.
  if (user.is_admin) return c.redirect('/admin/dashboard');
  // First sign-in: a few welcome steps before the dashboard.
  if (!user.is_admin && !user.onboarded_at) return c.redirect('/welcome');
  return renderDashboard(c, user, '');
});

app.get('/events/:eventId', (c) => renderEvent(c, c.get('user'), ''));

app.get('/welcome', (c) => {
  const user = c.get('user');
  const step = Math.min(4, Math.max(1, Number(c.req.query('step') ?? 1) || 1));
  return c.html(
    <WelcomePage
      user={user}
      step={step}
      codes={codesFor(user.id)}
      pushKey={pushPublicKey}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.post('/welcome/profile', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const text = (key: string, max: number) => String(body[key] ?? '').trim().slice(0, max) || null;
  const method = String(body.payout_method ?? '');
  updateProfile(user.id, {
    first_name: text('first_name', 60),
    last_name: text('last_name', 60),
    phone: text('phone', 30),
    city: tidyCity(text('city', 80)),
    instagram: text('instagram', 60)?.replace(/^@?/, '@') ?? null,
    payout_method: config.payoutMethods.includes(method) ? method : null,
    payout_details: text('payout_details', 200),
    theme: user.theme ?? 'system',
  });
  audit(c, 'account.profile_updated', { userId: user.id, during: 'welcome' });
  // The next step is the photo: give Instagram a few seconds so theirs is already there.
  const updated = findUser(user.id)!;
  if (updated.instagram) await Promise.race([refreshInstagramAvatar(updated).catch(() => {}), Bun.sleep(5000)]);
  return c.redirect('/welcome?step=3');
});

app.post('/welcome/photo', async (c) => {
  const user = c.get('user');
  const photo = (await c.req.parseBody()).photo;
  if (photo instanceof File && photo.size > 0) {
    if (!allowImageUpload(user.id)) return c.redirect('/welcome?step=3&error=photo_rate');
    const result = await saveUploadedAvatar(user.id, new Uint8Array(await photo.arrayBuffer()));
    if (result !== 'ok') return c.redirect(`/welcome?step=3&error=${photoError[result]}`);
    audit(c, 'account.photo_uploaded', { userId: user.id, during: 'welcome' });
  } else if (!avatarOf(user)) {
    return c.redirect('/welcome?step=3&error=photo_missing');
  }
  return c.redirect('/welcome?step=4');
});

app.post('/welcome/done', (c) => {
  markOnboarded(c.get('user').id);
  audit(c, 'account.onboarded', { userId: c.get('user').id });
  return c.redirect('/');
});

// Opening the list marks everything as read.
app.get('/notifications', (c) => {
  const user = c.get('user');
  const test = c.req.query('test');
  const failed = test === 'none' || test === 'failed' || test === 'soon';
  const page = c.html(
    <NotificationsPage
      user={user}
      notifications={notificationsFor(user.id)}
      pushKey={pushPublicKey}
      devices={pushDeviceCount(user.id)}
      prefs={user.is_admin ? prefsFor(user.id) : undefined}
      ok={failed ? undefined : testMessage(test)}
      error={failed ? testMessage(test) : undefined}
    />,
  );
  // Reading them as an admin leaves them unread for the promoter.
  if (!user.impersonator) markAllRead(user.id);
  return page;
});

function testMessage(key?: string): string | undefined {
  if (!key) return undefined;
  if (key === 'none') return 'Sent to the list below, but no device has phone notifications turned on yet. Tap Turn on first.';
  if (key === 'failed') return 'The push service did not accept it. Turn notifications off and on again on that device.';
  if (key === 'soon') return 'Wait a few seconds before sending another test.';
  if (key === 'settings') return 'Saved. Your alerts follow these settings from now on.';
  const [delivered, devices] = key.split('-').map(Number);
  if (!Number.isInteger(delivered) || !Number.isInteger(devices)) return undefined;
  return delivered === devices
    ? `Sent to ${devices === 1 ? 'your device' : `all ${devices} of your devices`}. It should appear in a few seconds.`
    : `Sent to ${delivered} of your ${devices} devices; the others did not accept it.`;
}

app.post('/notifications/settings', async (c) => {
  const user = c.get('user');
  if (!user.is_admin) return c.text('Forbidden', 403);
  const body = await c.req.parseBody();
  const prefs = Object.fromEntries(alerts.map((a) => [a.key, { email: body[`${a.key}:email`] === '1', app: body[`${a.key}:app`] === '1' }])) as Prefs;
  savePrefs(user.id, prefs);
  audit(c, 'admin.alert_settings', { by: user.id, prefs });
  return c.redirect('/notifications?test=settings');
});

app.post('/notifications/test', async (c) => {
  const user = c.get('user');
  const result = await sendTestNotification(user.id);
  audit(c, 'push.test', { userId: user.id, result });
  if (result === 'too_soon') return c.redirect('/notifications?test=soon');
  if (result.devices === 0) return c.redirect('/notifications?test=none');
  if (result.delivered === 0) return c.redirect('/notifications?test=failed');
  return c.redirect(`/notifications?test=${result.delivered}-${result.devices}`);
});

app.post('/push/subscribe', async (c) => {
  const body = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>().catch(() => null);
  const endpoint = String(body?.endpoint ?? '');
  const p256dh = String(body?.keys?.p256dh ?? '');
  const auth = String(body?.keys?.auth ?? '');
  if (!isPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}$/.test(auth) || !isPushKeys(p256dh, auth)) {
    return c.json({ ok: false }, 400);
  }
  savePushSubscription(c.get('user').id, { endpoint, p256dh, auth });
  audit(c, 'push.subscribed', { userId: c.get('user').id, host: new URL(endpoint).hostname });
  return c.json({ ok: true });
});

app.post('/push/unsubscribe', async (c) => {
  const body = await c.req.json<{ endpoint?: string }>().catch(() => null);
  removePushSubscription(c.get('user').id, String(body?.endpoint ?? ''));
  return c.json({ ok: true });
});

// Event covers from Hi.Events' storage, passed through so they load on any device and under the CSP.
app.get('/event-image/:eventId', async (c) => {
  const cover = Number.isInteger(Number(c.req.param('eventId'))) ? await eventCover(Number(c.req.param('eventId'))) : null;
  c.header('Content-Type', cover?.type ?? 'image/png');
  c.header('Cache-Control', cover ? 'private, max-age=3600' : 'private, max-age=300');
  return c.body(new Uint8Array(cover ? cover.bytes : blankPng));
});

// --- The promoter's own page settings ---------------------------------------------------------------

app.get('/page', async (c) => {
  const user = c.get('user');
  const events = user.page_hidden_at ? [] : await pageEvents(user);
  if (!user.page_hidden_at) {
    await prepareShortLinks(user, events.map((e) => ({ event: { id: e.event_id, title: e.title }, code: e.code })), { page: true });
  }
  return c.html(
    <MyPagePage user={user} events={events} shortLink={pageShortLink(user)} clicks={pageClicks(user)} kutt={kuttEnabled()} ok={flash(c.req.query('ok'))} />,
  );
});

// The QR code leads to the short link when there is one, so Kutt counts the scans too.
app.get('/page/qr.png', async (c) => {
  const user = c.get('user');
  const link = pageShortLink(user) ?? pageLink(user);
  if (!link) return c.notFound();
  const png = await QRCode.toBuffer(link, { type: 'png', width: 1024, margin: 2, errorCorrectionLevel: 'M' });
  c.header('Content-Type', 'image/png');
  c.header('Cache-Control', 'private, no-cache');
  return c.body(new Uint8Array(png));
});

app.post('/page/visibility', async (c) => {
  const user = c.get('user');
  const hidden = (await c.req.parseBody()).hidden === '1';
  // A page the team hid stays hidden until an admin shows it again.
  if (hiddenByTeam(user)) return c.redirect('/page');
  setPageHidden(user.id, hidden);
  audit(c, hidden ? 'page.hidden' : 'page.shown', { userId: user.id });
  return c.redirect(`/page?ok=${hidden ? 'page_hidden' : 'page_shown'}`);
});

async function renderPayouts(c: Context<Env>, error?: string) {
  const user = c.get('user');
  const data = await promoterData(user);
  return c.html(
    <PayoutsPage
      user={user}
      balances={data.balances}
      payouts={payoutsFor(user.id)}
      rewards={data.rewards}
      rewardRequests={rewardRequestsFor(user.id)}
      adjustments={adjustmentsFor(user.id)}
      ok={flash(c.req.query('ok'))}
      error={error}
    />,
    error ? 400 : 200,
  );
}

app.get('/payouts', (c) => renderPayouts(c, flash(c.req.query('error'))));

app.post('/payouts', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const data = await promoterData(user);
  const balance = data.balances.find((b) => b.currency === String(body.currency ?? ''));
  if (!balance) return renderPayouts(c, messages.too_much);
  const raw = String(body.amount ?? '').trim().replace(',', '.');
  const amountCents = /^[0-9]+(\.[0-9]{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : NaN;
  const result = requestPayout(user, balance, {
    amountCents,
    method: String(body.method ?? ''),
    details: String(body.details ?? '').slice(0, 200),
    note: String(body.note ?? '').slice(0, 500),
  });
  if (result !== 'ok') return renderPayouts(c, messages[result]);
  audit(c, 'payout.requested', { userId: user.id, amountCents, currency: balance.currency });
  announcePayoutRequest(user, {
    amountCents,
    currency: balance.currency,
    method: String(body.method ?? ''),
    details: String(body.details ?? '').slice(0, 200),
    note: String(body.note ?? '').slice(0, 500),
  });
  return c.redirect('/payouts?ok=requested');
});

app.post('/rewards/:kind{ticket|merch}', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const kind = c.req.param('kind') as 'ticket' | 'merch';
  const data = await promoterData(user);
  const result = requestReward(user, data.rewards, {
    kind,
    eventId: kind === 'ticket' ? Number(body.event_id) : undefined,
    quantity: kind === 'ticket' ? Number(body.quantity ?? 1) : 1,
    details: String(body.details ?? '').slice(0, 120),
  });
  if (result !== 'ok') return renderPayouts(c, messages[result]);
  const request = rewardRequestsFor(user.id)[0];
  audit(c, 'reward.requested', { userId: user.id, kind, rewardId: request.id });
  announceRewardRequest(user, request);
  return c.redirect('/payouts?ok=reward_requested#rewards');
});

app.get('/account', (c) =>
  c.html(<AccountPage user={c.get('user')} ok={flash(c.req.query('ok'))} error={flash(c.req.query('error'))} />),
);

// Sent by the installed app the first time it opens, or by "I already installed it".
app.post('/account/app-installed', (c) => {
  markAppInstalled(c.get('user').id);
  markSessionApp(c.get('sessionId'));
  return c.json({ ok: true });
});

async function renderSecurity(c: Context<Env>, extra: { setupSecret?: string; recoveryCodes?: string[]; error?: string } = {}) {
  const viewer = c.get('user');
  const user = { ...findUser(viewer.id)!, impersonator: viewer.impersonator };
  // A two-step setup in progress is the promoter's secret: never shown to an admin viewing as them.
  const secret = viewer.impersonator ? null : (extra.setupSecret ?? (c.req.query('setup') ? pendingSecret(user) : null));
  return c.html(
    <SecurityPage
      user={user}
      sessions={sessionsFor(user.id)}
      currentSessionId={c.get('sessionId')}
      twoFactorOn={hasTwoFactor(user)}
      codesLeft={recoveryCodesLeft(user.id)}
      setup={secret ? await setupQr(user, secret) : null}
      setupSecret={secret ?? null}
      recoveryCodes={extra.recoveryCodes}
      ok={flash(c.req.query('ok'))}
      error={extra.error ?? flash(c.req.query('error'))}
    />,
    extra.error ? 400 : 200,
  );
}

app.get('/account/security', (c) => renderSecurity(c));

// --- API keys and connected apps ---------------------------------------------------------------------

app.get('/account/api', (c) => {
  const user = c.get('user');
  return c.html(<ApiPage user={user} tokens={tokensFor(user.id)} ok={flash(c.req.query('ok'))} />);
});

app.post('/account/api/keys', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 60) || 'API key';
  // 90 days unless another choice was picked; anything not offered is refused rather than guessed.
  const days = body.days === 'never' ? null : Number(body.days ?? 90);
  if (!KEY_DAYS.includes(days as KeyDays)) return c.text('Bad request', 400);
  const made = createKey(user.id, name, body.can_write === '1', days as KeyDays);
  if (!made) return c.html(<ApiPage user={user} tokens={tokensFor(user.id)} error={messages.api_too_many} />, 400);
  audit(c, 'api.key_created', { userId: user.id, keyId: made.id, canWrite: body.can_write === '1', days });
  // Shown on this answer only, never in an address or stored anywhere.
  return c.html(<ApiPage user={user} tokens={tokensFor(user.id)} newKey={{ key: made.key, name }} />);
});

app.post('/account/api/:id/remove', (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!revokeToken(user.id, id)) return c.redirect('/account/api');
  audit(c, 'api.key_removed', { userId: user.id, keyId: id });
  return c.redirect('/account/api?ok=api_removed');
});

app.post('/account/security/devices/:id/sign-out', (c) => {
  const id = Number(c.req.param('id'));
  if (id === c.get('sessionId')) return c.redirect('/account/security');
  const done = revokeSession(c.get('user').id, id);
  audit(c, 'security.device_signed_out', { userId: c.get('user').id, done });
  return c.redirect('/account/security?ok=device_out');
});

app.post('/account/security/devices/sign-out-others', (c) => {
  const n = revokeOtherSessions(c.get('user').id, c.get('sessionId'));
  audit(c, 'security.others_signed_out', { userId: c.get('user').id, count: n });
  return c.redirect('/account/security?ok=others_out');
});

app.post('/account/security/2fa/start', (c) => {
  const user = c.get('user');
  if (hasTwoFactor(user)) return c.redirect('/account/security');
  startSetup(user.id);
  return c.redirect('/account/security?setup=1#two-step');
});

app.post('/account/security/2fa/confirm', async (c) => {
  const user = findUser(c.get('user').id)!;
  const codes = confirmSetup(user, String((await c.req.parseBody()).code ?? ''));
  if (!codes) return renderSecurity(c, { setupSecret: pendingSecret(user) ?? undefined, error: messages.code_wrong });
  audit(c, 'security.2fa_on', { userId: user.id });
  // Other devices signed in before; they keep their sessions, the next sign-ins ask for a code.
  return renderSecurity(c, { recoveryCodes: codes });
});

app.post('/account/security/2fa/:action{off|new-codes}', async (c) => {
  const user = findUser(c.get('user').id)!;
  if (!hasTwoFactor(user)) return c.redirect('/account/security');
  if (!verifySecondFactor(user, String((await c.req.parseBody()).code ?? ''))) return renderSecurity(c, { error: messages.code_wrong });
  if (c.req.param('action') === 'off') {
    disableTwoFactor(user.id);
    audit(c, 'security.2fa_off', { userId: user.id });
    return c.redirect('/account/security?ok=2fa_off');
  }
  audit(c, 'security.2fa_new_codes', { userId: user.id });
  return renderSecurity(c, { recoveryCodes: newRecoveryCodes(user.id) });
});

// Promoters see their own photo and their team's; admins see everyone's.
app.get('/avatar/:userId', async (c) => {
  const viewer = c.get('user');
  const userId = Number(c.req.param('userId'));
  if (viewer.id !== userId && !viewer.is_admin && !teamMember(viewer, userId) && !sameTeam(viewer, userId)) return c.notFound();
  return sendStored(c, await deliverAvatar(userId), 'private, max-age=604800');
});

app.post('/account/profile', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const alias = String(body.alias ?? user.alias ?? '').trim().toLowerCase();
  if (!aliasPattern.test(alias)) return c.redirect('/account?error=alias_invalid');
  if (aliasTaken(alias, user.id)) return c.redirect('/account?error=alias_taken');
  setAlias(user.id, alias);
  const text = (key: string, max: number) => String(body[key] ?? '').trim().slice(0, max) || null;
  const theme = ['light', 'dark', 'system'].includes(String(body.theme)) ? String(body.theme) : 'system';
  const method = String(body.payout_method ?? '');
  updateProfile(user.id, {
    first_name: text('first_name', 60),
    last_name: text('last_name', 60),
    phone: text('phone', 30),
    city: tidyCity(text('city', 80)),
    instagram: text('instagram', 60)?.replace(/^@?/, '@') ?? null,
    payout_method: config.payoutMethods.includes(method) ? method : null,
    payout_details: text('payout_details', 200),
    theme,
  });
  audit(c, 'account.profile_updated', { userId: user.id });
  const photo = body.photo;
  if (photo instanceof File && photo.size > 0) {
    if (!allowImageUpload(user.id)) return c.redirect('/account?error=photo_rate');
    const result = await saveUploadedAvatar(user.id, new Uint8Array(await photo.arrayBuffer()));
    if (result !== 'ok') return c.redirect(`/account?error=${photoError[result]}`);
    audit(c, 'account.photo_uploaded', { userId: user.id });
  } else if (body.use_instagram_photo === '1') {
    await useInstagramAvatar(findUser(user.id)!);
  } else {
    // In the background: Instagram can be slow, and a missing photo is not worth waiting for.
    const updated = findUser(user.id)!;
    setTimeout(() => void refreshInstagramAvatar(updated, updated.instagram?.replace(/^@/, '').toLowerCase() !== user.avatar_for), 0);
  }
  return c.redirect('/account?ok=saved');
});

app.post('/account/password', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const password = String(body.password ?? '');
  // Accounts that sign in by email link have no password to change.
  if (!user.password_hash) return c.redirect('/account');
  if (!(await Bun.password.verify(String(body.current ?? ''), user.password_hash))) {
    return c.html(<AccountPage user={user} error={messages.wrong} />, 400);
  }
  if (password.length < MIN_PASSWORD) return c.html(<AccountPage user={user} error={messages.short} />, 400);
  await setPassword(user.id, password);
  audit(c, 'account.password_changed', { userId: user.id });
  startSession(c, user.id);
  return c.redirect('/account?ok=password');
});

app.get('/admin', async (c) => {
  const unassigned = filterCodes(await allPromoCodes(), codeOwners(), { q: '', show: 'unassigned', when: 'upcoming', page: 1 }).total;
  return c.html(
    <AdminPage
      user={c.get('user')}
      promoters={listUsers()}
      unassigned={unassigned}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.get('/admin/codes', async (c) => {
  const filter = parseCodeFilter(c.req.query());
  return c.html(<AdminCodesPage user={c.get('user')} filter={filter} result={filterCodes(await allPromoCodes(), codeOwners(), filter)} />);
});

app.post('/admin/promoters', async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const commission = parseUsualCommission(body);
  if (!name || !email) return c.redirect('/admin?error=missing');
  if (commission === 'invalid') return c.redirect('/admin?error=commission');
  if (findUserByEmail(email)) return c.redirect('/admin?error=exists');
  const id = await createUser({ name, email, isAdmin: body.is_admin === '1', commission });
  setCodes(id, normalizeCodes(String(body.codes ?? '')));
  setAlias(id, suggestAlias(name, id));
  audit(c, 'admin.promoter_created', { by: c.get('user').id, userId: id, isAdmin: body.is_admin === '1', commission });
  if (body.invite !== '1') return c.redirect(`/admin/promoters/${id}?ok=created`);
  const sent = await emailLoginLink(findUser(id)!, 'invite', undefined, 1);
  return c.redirect(sent ? `/admin/promoters/${id}?ok=invited` : `/admin/promoters/${id}?error=mail_failed`);
});

app.get('/admin/promoters/:id', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const data = await promoterData(promoter);
  if (!promoter.page_hidden_at) await prepareShortLinks(promoter, [], { page: true });
  return c.html(
    <PromoterPage
      user={c.get('user')}
      promoter={promoter}
      codes={data.codes}
      balances={data.balances}
      payouts={payoutsFor(promoter.id)}
      rewardRequests={rewardRequestsFor(promoter.id)}
      rewards={data.rewards}
      adjustments={adjustmentsFor(promoter.id)}
      teamLeads={teamLeads().filter((l) => l.id !== promoter.id)}
      team={teamMembers(promoter.id)}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.post('/admin/promoters/:id', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const back = `/admin/promoters/${promoter.id}`;
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const isAdmin = body.is_admin === '1';
  const commission = parseUsualCommission(body);
  if (!name || !email) return c.redirect(`${back}?error=missing`);
  if (commission === 'invalid') return c.redirect(`${back}?error=commission`);
  const existing = findUserByEmail(email);
  if (existing && existing.id !== promoter.id) return c.redirect(`${back}?error=exists`);
  if (promoter.is_admin && !isAdmin && countAdmins() === 1) return c.redirect(`${back}?error=last_admin`);
  const alias = String(body.alias ?? promoter.alias ?? '').trim().toLowerCase();
  if (!aliasPattern.test(alias)) return c.redirect(`${back}?error=alias_invalid`);
  if (aliasTaken(alias, promoter.id)) return c.redirect(`${back}?error=alias_taken`);
  setAlias(promoter.id, alias);
  updateUser(promoter.id, { name, email, isAdmin, commission });
  if (isAdmin && !promoter.is_admin) leaveTeams(promoter.id);
  if (email.toLowerCase() !== promoter.email.toLowerCase()) {
    revokeAccess(promoter.id);
    if (promoter.id === c.get('user').id) startSession(c, promoter.id);
  }
  audit(c, 'admin.promoter_updated', {
    by: c.get('user').id,
    userId: promoter.id,
    emailChanged: email.toLowerCase() !== promoter.email.toLowerCase(),
    isAdmin,
    commission,
  });
  setCodes(promoter.id, normalizeCodes(String(body.codes ?? '')));
  return c.redirect(`${back}?ok=saved`);
});

// An admin sets a promoter's photo, or removes it (back to their Instagram photo or initials).
app.post('/admin/promoters/:id/photo', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const back = `/admin/promoters/${promoter.id}`;
  const admin = c.get('user');
  const photo = (await c.req.parseBody()).photo;
  if (!(photo instanceof File) || photo.size === 0) return c.redirect(`${back}?error=photo_type#photo`);
  if (!allowImageUpload(admin.id)) return c.redirect(`${back}?error=photo_rate#photo`);
  const result = await saveUploadedAvatar(promoter.id, new Uint8Array(await photo.arrayBuffer()), 'admin');
  if (result !== 'ok') return c.redirect(`${back}?error=${photoError[result]}#photo`);
  audit(c, 'admin.photo_set', { by: admin.id, userId: promoter.id });
  if (promoter.id !== admin.id) {
    notify(promoter.id, { title: 'The team set your profile photo', body: 'You can change it on Account.', link: '/account' });
  }
  return c.redirect(`${back}?ok=photo_set#photo`);
});

app.post('/admin/promoters/:id/photo/remove', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  await useInstagramAvatar(promoter);
  audit(c, 'admin.photo_removed', { by: c.get('user').id, userId: promoter.id });
  return c.redirect(`/admin/promoters/${promoter.id}?ok=photo_removed#photo`);
});

app.post('/admin/promoters/:id/invite', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const sent = await emailLoginLink(promoter, 'invite', undefined, 1);
  audit(c, 'admin.link_sent', { by: c.get('user').id, userId: promoter.id, sent });
  return c.redirect(`/admin/promoters/${promoter.id}?${sent ? 'ok=link_sent' : 'error=mail_failed'}`);
});

// Changes by hand: money, sales outside Hi.Events, free tickets and merch.
app.post('/admin/promoters/:id/adjust', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const back = `/admin/promoters/${promoter.id}`;
  const body = await c.req.parseBody();
  const admin = c.get('user');
  const kind = String(body.kind ?? '');
  const label = String(body.label ?? '').trim();
  const rawAmount = String(body.amount ?? '').trim().replace(',', '.');
  const amountCents = rawAmount === '' ? 0 : /^-?[0-9]+(\.[0-9]{1,2})?$/.test(rawAmount) ? Math.round(Number(rawAmount) * 100) : NaN;
  const quantity = Number(body.quantity ?? 0);
  if (!label) return c.redirect(`${back}?error=adjust_reason#adjust`);
  const data = await promoterData(promoter);
  const currency = data.balances[0]?.currency ?? 'CAD';
  const wholeNumber = Number.isInteger(quantity) && quantity !== 0 && Math.abs(quantity) <= 10_000;
  let message: { title: string; body: string } | null = null;

  if (kind === 'money') {
    if (!Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_00) return c.redirect(`${back}?error=adjust_amount#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'money', amountCents, currency, label });
    message = {
      title: amountCents > 0 ? `${formatMoney(amountCents, currency)} added to your balance` : `${formatMoney(-amountCents, currency)} removed from your balance`,
      body: label,
    };
  } else if (kind === 'outside_sale') {
    // The admin gives the ticket sales; the promoter gets their usual commission on them (a percentage of
    // the sales, or their flat amount per ticket).
    const rawSales = String(body.sales ?? '').trim().replace(',', '.');
    const salesCents = rawSales === '' ? 0 : /^-?[0-9]+(\.[0-9]{1,2})?$/.test(rawSales) ? Math.round(Number(rawSales) * 100) : NaN;
    if (!wholeNumber || !Number.isFinite(salesCents) || Math.abs(salesCents) > 1_000_000_00) return c.redirect(`${back}?error=adjust_amount#adjust`);
    const commission = usualCommissionOn(usualRuleFor(promoter), salesCents, quantity);
    const saleId = addAdjustment(admin, promoter.id, { kind: 'tickets_sold', quantity, amountCents: salesCents, currency, label });
    if (commission !== 0) addAdjustment(admin, promoter.id, { kind: 'money', amountCents: commission, currency, label: `${label} (commission)`, parentId: saleId });
    message = {
      title: `${quantity} ${Math.abs(quantity) === 1 ? 'ticket' : 'tickets'} added: ${label}`,
      body: commission
        ? `${formatMoney(salesCents, currency)} in sales: ${formatMoney(commission, currency)} commission added to your balance.`
        : 'They count for your levels and rewards.',
    };
  } else if (kind === 'free_tickets') {
    const eventId = Number(body.event_id);
    const event = data.rewards.tickets.find((t) => t.event.id === eventId)?.event;
    if (!event) return c.redirect(`${back}?error=adjust_event#adjust`);
    if (!wholeNumber) return c.redirect(`${back}?error=adjust_amount#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'free_tickets', quantity, eventId, label });
    message = {
      title: quantity > 0 ? `${quantity} free ${quantity === 1 ? 'ticket' : 'tickets'} for ${event.title}` : `Free tickets for ${event.title} changed`,
      body: `${label}. Request them on Payouts & rewards.`,
    };
  } else if (kind === 'merch') {
    if (!wholeNumber) return c.redirect(`${back}?error=adjust_amount#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'merch', quantity, label });
    message = { title: quantity > 0 ? 'Merch for you' : 'Merch changed', body: `${label}. Request it on Payouts & rewards.` };
  } else {
    return c.redirect(back);
  }
  audit(c, 'admin.adjustment', { by: admin.id, userId: promoter.id, kind, amountCents, quantity, label });
  if (body.notify === '1' && message) notify(promoter.id, { ...message, link: '/payouts' });
  // A level or merch reached through these changes is announced right away.
  checkMilestones(promoter, (await promoterData(promoter)).rewards);
  return c.redirect(`${back}?ok=adjusted#adjust`);
});

app.post('/admin/promoters/:id/adjust/:adjustmentId/undo', (c) => {
  const promoterId = Number(c.req.param('id'));
  const entry = findAdjustment(Number(c.req.param('adjustmentId')));
  if (!entry || entry.user_id !== promoterId) return c.notFound();
  // Undoing a sale also takes back the commission that came with it.
  removeAdjustment(entry.id);
  audit(c, 'admin.adjustment_undone', { by: c.get('user').id, userId: promoterId, entry: describeAdjustment(entry, formatMoney), label: entry.label });
  return c.redirect(`/admin/promoters/${promoterId}?ok=undone#adjust`);
});

// For a promoter who lost their phone and their recovery codes.
app.post('/admin/promoters/:id/api-revoke', (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const removed = revokeAllTokens(promoter.id);
  audit(c, 'admin.api_access_removed', { by: c.get('user').id, userId: promoter.id, removed });
  return c.redirect(`/admin/promoters/${promoter.id}?ok=api_removed_all`);
});

app.post('/admin/promoters/:id/2fa-reset', (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  disableTwoFactor(promoter.id);
  audit(c, 'admin.2fa_reset', { by: c.get('user').id, userId: promoter.id });
  notify(promoter.id, {
    title: 'Two-step verification was reset',
    body: 'An admin turned off two-step verification on your account. Turn it on again under Security.',
    link: '/account/security',
  });
  return c.redirect(`/admin/promoters/${promoter.id}?ok=2fa_reset`);
});

app.post('/admin/promoters/:id/delete', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  if ((await c.req.parseBody()).confirm !== '1') return c.redirect(`/admin/promoters/${promoter.id}`);
  if (promoter.is_admin && countAdmins() === 1) return c.redirect(`/admin/promoters/${promoter.id}?error=last_admin`);
  keepTeamHistory(promoter.id);
  deleteUser(promoter.id);
  audit(c, 'admin.promoter_deleted', { by: c.get('user').id, userId: promoter.id, email: promoter.email });
  return c.redirect('/admin?ok=deleted');
});

app.get('/admin/promoters/:id/view', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  return renderDashboard(c, promoter, `/admin/promoters/${promoter.id}/view`);
});

app.get('/admin/promoters/:id/view/events/:eventId', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  return renderEvent(c, promoter, `/admin/promoters/${promoter.id}/view`);
});

// Admins see the whole app as a promoter, read-only, with a banner, for up to an hour.
app.post('/admin/promoters/:id/impersonate', (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  if (!canImpersonate(promoter)) return c.redirect(`/admin/promoters/${promoter.id}?error=impersonate_admin`);
  startImpersonating(c.get('sessionId'), promoter.id);
  audit(c, 'admin.impersonation_started', { by: c.get('user').id, userId: promoter.id });
  return c.redirect('/');
});

app.post('/impersonate/stop', requireUser, (c) => {
  const user = c.get('user');
  stopImpersonating(c.get('sessionId'));
  if (!user.impersonator) return c.redirect('/');
  audit(c, 'admin.impersonation_stopped', { by: user.impersonator.id, userId: user.id });
  return c.redirect(`/admin/promoters/${user.id}`);
});

// --- Invite links: admins (any team) and team leads (their own team) ------------------------------------

function renderInvites(c: Context<Env>) {
  const user = c.get('user');
  return c.html(
    <InvitesPage
      user={user}
      invites={invitesFor(user)}
      teamLeads={user.is_admin ? teamLeads() : []}
      names={new Map(listUsers().map((u) => [u.id, u.name]))}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
}

async function createInviteFrom(c: Context<Env>, base: string) {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const label = String(body.label ?? '').trim().slice(0, 80);
  if (!label) return c.redirect(`${base}?error=invite_label`);
  const days = String(body.days ?? '') === '' ? null : Number(body.days);
  if (days !== null && ![1, 7, 30].includes(days)) return c.redirect(`${base}?error=invite_days`);
  const rawMax = String(body.max_uses ?? '').trim();
  const maxUses = rawMax === '' ? null : Number(rawMax);
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)) return c.redirect(`${base}?error=invite_max`);
  let teamLeadId: number | null = null;
  if (user.is_admin) {
    if (body.team_lead_id) {
      const lead = findUser(Number(body.team_lead_id));
      if (!lead || !isTeamLead(lead)) return c.redirect(`${base}?error=team_not_lead`);
      teamLeadId = lead.id;
    }
  } else teamLeadId = user.id; // a team lead's links are for their own team
  const invite = createInvite(user, { label, teamLeadId, maxUses, days });
  audit(c, 'invite.created', { by: user.id, inviteId: invite.id, teamLeadId, maxUses, days });
  return c.redirect(`${base}?ok=invite_created`);
}

function toggleInvite(c: Context<Env>, base: string) {
  const invite = findInvite(Number(c.req.param('id')));
  if (!invite || !canManageInvite(c.get('user'), invite)) return c.notFound();
  const off = c.req.param('action') === 'off';
  setInviteDisabled(invite.id, off);
  audit(c, off ? 'invite.turned_off' : 'invite.turned_on', { by: c.get('user').id, inviteId: invite.id });
  return c.redirect(`${base}?ok=${off ? 'invite_off' : 'invite_on'}`);
}

app.get('/admin/invites', (c) => renderInvites(c));
app.post('/admin/invites', (c) => createInviteFrom(c, '/admin/invites'));
app.post('/admin/invites/:id/:action{off|on}', (c) => toggleInvite(c, '/admin/invites'));
app.get('/team/invites', (c) => renderInvites(c));
app.post('/team/invites', (c) => createInviteFrom(c, '/team/invites'));
app.post('/team/invites/:id/:action{off|on}', (c) => toggleInvite(c, '/team/invites'));

// --- Commission per event ---------------------------------------------------------------------------

app.get('/admin/commissions', async (c) =>
  c.html(
    <AdminCommissionsPage
      user={c.get('user')}
      events={await commissionEvents()}
      rules={allEventRules()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  ),
);

app.post('/admin/commissions', async (c) => {
  const body = await c.req.parseBody();
  const userId = Number(body.user_id);
  const eventId = Number(body.event_id);
  const hash = `#event-${eventId}`;
  // Only for a promoter with a code on an event that is not over.
  const event = (await commissionEvents()).find((e) => e.id === eventId);
  if (!event || !event.promoters.some((p) => p.id === userId)) return c.redirect('/admin/commissions?error=rate_event');
  const kind = String(body.kind ?? '');
  const raw = String(body.value ?? '').trim().replace(',', '.');
  const value = /^[0-9]+(\.[0-9]{1,2})?$/.test(raw) ? Number(raw) : NaN;
  let rule: EventRule | null = null;
  if (kind === 'percent') {
    if (!(value >= 0 && value <= 100)) return c.redirect(`/admin/commissions?error=rate_percent${hash}`);
    rule = { kind, value };
  } else if (kind === 'flat') {
    if (!(value >= 0 && value <= 10_000)) return c.redirect(`/admin/commissions?error=rate_flat${hash}`);
    rule = { kind, value: Math.round(value * 100) };
  } else if (kind !== 'usual') return c.redirect('/admin/commissions?error=rate_event');
  setEventRule(userId, eventId, rule);
  audit(c, 'admin.event_commission_changed', { by: c.get('user').id, userId, eventId, rule });
  return c.redirect(`/admin/commissions?ok=rate_saved${hash}`);
});

// --- Media drive per event ---------------------------------------------------------------------------

app.get('/admin/media', async (c) =>
  c.html(
    <AdminMediaPage
      user={c.get('user')}
      events={await commissionEvents()}
      drives={allMediaDrives()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  ),
);

app.post('/admin/media', async (c) => {
  const body = await c.req.parseBody();
  const eventId = Number(body.event_id);
  const hash = `#event-${eventId}`;
  // Only for a draft or upcoming event that promoters see (one of them has a code on it).
  if (!(await commissionEvents()).some((e) => e.id === eventId)) return c.redirect('/admin/media?error=media_event');
  const url = parseMediaUrl(body.url);
  if (url === 'invalid') return c.redirect(`/admin/media?error=media_url${hash}`);
  setMediaDrive(eventId, url, c.get('user').id);
  audit(c, 'admin.media_drive_changed', { by: c.get('user').id, eventId, url });
  return c.redirect(`/admin/media?ok=${url ? 'media_saved' : 'media_removed'}${hash}`);
});

// --- Promoters' public pages, for admins -------------------------------------------------------------

/** Promoters with a page (admins only when they have codes), their short links made or brought up to date. */
async function pagePromoters() {
  const promoters = listUsers().filter((u) => !u.is_admin || u.codes.length > 0);
  // Every page at once: at most 2.5 s in all; the rest show on the next visit.
  await Promise.all(promoters.filter((u) => !u.page_hidden_at).map((u) => prepareShortLinks(u, [], { page: true })));
  return promoters;
}

app.get('/admin/pages', async (c) => {
  const promoters = await pagePromoters();
  return c.html(
    <AdminPagesPage
      user={c.get('user')}
      promoters={promoters}
      clicks={new Map(promoters.map((u) => [u.id, pageClicks(u)]))}
      kutt={kuttEnabled()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

// A spreadsheet cell starting with = + - @ (or a tab/return) could run as a formula: such text gets a leading '.
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

app.get('/admin/pages.csv', async (c) => {
  const promoters = await pagePromoters();
  const rows = [
    ['Name', 'Email', 'Alias', 'Page link', 'Short link', 'Short link clicks', 'Visible'],
    ...promoters.map((u) => [
      u.name,
      u.email,
      u.alias ?? '',
      pageLink(u) ?? '',
      pageShortLink(u) ?? '',
      String(pageClicks(u) ?? ''),
      u.page_hidden_at ? 'no' : 'yes',
    ]),
  ];
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="promoter-pages.csv"');
  return c.body(`\ufeff${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
});

app.post('/admin/pages/:id/short-link', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const address = String((await c.req.parseBody()).address ?? '').trim().toLowerCase();
  const result = await renamePageLink(promoter, address);
  if (result !== 'ok') return c.redirect(`/admin/pages?error=short_${result}`);
  audit(c, 'admin.page_short_link_renamed', { userId: promoter.id, address });
  return c.redirect('/admin/pages?ok=short_renamed');
});

app.post('/admin/pages/:id/visibility', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const hidden = (await c.req.parseBody()).hidden === '1';
  setPageHidden(promoter.id, hidden, c.get('user').id);
  audit(c, hidden ? 'admin.page_hidden' : 'admin.page_shown', { userId: promoter.id });
  return c.redirect('/admin/pages?ok=page_saved');
});

// --- Teams ----------------------------------------------------------------------------------------------

/** A team's ranking for the period: the team lead and their promoters, each with their own rate. */
async function renderTeam(c: Context<Env>, lead: User, basePath: string, memberHref: ((u: User) => string) | null) {
  // All time unless a period is picked, so the totals match everyone's dashboard.
  const range = parseRange(c.req.query('range'), 'all');
  const sortParam = c.req.query('sort');
  // Promoters looking at their own team see no commission, so cannot sort by it either.
  const sort: Sort = sortParam === 'sales' || (sortParam === 'commission' && memberHref) ? sortParam : 'tickets';
  const members = teamMembers(lead.id);
  const [board, team] = await Promise.all([leaderboard(range, sort, [lead, ...members]), teamCommission(lead, range)]);
  return c.html(
    <TeamPage
      user={c.get('user')}
      lead={lead}
      members={members}
      board={board}
      team={team}
      range={range}
      sort={sort}
      basePath={basePath}
      memberHref={memberHref}
    />,
  );
}

// Team leads: their team's sales, and each promoter's dashboard as an admin sees it. Nothing to act on.
// A promoter on a team sees the team's tickets and sales, their team lead's included, but no
// one's commission and no one else's dashboard.
app.get('/team', (c) => {
  const user = c.get('user');
  if (isTeamLead(user)) return renderTeam(c, user, '/team', (u) => `/team/${u.id}`);
  const lead = teamLeadOf(user);
  if (!lead) return c.text('Forbidden', 403);
  return renderTeam(c, lead, '/team', null);
});

app.get('/team/:id', (c) => {
  const member = teamMember(c.get('user'), Number(c.req.param('id')));
  if (!member) return c.notFound();
  return renderDashboard(c, member, `/team/${member.id}`);
});

app.get('/team/:id/events/:eventId', (c) => {
  const member = teamMember(c.get('user'), Number(c.req.param('id')));
  if (!member) return c.notFound();
  return renderEvent(c, member, `/team/${member.id}`);
});

app.get('/admin/teams', (c) =>
  c.html(
    <AdminTeamsPage
      user={c.get('user')}
      leads={teamLeads().map((lead) => ({ lead, members: teamMembers(lead.id) }))}
      promoters={listUsers().filter((u) => !u.is_admin)}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  ),
);

app.get('/admin/teams/:id', (c) => {
  const lead = findUser(Number(c.req.param('id')));
  if (!lead || !isTeamLead(lead)) return c.notFound();
  return renderTeam(c, lead, `/admin/teams/${lead.id}`, (u) => `/admin/promoters/${u.id}`);
});

// Forms on Teams and on a promoter's page come back to where they were sent from.
const teamBack = (from: unknown, userId: number) => (from === 'promoter' ? `/admin/promoters/${userId}` : '/admin/teams');

app.post('/admin/teams/lead', async (c) => {
  const body = await c.req.parseBody();
  const promoter = findUser(Number(body.user_id));
  if (!promoter) return c.redirect('/admin/teams?error=team_pick');
  const back = teamBack(body.from, promoter.id);
  const lead = body.lead === '1';
  const result = setTeamLead(promoter, lead);
  if (result !== 'ok') return c.redirect(`${back}?error=${result}`);
  audit(c, lead ? 'admin.team_lead_added' : 'admin.team_lead_removed', { by: c.get('user').id, userId: promoter.id });
  return c.redirect(`${back}?ok=${lead ? 'team_lead_on' : 'team_lead_off'}`);
});

app.post('/admin/teams/:id/commission', async (c) => {
  const lead = findUser(Number(c.req.param('id')));
  if (!lead || !isTeamLead(lead)) return c.notFound();
  const body = await c.req.parseBody();
  const back = teamBack(body.from, lead.id);
  const percent = parseCommission(body.team_commission_percent);
  if (percent === 'invalid') return c.redirect(`${back}?error=commission`);
  setTeamCommission(lead.id, percent);
  audit(c, 'admin.team_commission_changed', { by: c.get('user').id, userId: lead.id, percent });
  return c.redirect(`${back}?ok=team_commission`);
});

async function saveTeam(c: Context<Env>, promoter: User, rawLead: unknown, back: string) {
  const leadId = rawLead === '' || rawLead === undefined ? null : Number(rawLead);
  const result = leadId !== null && !Number.isInteger(leadId) ? 'team_not_lead' : assignTeam(promoter, leadId);
  if (result !== 'ok') return c.redirect(`${back}?error=${result}`);
  audit(c, 'admin.team_changed', { by: c.get('user').id, userId: promoter.id, teamLeadId: leadId });
  return c.redirect(`${back}?ok=team_saved`);
}

app.post('/admin/teams/add', async (c) => {
  const body = await c.req.parseBody();
  const promoter = findUser(Number(body.user_id));
  if (!promoter) return c.redirect('/admin/teams?error=team_pick');
  if (!body.team_lead_id) return c.redirect('/admin/teams?error=team_not_lead');
  return saveTeam(c, promoter, body.team_lead_id, '/admin/teams');
});

app.post('/admin/promoters/:id/team', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  const body = await c.req.parseBody();
  return saveTeam(c, promoter, body.team_lead_id, teamBack(body.from === 'teams' ? 'teams' : 'promoter', promoter.id));
});

app.get('/admin/dashboard', async (c) => {
  const range = parseRange(c.req.query('range'), '30');
  const sortParam = c.req.query('sort');
  const sort: Sort = sortParam === 'sales' || sortParam === 'commission' ? sortParam : 'tickets';
  const board = await leaderboard(range, sort);
  // Each team for the period: the team lead and their promoters, and the team lead's commission on them.
  const teams = await Promise.all(
    teamLeads().map(async (lead) => {
      const members = teamMembers(lead.id);
      const ids = new Set([lead.id, ...members.map((m) => m.id)]);
      const entries = board.entries.filter((e) => ids.has(e.user.id));
      const team = (await teamCommission(lead, range)).find((t) => t.currency === board.currency);
      return {
        lead,
        members: members.length,
        tickets: entries.reduce((sum, e) => sum + e.tickets, 0),
        sales: entries.reduce((sum, e) => sum + e.fullPrice, 0),
        commission: entries.reduce((sum, e) => sum + e.commission, 0),
        teamCommission: team?.commission ?? 0,
      };
    }),
  );
  teams.sort((a, b) => b.tickets - a.tickets || b.sales - a.sales);
  return c.html(
    <AdminDashboardPage
      user={c.get('user')}
      board={board}
      teams={teams}
      range={range}
      sort={sort}
      promoters={listUsers().filter((u) => !u.is_admin)}
    />,
  );
});

app.get('/admin/rewards', (c) => {
  const rules = rewardRules();
  return c.html(
    <AdminRewardsPage
      user={c.get('user')}
      rules={rules}
      saved={rules}
      customized={isRulesCustomized()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

/** The rules from the admin form: rows sorted by tickets, empty rows left out. Numbers that are not numbers stay NaN for the check. */
function rulesFromForm(body: Record<string, string | File | (string | File)[]>): RewardRules {
  const list = (key: string) => {
    const value = body[key];
    return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) => (typeof v === 'string' ? v.trim() : ''));
  };
  const number = (text: string, fallback = NaN) => (text === '' ? fallback : /^-?\d+$/.test(text) ? Number(text) : NaN);
  const byAt = <T extends { at: number }>(rows: T[]) => rows.sort((a, b) => a.at - b.at);
  const names = list('level_name');
  const ats = list('level_at');
  const colors = list('level_color');
  const levels = byAt(
    names.flatMap((name, i) => (name ? [{ name, at: number(ats[i] ?? ''), color: (colors[i] ?? '') as LevelColor }] : [])),
  );
  const track = (prefix: 'ticket' | 'merch'): Track => {
    const at = list(`${prefix}_at`);
    const count = list(`${prefix}_count`);
    const label = list(`${prefix}_label`);
    const rows = Array.from({ length: Math.max(at.length, count.length, label.length) }, (_, i) => i);
    return {
      // A row with only a count or a name is kept, so the check says what is missing.
      milestones: byAt(
        rows.flatMap((i) => (at[i] || count[i] || label[i] ? [{ at: number(at[i] ?? ''), count: number(count[i] ?? '', 1), label: label[i] ?? '' }] : [])),
      ),
      every: number(list(`${prefix}_every`)[0] ?? '', 0),
      count: number(list(`${prefix}_every_count`)[0] ?? '', 1),
      label: list(`${prefix}_every_label`)[0] ?? '',
    };
  };
  return { levels, tickets: track('ticket'), merch: track('merch') };
}

app.post('/admin/rewards', async (c) => {
  const rules = rulesFromForm(await c.req.parseBody({ all: true }));
  const problem = describeProblem(rules);
  if (problem) {
    // Shown again with what they typed, so nothing is lost.
    return c.html(
      <AdminRewardsPage user={c.get('user')} rules={rules} saved={rewardRules()} customized={isRulesCustomized()} error={problem} />,
      400,
    );
  }
  saveRewardRules(rules);
  audit(c, 'admin.rewards_saved', { by: c.get('user').id, levels: rules.levels.length });
  return c.redirect('/admin/rewards?ok=rewards_saved');
});

app.post('/admin/rewards/reset', (c) => {
  saveRewardRules(null);
  audit(c, 'admin.rewards_reset', { by: c.get('user').id });
  return c.redirect('/admin/rewards?ok=rewards_reset');
});

app.get('/admin/links', async (c) => {
  const { baseUrl, template } = linkSettings();
  const example = baseUrl ? eventLink({ id: 123, title: 'Warehouse Night' }, 'DJMAX', 'dj-max') : null;
  return c.html(
    <AdminLinksPage
      user={c.get('user')}
      baseUrl={baseUrl}
      template={template}
      example={example}
      shortLinks={shortLinkStatus()}
      kuttDomains={kuttEnabled() ? await kuttDomains() : null}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.post('/admin/links', async (c) => {
  const body = await c.req.parseBody();
  const baseUrl = String(body.base_url ?? '').trim();
  if (!/^https?:\/\/[^\s/]+/.test(baseUrl)) return c.redirect('/admin/links?error=bad_url');
  saveLinkSettings(baseUrl, String(body.template ?? '').slice(0, 300));
  audit(c, 'admin.links_saved', { by: c.get('user').id });
  return c.redirect('/admin/links?ok=saved');
});

app.post('/admin/links/short-domain', async (c) => {
  const body = await c.req.parseBody();
  const domain = String(body.domain ?? '').trim().toLowerCase();
  if (domain) {
    // Only a domain of the Kutt account, as Kutt lists it now.
    const domains = await kuttDomains();
    if (!domains) return c.redirect('/admin/links?error=kutt_unreachable#short-links');
    if (!domains.includes(domain)) return c.redirect('/admin/links?error=bad_domain#short-links');
  }
  saveShortDomain(domain);
  audit(c, 'admin.short_domain_saved', { by: c.get('user').id, domain });
  return c.redirect('/admin/links?ok=domain_saved#short-links');
});

app.get('/admin/emails', (c) =>
  c.html(<AdminEmailsPage user={c.get('user')} log={recentEmails()} ok={flash(c.req.query('ok'))} error={flash(c.req.query('error'))} />),
);

app.post('/admin/emails/settings', async (c) => {
  const replyTo = String((await c.req.parseBody()).reply_to ?? '').trim();
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) return c.redirect('/admin/emails?error=bad_email');
  saveReplyTo(replyTo);
  audit(c, 'admin.email_settings', { by: c.get('user').id, replyTo });
  return c.redirect('/admin/emails?ok=saved');
});

const emailType = (raw: string) => (emailTypes.includes(raw as EmailType) ? (raw as EmailType) : null);

app.get('/admin/emails/:type', (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  return c.html(
    <AdminEmailEditPage
      user={c.get('user')}
      type={type}
      version={String(Date.now())}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.get('/admin/emails/:type/preview', (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  return c.html(renderEmail(type, sampleVars(type, c.get('user').name)).html);
});

app.post('/admin/emails/:type', async (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  const body = await c.req.parseBody();
  const back = `/admin/emails/${type}`;
  if (body.action === 'reset') {
    resetTemplate(type);
    audit(c, 'admin.email_reset', { by: c.get('user').id, type });
    return c.redirect(`${back}?ok=reset`);
  }
  saveTemplate(type, {
    subject: String(body.subject ?? ''),
    heading: String(body.heading ?? ''),
    body: String(body.body ?? ''),
    button: String(body.button ?? ''),
  });
  audit(c, 'admin.email_saved', { by: c.get('user').id, type });
  if (body.action !== 'test') return c.redirect(`${back}?ok=saved`);
  const me = c.get('user');
  const sent = await sendEmail(type, [me], sampleVars(type, me.name), getTemplate(type), { attempts: 1 });
  return c.redirect(`${back}?${sent ? 'ok=test_sent' : 'error=test_failed'}`);
});

app.get('/admin/branding', (c) =>
  c.html(<AdminBrandingPage user={c.get('user')} ok={flash(c.req.query('ok'))} error={flash(c.req.query('error'))} />),
);

app.post('/admin/branding', async (c) => {
  const body = await c.req.parseBody();
  const accent = String(body.accent ?? '').trim();
  if (!isHex(accent)) return c.redirect('/admin/branding?error=bad_color');
  const logo = body.logo;
  if (logo instanceof File && logo.size > 0) {
    if (!allowImageUpload(c.get('user').id)) return c.redirect('/admin/branding?error=photo_rate');
    const image = await processImage(new Uint8Array(await logo.arrayBuffer()), 'logo');
    if (typeof image === 'string') return c.redirect(`/admin/branding?error=${{ too_big: 'logo_size', bad_type: 'logo_type', too_many_pixels: 'logo_pixels' }[image]}`);
    await saveLogo(image.bytes, image.type);
  } else if (body.remove_logo === '1') {
    await removeLogo();
  }
  updateBrand({
    name: String(body.name ?? ''),
    accent,
    loginMessage: String(body.login_message ?? ''),
    footer: String(body.footer ?? ''),
  });
  audit(c, 'admin.branding_updated', { by: c.get('user').id, accent, logo: logo instanceof File && logo.size > 0 });
  return c.redirect('/admin/branding?ok=saved');
});

app.get('/admin/payouts', (c) =>
  c.html(
    <AdminPayoutsPage
      user={c.get('user')}
      pending={listPayouts('pending')}
      done={listPayouts('done')}
      pendingRewards={listRewardRequests('pending')}
      doneRewards={listRewardRequests('done')}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  ),
);

app.post('/admin/rewards/:id/:action{fulfil|reject}', async (c) => {
  const reward = findRewardRequest(Number(c.req.param('id')));
  if (!reward) return c.notFound();
  const status = c.req.param('action') === 'fulfil' ? 'fulfilled' : 'rejected';
  const adminNote = String((await c.req.parseBody()).admin_note ?? '').slice(0, 200);
  if (status === 'rejected' && !adminNote.trim()) return c.redirect('/admin/payouts');
  if (!finishReward(c, c.get('user'), reward, status, adminNote)) return c.redirect('/admin/payouts?error=payout_gone');
  return c.redirect(`/admin/payouts?ok=reward_${status}`);
});

app.post('/admin/payouts/:id/:action{paid|reject}', async (c) => {
  const payout = findPayout(Number(c.req.param('id')));
  if (!payout) return c.notFound();
  const status = c.req.param('action') === 'paid' ? 'paid' : 'rejected';
  const adminNote = String((await c.req.parseBody()).admin_note ?? '').slice(0, 200);
  if (status === 'rejected' && !adminNote.trim()) return c.redirect('/admin/payouts');
  if (!finishPayout(c, c.get('user'), payout, status, adminNote)) return c.redirect('/admin/payouts?error=payout_gone');
  return c.redirect(`/admin/payouts?ok=payout_${status}`);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  // A malformed form body is the client's mistake: answer 400 instead of logging a server error.
  if ((err as { code?: string }).code === 'ERR_FORMDATA_PARSE_ERROR') return c.text('Bad request', 400);
  console.error(err);
  return c.text('Something went wrong. Please try again in a moment.', 500);
});

// Create the first admin from the environment so there is always a way in.
if (config.adminEmail && config.adminPassword && !findUserByEmail(config.adminEmail)) {
  await createUser({ email: config.adminEmail, name: 'Admin', password: config.adminPassword, isAdmin: true });
  console.log(`Created admin ${config.adminEmail}`);
}

ensureAliases();
purgeExpiredSessions();
// With S3 set up: check the bucket answers, then move files still on disk to it. Then, once, shrink the
// photos and logo stored before uploads were shrunk.
void checkStorage()
  .then(async () => {
    const photos = await moveAvatarsToBucket();
    const logo = await moveLogoToBucket();
    if (photos || logo) console.log(`Moved to the S3 bucket: ${photos} profile photos${logo ? ' and the logo' : ''}.`);
  })
  .catch((err) => console.error('Moving files to the S3 bucket failed; they are still on disk:', err))
  .then(async () => {
    const photos = await shrinkStoredAvatars();
    const logo = await shrinkStoredLogo();
    if (photos || logo) console.log(`Shrunk the stored images: ${photos} profile photos${logo ? ' and the logo' : ''}.`);
  })
  .catch((err) => console.error('Shrinking the stored images failed; they are kept as they were:', err));
setInterval(() => {
  purgeExpiredSessions();
  purgeUploadCounts();
  purgeOldNotifications();
  purgeEmailLog();
  purgePendingSignIns();
  purgeApiTokens();
  purgeApiLimits();
  void refreshAllAvatars();
}, 60 * 60 * 1000);
// New sales become milestone notifications within a few minutes, even if nobody has the app open.
setInterval(() => void checkAllMilestones(), config.milestoneCheckMinutes * 60 * 1000);
setTimeout(() => void checkAllMilestones(), 10_000);

// Fail fast if the Hi.Events database is unreachable or the role lacks access.
await sql`SELECT 1 FROM promo_codes LIMIT 1`;
console.log(`Listening on :${config.port}`);

// Above the slowest request (one mail attempt with its 10-20 s timeouts), so nobody gets an empty reply.
export default { port: config.port, fetch: app.fetch, idleTimeout: 45 };
