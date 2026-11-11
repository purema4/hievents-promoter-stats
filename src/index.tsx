import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementLink,
  isPushEndpoint,
  isPushKeys,
  markAllRead,
  notificationsFor,
  notify,
  openNotification,
  recentAnnouncements,
  sendAnnouncement,
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
import { emailTypes, getTemplate, languagesOf, renderEmail, resetTemplate, sampleVars, saveReplyTo, saveTemplate, type EmailType } from './email-templates';
import { formatMoney, parseAmountCents, usualCommissionOn, type EventRule } from './money';
import {
  cashAvailable,
  findPayout,
  listPayouts,
  payoutsFor,
  requestPayout,
} from './payouts';
import { CheckoutPage, DashboardPage, EventPage, PayoutsPage, summarizeEvents, type CartLine, type PayoutForm } from './promoter-views';
import {
  findRewardRequest,
  listRewardRequests,
  requestReward,
  rewardRequestsFor,
  checkRewards,
  requestRewards,
  type RewardInput,
} from './rewards';
import { describeProblem, isCustomized as isRulesCustomized, rewardRules, saveRewardRules, trackOn, type LevelColor, type RewardRules, type Track } from './reward-rules';
import { kuttDomains, kuttEnabled, pageClicks, pageShortLink, prepareShortLinks, renamePageLink, saveShortDomain, shortLinkStatus } from './short-links';
import { DirectoryEditorPage, MyPagePage, PageMissing, PromoterDirectoryPage, PromoterPublicPage, type DirectoryEntry } from './page-views';
import {
  addItem,
  deliverBackgroundImage,
  directoryCss,
  directoryItems,
  directorySettings,
  directoryVersion,
  publicDirectoryItems,
  removeBackgroundImage,
  removeItem,
  reorderItems,
  saveBackgroundImage,
  saveDirectorySettings,
  setItemHidden,
  updateItem,
} from './directory';
import { directoryPreview, previewVersion } from './directory-preview';
import { hiddenByTeam, pageEvents, pageOwner, setPageHidden } from './promoter-page';
import { allEventRules, setEventRule } from './commission';
import { db as localDb, saveLang, setLangPref, setShowAdvanced } from './local-db';
import { lang as currentLang, langFromHeader, t, withLang } from './i18n';
import { currentRule, endRulesOf, ruleFor, FREE_TICKETS, generalRuleFor, listRewardTypes, listTemplates, migrateToRules, removeTemplate, rewardTypeOf, ruleHistory, ruleOutputs, saveRewardType, saveRuleVersion, saveTemplate as saveRuleTemplate, type RuleScope, setRuleLine, setUsualRule, trackExpression } from './rules';
import { checkRule, evaluateRules, RULE_MAX_LENGTH, RulesEngineUnavailable, rulesEngineUp } from './rules-engine';
import { ruleWriterEnabled, writeRule } from './rule-writer';
import { checkDraft, dealInWords, labelOf, resultSentence, ruleInWords, type RuleCheck } from './rule-admin';
import { AdminRuleEditPage, AdminRulesPage, ruleEditHref, type RuleTargetInfo } from './rule-views';
import { emptyInputs } from './rule-variables';
import { allEventBanners, checkoutNotice, generalBanner, setCheckoutNotice, parseBanner, setEventBanner, setGeneralBanner } from './banners';
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
  setTeamCommission,
  setTeamLead,
  teamLeadOf,
  teamLeads,
  teamMember,
  teamMembers,
} from './teams';
import QRCode from 'qrcode';
import { publicAsset, publicText, serviceWorker } from './static';
import { announcePayoutRequest, announceRewardOrder, announceRewardRequest, commissionEvents, emailLoginLink, finishPayout, finishReward, promoterData, teamTotals } from './actions';
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
  AdminBannersPage,
  AdminNotifyPage,
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
// Promoter-facing ones are [English, French]; admin-only ones stay in English.
const messages: Record<string, string | [en: string, fr: string]> = {
  created: 'Promoter created.',
  invited: 'Promoter created and a sign-in link was emailed to them.',
  link_sent: 'Sign-in link emailed.',
  mail_failed: 'Saved, but the email could not be sent. Check the SMTP settings and the container log.',
  commission: 'Commission must be a percentage from 0 to 100, or an amount per ticket like 2 or 2.50.',
  saved: ['Saved.', 'Enregistré.'],
  password: ['Password updated.', 'Mot de passe mis à jour.'],
  deleted: 'Promoter deleted.',
  short: [`Passwords need at least ${MIN_PASSWORD} characters.`, `Le mot de passe doit avoir au moins ${MIN_PASSWORD} caractères.`],
  exists: 'Another account already uses that email.',
  wrong: ['Current password is incorrect.', 'Le mot de passe actuel est incorrect.'],
  last_admin: 'You cannot remove the last admin.',
  missing: 'Name and email are required.',
  requested: ['Payout requested. The team has been notified and you will get an email once it is paid.', 'Paiement demandé. L’équipe a été avisée et tu recevras un courriel une fois qu’il sera payé.'],
  invalid_amount: ['Enter an amount like 25 or 25.50.', 'Entre un montant comme 25 ou 25,50.'],
  too_much: ['That is more than your available balance.', 'C’est plus que ton solde disponible.'],
  already_pending: ['You already have a request waiting for this currency.', 'Tu as déjà une demande en attente pour cette devise.'],
  missing_method: ['Choose how we should pay you.', 'Choisis comment on doit te payer.'],
  cash_step: [`Cash is paid in steps of $${config.cashStepCents / 100}: choose $${config.cashStepCents / 100}, $${(config.cashStepCents * 2) / 100} and so on.`, `L’argent comptant est payé par tranches de ${config.cashStepCents / 100} $ : choisis ${config.cashStepCents / 100} $, ${(config.cashStepCents * 2) / 100} $ et ainsi de suite.`],
  payout_paid: 'Marked as paid. The promoter has been emailed.',
  payout_rejected: 'Request declined. The promoter has been emailed and the amount is available to them again.',
  payout_gone: 'That request was already handled.',
  bad_color: 'Pick a colour with the colour picker.',
  bad_email: 'That is not a valid email address.',
  adjusted: 'Change added.',
  undone: 'Change undone.',
  adjust_reason: 'Give a reason: the promoter sees it.',
  adjust_amount: 'Enter an amount like 50 or -12.50, and whole numbers for tickets and merch (not 0).',
  code_wrong: ['That code did not work. Use the newest 6-digit code from your authenticator app.', 'Ce code n’a pas fonctionné. Utilise le code à 6 chiffres le plus récent de ton app d’authentification.'],
  device_out: ['That device is signed out.', 'Cet appareil est déconnecté.'],
  others_out: ['All your other devices are signed out.', 'Tous tes autres appareils sont déconnectés.'],
  '2fa_off': ['Two-step verification is off.', 'La vérification en deux étapes est désactivée.'],
  '2fa_reset': 'Two-step verification was reset. They can sign in with just the link and turn it on again.',
  alias_invalid: ['The alias needs 2 to 30 letters, numbers, - or _, starting with a letter or number.', 'L’alias doit avoir de 2 à 30 lettres, chiffres, - ou _, et commencer par une lettre ou un chiffre.'],
  alias_taken: ['Another promoter already uses that alias.', 'Un autre promoteur utilise déjà cet alias.'],
  bad_url: 'Enter the full address, starting with https://',
  rewards_saved: 'Levels and rewards saved. Promoters see them right away.',
  rewards_reset: 'Back to the default levels and rewards.',
  domain_saved: 'Short link domain saved. Promoters get links on it from their next visit.',
  bad_domain: 'Pick one of the domains of the Kutt account.',
  kutt_unreachable: 'Kutt did not answer, so the domain could not be checked. Try again in a few minutes.',
  reset: 'Back to the default wording.',
  test_sent: 'Saved, and a test was sent to your email address.',
  test_failed: 'Saved, but the test could not be sent. The list of recent emails shows why.',
  photo_size: [`The photo must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or less.`, `La photo doit faire ${Math.round(maxUploadBytes / 1024 / 1024)} Mo ou moins.`],
  photo_type: ['The photo must be a PNG, JPEG or WebP image.', 'La photo doit être une image PNG, JPEG ou WebP.'],
  photo_missing: ['Choose a photo, or skip this step for now.', 'Choisis une photo, ou saute cette étape pour l’instant.'],
  logo_size: `The logo must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or less.`,
  logo_type: 'The logo must be a PNG, JPEG or WebP image.',
  logo_pixels: `The logo must be at most ${maxImageSide} pixels on each side.`,
  photo_pixels: [`The photo must be at most ${maxImageSide} pixels on each side (50 megapixels in all).`, `La photo doit faire au plus ${maxImageSide} pixels de chaque côté (50 mégapixels en tout).`],
  photo_rate: ['Too many photos uploaded in the last hour. Try again later.', 'Trop de photos téléversées dans la dernière heure. Réessaie plus tard.'],
  photo_set: 'Photo saved. They were told the team changed it.',
  photo_removed: 'Photo removed. Their Instagram photo or initials show instead.',
  reward_requested: ['Reward requested. The team has been notified.', 'Récompense demandée. L’équipe a été avisée.'],
  not_available: ['That reward is not available any more.', 'Cette récompense n’est plus disponible.'],
  missing_details: ['Tell us which item and size you would like.', 'Dis-nous quel article et quelle taille tu veux.'],
  reward_fulfilled: 'Marked as given. The promoter has been emailed.',
  reward_rejected: 'Reward request declined. The promoter has been emailed and can request it again.',
  page_hidden: ['Your page is hidden.', 'Ta page est masquée.'],
  page_shown: ['Your page is back.', 'Ta page est de retour.'],
  page_saved: 'Saved. The page shows or hides right away.',
  index_saved: 'Saved. Visitors see it within a minute.',
  index_added: 'Added at the end of the list. Drag it where you want it.',
  index_removed: 'Removed from the index page.',
  index_no_title: 'Give it a text.',
  index_bad_url: 'That link does not work. Use a web address (like instagram.com/…), an email (mailto:…) or a phone number (tel:…).',
  index_no_image: 'Upload a photo to use one as the background.',
  background_size: `The photo must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or less.`,
  background_type: 'The photo must be a PNG, JPEG or WebP image.',
  background_pixels: 'The photo is too large in pixels. Use a smaller one.',
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
  invite_created: ['Invite link created. Copy it below and share it.', 'Lien d’invitation créé. Copie-le ci-dessous et partage-le.'],
  invite_off: ['Invite link turned off. It no longer works.', 'Lien d’invitation désactivé. Il ne fonctionne plus.'],
  invite_on: ['Invite link turned back on.', 'Lien d’invitation réactivé.'],
  invite_label: ['Give the link a name.', 'Donne un nom au lien.'],
  invite_days: ['Pick how long the link works.', 'Choisis combien de temps le lien fonctionne.'],
  invite_max: ['Sign-ups must be a whole number from 1 to 1000, or empty.', 'Le nombre d’inscriptions doit être un nombre entier de 1 à 1000, ou vide.'],
  rate_saved: 'Commission saved. It applies to all their sales for this event, earlier ones too.',
  rate_event: 'Pick one of the promoters on an event that is not over.',
  rate_percent: 'The percentage must be a number between 0 and 100.',
  rate_flat: 'The amount per ticket must be like 2 or 2.50.',
  media_saved: 'Media drive saved. Promoters on this event now see it.',
  media_removed: 'Media drive removed.',
  media_url: 'The media drive must be a link starting with https://.',
  media_event: 'Pick one of the events listed: drafts and events that are not over.',
  adjust_event: 'Pick one of their upcoming events.',
  banner_saved: 'Banner saved. Promoters see it now.',
  reward_ordered: ['Sent to the team. You will hear back here and by email.', 'Envoyé à l’équipe. Tu auras une réponse ici et par courriel.'],
  all_requested: [
    'Sent to the team: your payout and your rewards. You will hear back here and by email.',
    'Envoyé à l’équipe : ton paiement et tes récompenses. Tu auras une réponse ici et par courriel.',
  ],
  rule_saved: 'Rule saved. It applies right away, to all sales, earlier ones too.',
  rule_removed: 'Rule removed. The broader rules apply again.',
  reward_type: 'A key is lowercase letters, digits and _ (like vip_tickets), not commission, bonus or merch, and needs a label.',
  reward_type_saved: 'Reward type saved. Rules can give it now.',
  rules_down: 'The rules engine is not available, so the numbers may be out of date. Approve payouts once it is back.',
  banner_removed: 'Banner removed.',
  api_removed: ['Removed. It stops working right away.', 'Supprimé. Ça cesse de fonctionner tout de suite.'],
  api_removed_all: 'Their API keys and connected apps are removed and stop working right away.',
  api_too_many: [`You can have up to ${MAX_KEYS} keys. Remove one to make another.`, `Tu peux avoir jusqu’à ${MAX_KEYS} clés. Supprimes-en une pour en créer une autre.`],
};
// Own keys only: ?ok=constructor must not pick up something from Object.prototype.
function flash(key?: string): string | undefined {
  if (!key || !Object.hasOwn(messages, key)) return undefined;
  const m = messages[key]!;
  return typeof m === 'string' ? m : t(m[0], m[1]);
}

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

// Every request runs in the language the person chose (menu → Language), or else their browser's;
// a signed-in person's is kept for what is sent to them later.
const LANG_COOKIE = 'lang';
app.use(async (c, next) => {
  const chosen = currentUser(c)?.lang_pref ?? (getCookie(c, LANG_COOKIE) as string | undefined);
  const language = chosen === 'fr' || chosen === 'en' ? chosen : langFromHeader(c.req.header('accept-language'));
  // Admin pages are only in English for now: their numbers and dates stay English too.
  await withLang(c.req.path === '/admin' || c.req.path.startsWith('/admin/') ? 'en' : language, next);
  const user = c.get('user') as User | undefined;
  if (user && !user.impersonator && user.lang !== language) saveLang(user.id, language);
});

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
  if (path === '/admin/pages/index') return '/admin/pages/index?error=background_size';
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
    <LoginPage error={t('You are offline. Your numbers will show again as soon as you are back online.', 'Tu es hors ligne. Tes chiffres vont réapparaître dès que tu seras de retour en ligne.')} offline />,
  ),
);

// --- Promoters' public pages: no sign-in, and nothing about sales ----------------------------------

// The index page: every promoter's page and the team's own links, as admins arranged them.
app.get('/p', async (c) => {
  const items = publicDirectoryItems();
  const promoters = items.flatMap((i) => (i.kind === 'promoter' ? [i.user] : []));
  // At most a second for Kutt in all; a page without a short link yet shows its own address.
  await Promise.race([Promise.all(promoters.map((u) => prepareShortLinks(u, [], { waitMs: 1000, page: true }))), Bun.sleep(1000)]);
  const entries: DirectoryEntry[] = items.map((i) =>
    i.kind === 'promoter' ? { kind: 'promoter', user: i.user, link: pageShortLink(i.user) ?? pageLink(i.user)! } : i.kind === 'link' ? { kind: 'link', title: i.title, url: i.url } : { kind: 'heading', title: i.title },
  );
  const settings = directorySettings();
  c.header('Cache-Control', 'public, max-age=60');
  return c.html(
    <PromoterDirectoryPage
      title={settings.title}
      tagline={settings.tagline}
      stylesheet={`/directory.css?v=${directoryVersion()}`}
      image={`${config.appUrl}/directory/preview.jpg?v=${previewVersion(promoters)}`}
      entries={entries}
    />,
  );
});

// The picture for link previews (src/directory-preview.ts), of the promoters on the page right now.
app.get('/directory/preview.jpg', async (c) => {
  const promoters = publicDirectoryItems().flatMap((i) => (i.kind === 'promoter' ? [i.user] : []));
  const bytes = await directoryPreview(promoters);
  c.header('Content-Type', 'image/jpeg');
  // Linked with its version, but apps fetch it once and keep it; an hour is plenty.
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(new Uint8Array(bytes));
});

app.get('/directory.css', (c) => {
  c.header('Content-Type', 'text/css; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(directoryCss());
});
app.get('/directory/background', async (c) => sendStored(c, await deliverBackgroundImage(), 'public, max-age=31536000, immutable'));

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
  if (!values.first_name || !values.last_name) return again(t('Enter your first and last name.', 'Entre ton prénom et ton nom.'), 400);
  if (!emailPattern.test(values.email)) return again(t('That is not a valid email address.', 'Ce n’est pas une adresse courriel valide.'), 400);
  if (!allowSignup(invite.id)) return again(t('Too many people joined with this link in the last hour. Try again later.', 'Trop de personnes se sont inscrites avec ce lien dans la dernière heure. Réessaie plus tard.'), 429);

  const started = Date.now();
  const waiting = { id: startWaiting(c), from: summarizeDevice(c.req.header('user-agent')) };
  // Their emails are in the language of the browser that asked.
  const language = currentLang();
  const existing = findUserByEmail(values.email);
  if (existing) {
    // Already a promoter: a sign-in link, and the same answer as a new sign-up, so the page does not tell
    // who has an account.
    if (allowLinkRequest(values.email)) setTimeout(() => void emailLoginLink(existing, 'login', waiting, 3, language), 0);
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
    if (lead) {
      notify(lead.id, () => ({
        title: t('New promoter on your team', 'Nouveau promoteur dans ton équipe'),
        body: t(`${name} joined your team with your invite link "${invite.label}".`, `${name} s’est joint à ton équipe avec ton lien d’invitation « ${invite.label} ».`),
        link: '/team',
      }));
    }
    setTimeout(() => void emailLoginLink(findUser(id)!, 'invite', waiting, 3, language), 0);
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
    return c.html(<LoginPage withPassword email={email} error={t('Too many attempts. Try again in 15 minutes.', 'Trop de tentatives. Réessaie dans 15 minutes.')} />, 429);
  }
  if (!result) {
    audit(c, 'login.failed', { email });
    return c.html(<LoginPage withPassword email={email} error={t('Wrong email or password.', 'Courriel ou mot de passe incorrect.')} />, 401);
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
  const language = currentLang();
  if (user) {
    const allowed = allowLinkRequest(email);
    audit(c, allowed ? 'link.requested' : 'link.rate_limited', { userId: user.id });
    // Sent after the response, so waiting on SMTP cannot make known emails answer slower.
    if (allowed) setTimeout(() => void emailLoginLink(user, 'login', waiting, 3, language), 0);
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
    return c.html(<LoginPage error={t('This link has expired or was already used. Enter your email to get a new one.', 'Ce lien est expiré ou a déjà été utilisé. Entre ton courriel pour en recevoir un nouveau.')} />, 400);
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
    return c.html(<LoginPage sent email={email} error={t('That code is wrong or has expired.', 'Ce code est incorrect ou expiré.')} />, 400);
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
      return c.html(<LoginPage error={t('Too many wrong codes. Sign in again from the start.', 'Trop de codes incorrects. Reconnecte-toi depuis le début.')} />, 429);
    }
    return c.html(<TwoFactorPage error={t('That code did not work. Check the time on your phone and try the newest code.', 'Ce code n’a pas fonctionné. Vérifie l’heure de ton téléphone et essaie le code le plus récent.')} />, 400);
  }
  finishPendingSignIn(c, pending);
  startSession(c, user.id);
  audit(c, `login.2fa_${result}`, { userId: user.id });
  if (result === 'recovery') {
    const left = recoveryCodesLeft(user.id);
    notify(user.id, () => ({
      title: t('A recovery code was used', 'Un code de récupération a été utilisé'),
      body: t(
        `${left} recovery codes left. Make new ones under Security if you are running low.`,
        `${left} ${left < 2 ? 'code de récupération restant' : 'codes de récupération restants'}. Crées-en de nouveaux sous Sécurité s’il t’en reste peu.`,
      ),
      link: '/account/security',
    }));
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
  const upcoming = summarizeEvents(data.rows, data.percent).filter((e) => (!e.end || e.end.getTime() >= Date.now()) && !e.draft);
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
      banners={data.banners}
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
  if (!event.draft) await prepareShortLinks(promoter, event.codes.map((code) => ({ event: { id: event.id, title: event.title }, code })));
  // Their deal on this event in words (never the rule itself), in the browser's language.
  const lang = currentLang();
  const rule = ruleFor(promoter.id, eventId);
  const deal = {
    lang,
    lines: await dealInWords(promoter.id, eventId, lang),
    // Lines that always give 0 (like free_tickets = 0) are left out, as in the words above.
    result: resultSentence(event.tickets, data.percent.events.get(eventId), rule.lines.filter((l) => !/^0+(\.0+)?$/.test(l.expr.trim())).map((l) => l.name), event.currency, lang),
  };
  return c.html(
    <EventPage
      deal={deal}
      viewer={c.get('user')}
      promoter={promoter}
      basePath={basePath}
      rows={data.rows}
      eventId={eventId}
      daily={await dailyForCodes(data.codes, eventId)}
      rewards={data.rewards}
      percent={data.percent}
      media={data.media.get(eventId) ?? null}
      banner={data.banners.get(eventId) ?? null}
      range={parseRange(c.req.query('range'), 'all')}
      payout={basePath === '' ? payoutSummary(promoter, data) : undefined}
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

// Unread ones stay marked until opened, or until "Mark all as read".
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
  return page;
});

// Opening one marks it as read, then goes where it points. Viewing as a promoter leaves it unread for them.
app.get('/notifications/:id{[0-9]+}', (c) => {
  const user = c.get('user');
  const n = openNotification(user.id, Number(c.req.param('id')), !!user.impersonator);
  if (!n) return c.redirect('/notifications');
  return c.redirect(n.link && /^(\/(?![/\\])|https?:)/.test(n.link) ? n.link : '/notifications');
});

app.post('/notifications/read', (c) => {
  markAllRead(c.get('user').id);
  return c.redirect('/notifications');
});

function testMessage(key?: string): string | undefined {
  if (!key) return undefined;
  if (key === 'none') return t('Sent to the list below, but no device has phone notifications turned on yet. Tap Turn on first.', 'Envoyée dans la liste ci-dessous, mais aucun appareil n’a encore les notifications activées. Touche d’abord Activer.');
  if (key === 'failed') return t('The push service did not accept it. Turn notifications off and on again on that device.', 'Le service de notifications ne l’a pas acceptée. Désactive puis réactive les notifications sur cet appareil.');
  if (key === 'soon') return t('Wait a few seconds before sending another test.', 'Attends quelques secondes avant d’envoyer un autre test.');
  if (key === 'settings') return t('Saved. Your alerts follow these settings from now on.', 'Enregistré. Tes alertes suivent ces réglages à partir de maintenant.');
  const [delivered, devices] = key.split('-').map(Number);
  if (!Number.isInteger(delivered) || !Number.isInteger(devices)) return undefined;
  return delivered === devices
    ? t(
        `Sent to ${devices === 1 ? 'your device' : `all ${devices} of your devices`}. It should appear in a few seconds.`,
        `Envoyée ${devices === 1 ? 'à ton appareil' : `à tes ${devices} appareils`}. Elle devrait apparaître dans quelques secondes.`,
      )
    : t(
        `Sent to ${delivered} of your ${devices} devices; the others did not accept it.`,
        `Envoyée à ${delivered} de tes ${devices} appareils; les autres ne l’ont pas acceptée.`,
      );
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

/** Where free tickets go when not on the event they were earned on: a published event that is not over. */
function rolloverTarget(data: { ticketEvents: { id: number; title: string }[] }, raw: unknown): { id: number; title: string } | undefined | null {
  const text = String(raw ?? '').trim();
  if (text === '') return undefined;
  return data.ticketEvents.find((e) => e.id === Number(text)) ?? null;
}

async function renderPayouts(c: Context<Env>, error?: string) {
  const user = c.get('user');
  const data = await promoterData(user);
  // A reward request lands on #rewards, so its confirmation shows there rather than at the top, out of sight.
  const ok = c.req.query('ok');
  const inShop = ok === 'reward_ordered' || ok === 'reward_requested';
  return c.html(
    <PayoutsPage
      user={user}
      balances={data.balances}
      payouts={payoutsFor(user.id)}
      rewards={data.rewards}
      ticketEvents={data.ticketEvents}
      rewardRequests={rewardRequestsFor(user.id)}
      adjustments={adjustmentsFor(user.id)}
      ok={inShop ? undefined : flash(ok)}
      rewardOk={inShop ? flash(ok) : undefined}
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
  if (!balance) return renderPayouts(c, flash('too_much'));
  const amountCents = parseAmountCents(String(body.amount ?? ''));
  const result = requestPayout(user, balance, {
    amountCents,
    method: String(body.method ?? ''),
    details: String(body.details ?? '').slice(0, 200),
    note: String(body.note ?? '').slice(0, 500),
    ruleVersions: data.percent.versionIds,
  });
  if (result !== 'ok') return renderPayouts(c, flash(result));
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

/** "Ann, Bob" from what was typed, one name after another. */
function guestNames(guests: string): string {
  return guests.split(/[,;\n]+/).map((g) => g.trim()).filter(Boolean).join(', ');
}

/**
 * Who a shop item is for. Tickets are sent to the promoter, who hands them out; a guest list is names at
 * the door, which only guest list rewards ask for. For the team ("Guest list: Ann, Bob" or the
 * promoter's name), and for the promoter at checkout ("On the guest list: Ann, Bob" or "Sent to you").
 */
function ticketsFor(user: User, guestList: boolean, guests: string): string {
  return (guestList ? `Guest list: ${guestNames(guests)}` : user.name).slice(0, 120);
}
function whoFor(user: User, guestList: boolean, guests: string): string {
  return guestList ? t(`On the guest list: ${guestNames(guests)}`, `Sur la liste d’invités : ${guestNames(guests)}`) : t(`Sent to you (${user.name})`, `Envoyé à toi (${user.name})`);
}

// Shop fields carried from the shop to checkout and on to the order.
const CART_FIELD = /^(qty|guests|for|event)\.[a-z0-9_.]+$|^merch\.details$/;
const namesNeeded = () => t('Add the names for the guest list.', 'Ajoute les noms pour la liste d’invités.');

/** The cart sent from the shop: the requests to make, and each line in plain words for checkout. */
function cartFrom(
  body: Record<string, unknown>,
  data: Awaited<ReturnType<typeof promoterData>>,
  user: User,
  // At checkout a payout alone is a request too: no rewards is not an error.
  options: { allowEmpty?: boolean } = {},
): { items: RewardInput[]; lines: CartLine[]; fields: [string, string][]; error?: string } {
  const field = (name: string) => String(body[name] ?? '').trim();
  const items: RewardInput[] = [];
  const lines: CartLine[] = [];
  for (const t of data.rewards.tickets) {
    const key = `${t.event.id}.${t.type.key}`;
    const quantity = Number(field(`qty.${key}`) || 0);
    if (!quantity) continue;
    // "Use them for": this event, or the bank (the team accepts it; then it keeps until asked for).
    const toBank = field(`for.${key}`) === 'bank';
    const guestList = !!t.type.guest_list && !toBank;
    if (guestList && !guestNames(field(`guests.${key}`))) return { items, lines, fields: [], error: namesNeeded() };
    items.push({
      kind: 'ticket',
      eventId: t.event.id,
      rewardType: t.type.key,
      toBank,
      quantity,
      details: ticketsFor(user, guestList, field(`guests.${key}`)),
      ruleVersions: data.percent.events.get(t.event.id)?.versionIds,
    });
    lines.push({ field: key, max: t.available, quantity, type: t.type, event: t.event, toBank, who: toBank ? '' : whoFor(user, guestList, field(`guests.${key}`)) });
  }
  // Out of the bank, for an upcoming event of their choice; the type stays.
  for (const b of data.rewards.bank) {
    const key = `bank.${b.type.key}`;
    const quantity = Number(field(`qty.${key}`) || 0);
    if (!quantity) continue;
    const event = data.ticketEvents.find((e) => e.id === Number(field(`event.${key}`)));
    if (!event) return { items, lines, fields: [], error: t('Pick the event to use your banked rewards for.', 'Choisis l’événement pour lequel utiliser tes récompenses en banque.') };
    const guestList = !!b.type.guest_list;
    if (guestList && !guestNames(field(`guests.${key}`))) return { items, lines, fields: [], error: namesNeeded() };
    items.push({ kind: 'ticket', rewardType: b.type.key, fromBank: event, quantity, details: ticketsFor(user, guestList, field(`guests.${key}`)) });
    lines.push({ field: key, max: b.balance, quantity, type: b.type, event, fromBank: true, who: whoFor(user, guestList, field(`guests.${key}`)) });
  }
  const merch = Number(field('qty.merch') || 0);
  if (merch) {
    items.push({ kind: 'merch', quantity: merch, details: field('merch.details').slice(0, 120) });
    lines.push({ field: 'merch', max: data.rewards.merch.available, quantity: merch, merch: field('merch.details').slice(0, 120) });
  }
  const fields = Object.entries(body)
    .filter(([k, v]) => CART_FIELD.test(k) && typeof v === 'string')
    .map(([k, v]) => [k, String(v).slice(0, 200)] as [string, string]);
  if (items.length === 0 && !options.allowEmpty) return { items, lines, fields, error: t('Your cart is empty: pick how many of a reward you want first.', 'Ton panier est vide : choisis d’abord combien tu veux d’une récompense.') };
  return { items, lines, fields };
}

/*
 * One way to ask for anything: every "request" button (the menu, the dashboard, an event page, the
 * shop's cart) leads to this checkout. It holds the payout (ticked when there is money to ask for) and
 * the rewards, each with how many; one Send makes all of it.
 */
type PromoterData = Awaited<ReturnType<typeof promoterData>>;

/** The payout part of checkout, filled in from what was typed or else the way they were paid last time. None when nothing can be asked. */
function payoutForm(user: User, data: PromoterData, body?: Record<string, unknown>): PayoutForm | null {
  const balance = data.balances.find((b) => b.available > 0 && b.pending === 0);
  if (!balance) return null;
  const saved = user.payout_method && config.payoutMethods.includes(user.payout_method) ? user.payout_method : config.payoutMethods[0]!;
  const method = body && config.payoutMethods.includes(String(body.method)) ? String(body.method) : saved;
  const amount = body?.amount !== undefined ? String(body.amount) : ((method === config.cashMethod ? cashAvailable(balance) : balance.available) / 100).toFixed(2);
  return {
    currency: balance.currency,
    available: balance.available,
    cashAvailable: cashAvailable(balance),
    method,
    amount,
    details: body?.details !== undefined ? String(body.details) : user.payout_details || user.email,
    note: body?.note !== undefined ? String(body.note) : '',
  };
}

/** What the event page's "Ready to request" card says about money. */
function payoutSummary(user: User, data: PromoterData) {
  const p = payoutForm(user, data);
  return p ? { amountCents: p.available, currency: p.currency } : undefined;
}

/** A payout already waiting for the team, in words; '' when none is. */
const payoutWaiting = (data: PromoterData) =>
  data.balances
    .filter((b) => b.pending > 0)
    .map((b) => formatMoney(b.pending, b.currency))
    .join(' + ');

function renderCheckout(
  c: Context<Env>,
  data: PromoterData,
  cart: ReturnType<typeof cartFrom>,
  options: { body?: Record<string, unknown>; includePayout: boolean; error?: string; left?: boolean },
) {
  const user = c.get('user');
  return c.html(
    <CheckoutPage
      user={user}
      lines={cart.lines}
      fields={cart.fields.filter(([name]) => !name.startsWith('qty.'))}
      payout={payoutForm(user, data, options.body) ?? undefined}
      includePayout={options.includePayout}
      waiting={payoutWaiting(data)}
      left={options.left}
      notice={checkoutNotice()}
      error={options.error}
    />,
    options.error ? 400 : 200,
  );
}

// Everything ready to ask for, or one event's with ?event=: rewards with all of their count, and the payout.
// Guest list spots (names), merch (which item) and saved rewards (which event) are picked in the shop.
app.get('/rewards/checkout', async (c) => {
  const user = c.get('user');
  const data = await promoterData(user);
  const eventId = c.req.query('event') ? Number(c.req.query('event')) : null;
  const ready = data.rewards.tickets.filter((r) => r.available > 0 && (eventId === null || r.event.id === eventId));
  const body = Object.fromEntries(ready.filter((r) => !r.type.guest_list).map((r) => [`qty.${r.event.id}.${r.type.key}`, String(r.available)]));
  const cart = cartFrom(body, data, user, { allowEmpty: true });
  const left = ready.some((r) => r.type.guest_list) || (eventId === null && (data.rewards.merch.available > 0 || data.rewards.bank.some((b) => b.balance > 0)));
  return renderCheckout(c, data, cart, { includePayout: true, left });
});

// From the shop's cart: what was picked, and the payout too.
app.post('/rewards/checkout', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const data = await promoterData(user);
  const cart = cartFrom(body, data, user);
  if (cart.error) return renderPayouts(c, cart.error);
  const result = checkRewards(user, data.rewards, cart.items);
  if (result !== 'ok') return renderPayouts(c, flash(result));
  return renderCheckout(c, data, cart, { includePayout: true });
});

// Send: the payout (when ticked) and every reward with a count, in one go; nothing is sent if any part is refused.
app.post('/rewards/order', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const data = await promoterData(user);
  const withPayout = body.payout === '1';
  const cart = cartFrom(body, data, user, { allowEmpty: withPayout });
  if (cart.error) return renderPayouts(c, cart.error);
  const again = (error: string) => renderCheckout(c, data, cart, { body, includePayout: withPayout, error });
  // The team's notice must have been accepted when rewards are asked for.
  if (cart.items.length && checkoutNotice() && body.ack !== '1') return again(t('Read the note from the team and tick the box first.', 'Lis la note de l’équipe et coche la case d’abord.'));
  if (cart.items.length) {
    const check = checkRewards(user, data.rewards, cart.items);
    if (check !== 'ok') return renderPayouts(c, flash(check));
  }
  if (withPayout) {
    const balance = data.balances.find((b) => b.currency === String(body.currency ?? ''));
    if (!balance) return again(flash('too_much')!);
    const payout = { amountCents: parseAmountCents(String(body.amount ?? '')), method: String(body.method ?? ''), details: String(body.details ?? '').slice(0, 200), note: String(body.note ?? '').slice(0, 500) };
    const result = requestPayout(user, balance, { ...payout, ruleVersions: data.percent.versionIds });
    if (result !== 'ok') return again(flash(result)!);
    audit(c, 'payout.requested', { userId: user.id, amountCents: payout.amountCents, currency: balance.currency });
    announcePayoutRequest(user, { ...payout, currency: balance.currency });
  }
  if (cart.items.length) {
    const before = rewardRequestsFor(user.id).length;
    const { result } = requestRewards(user, data.rewards, cart.items);
    if (result !== 'ok') return renderPayouts(c, flash(result));
    // Newest first in the list: the cart's own, back in the order they were picked.
    const all = rewardRequestsFor(user.id);
    const requests = all.slice(0, all.length - before).reverse();
    audit(c, 'reward.ordered', { userId: user.id, rewardIds: requests.map((r) => r.id) });
    announceRewardOrder(user, requests);
  }
  if (withPayout) return c.redirect(cart.items.length ? '/payouts?ok=all_requested' : '/payouts?ok=requested');
  return c.redirect('/payouts?ok=reward_ordered#rewards');
});

app.post('/rewards/:kind{ticket|merch}', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const kind = c.req.param('kind') as 'ticket' | 'merch';
  const data = await promoterData(user);
  // An event to roll them over to that is not open to it any more: refused, not used on the first one.
  if (kind === 'ticket' && rolloverTarget(data, body.use_for) === null) return renderPayouts(c, flash('not_available'));
  const result = requestReward(user, data.rewards, {
    kind,
    eventId: kind === 'ticket' ? Number(body.event_id) : undefined,
    rewardType: kind === 'ticket' ? String(body.reward_type ?? '') : undefined,
    ruleVersions: kind === 'ticket' ? data.percent.events.get(Number(body.event_id))?.versionIds : undefined,
    useFor: kind === 'ticket' ? (rolloverTarget(data, body.use_for) ?? undefined) : undefined,
    quantity: kind === 'ticket' ? Number(body.quantity ?? 1) : 1,
    details: String(body.details ?? '').slice(0, 120),
  });
  if (result !== 'ok') return renderPayouts(c, flash(result));
  const request = rewardRequestsFor(user.id)[0];
  audit(c, 'reward.requested', { userId: user.id, kind, rewardId: request.id });
  announceRewardRequest(user, request);
  return c.redirect('/payouts?ok=reward_requested#rewards');
});

app.get('/account', (c) =>
  c.html(<AccountPage user={c.get('user')} ok={flash(c.req.query('ok'))} error={flash(c.req.query('error'))} />),
);

// Sent by the installed app the first time it opens, or by "I already installed it".
// The menu's language choice: on the account when signed in, and in a cookie for the pages before
// signing in. "auto" goes back to the browser's language.
app.post('/lang', async (c) => {
  const body = await c.req.parseBody();
  const choice = body.lang === 'fr' || body.lang === 'en' ? body.lang : null;
  const user = currentUser(c);
  if (user && !user.impersonator) setLangPref(user.id, choice);
  if (choice) setCookie(c, LANG_COOKIE, choice, { path: '/', sameSite: 'Lax', secure: config.cookieSecure, maxAge: 365 * 86400 });
  else deleteCookie(c, LANG_COOKIE, { path: '/', secure: config.cookieSecure });
  const back = String(body.back ?? '/');
  return c.redirect(/^\/(?![/\\])[^\s]{0,300}$/.test(back) ? back : '/', 303);
});

// The menu's Advanced toggle; back to the page it was pressed on.
app.post('/account/advanced', async (c) => {
  const body = await c.req.parseBody();
  setShowAdvanced(c.get('user').id, body.on === '1');
  // Only a path on this site: never somewhere else.
  const back = String(body.back ?? '/');
  return c.redirect(/^\/(?![/\\])[^\s]{0,300}$/.test(back) ? back : '/', 303);
});

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
  if (!made) return c.html(<ApiPage user={user} tokens={tokensFor(user.id)} error={flash('api_too_many')} />, 400);
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
  if (!codes) return renderSecurity(c, { setupSecret: pendingSecret(user) ?? undefined, error: flash('code_wrong') });
  audit(c, 'security.2fa_on', { userId: user.id });
  // Other devices signed in before; they keep their sessions, the next sign-ins ask for a code.
  return renderSecurity(c, { recoveryCodes: codes });
});

app.post('/account/security/2fa/:action{off|new-codes}', async (c) => {
  const user = findUser(c.get('user').id)!;
  if (!hasTwoFactor(user)) return c.redirect('/account/security');
  if (!verifySecondFactor(user, String((await c.req.parseBody()).code ?? ''))) return renderSecurity(c, { error: flash('code_wrong') });
  if (c.req.param('action') === 'off') {
    disableTwoFactor(user.id);
    audit(c, 'security.2fa_off', { userId: user.id });
    return c.redirect('/account/security?ok=2fa_off');
  }
  audit(c, 'security.2fa_new_codes', { userId: user.id });
  return renderSecurity(c, { recoveryCodes: newRecoveryCodes(user.id) });
});

// Promoters see their own photo, their team lead's and, for a team lead, their promoters'; admins see everyone's.
app.get('/avatar/:userId', async (c) => {
  const viewer = c.get('user');
  const userId = Number(c.req.param('userId'));
  if (viewer.id !== userId && !viewer.is_admin && !teamMember(viewer, userId) && teamLeadOf(viewer)?.id !== userId) return c.notFound();
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
    return c.html(<AccountPage user={user} error={flash('wrong')} />, 400);
  }
  if (password.length < MIN_PASSWORD) return c.html(<AccountPage user={user} error={flash('short')} />, 400);
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
  setUsualRule(id, commission, c.get('user').id);
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
      events={summarizeEvents(data.rows, data.percent).map((e) => ({ id: e.id, title: e.title, upcoming: !e.end || e.end.getTime() >= Date.now() }))}
      rewardTypes={listRewardTypes()}
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
  // Only when the usual rate changed, so the rest of the promoter's rule is left alone.
  if (commission.percent !== promoter.commission_percent || commission.flatCents !== (promoter.commission_flat_cents ?? null)) {
    setUsualRule(promoter.id, commission, c.get('user').id);
  }
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
    notify(promoter.id, () => ({
      title: t('The team set your profile photo', 'L’équipe a choisi ta photo de profil'),
      body: t('You can change it on Account.', 'Tu peux la changer dans Compte.'),
      link: '/account',
    }));
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
  // Worded when sent, in the promoter's language.
  let message: (() => { title: string; body: string }) | null = null;

  if (kind === 'money') {
    if (!Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_00) return c.redirect(`${back}?error=adjust_amount#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'money', amountCents, currency, label });
    message = () => ({
      title:
        amountCents > 0
          ? t(`${formatMoney(amountCents, currency)} added to your balance`, `${formatMoney(amountCents, currency)} ajouté à ton solde`)
          : t(`${formatMoney(-amountCents, currency)} removed from your balance`, `${formatMoney(-amountCents, currency)} retiré de ton solde`),
      body: label,
    });
  } else if (kind === 'outside_sale') {
    // The admin gives the ticket sales. For one of their events, they count in that event's rule
    // (outside_tickets, outside_sales). Otherwise the commission their own rule gives on them is added now.
    const rawSales = String(body.sales ?? '').trim().replace(',', '.');
    const salesCents = rawSales === '' ? 0 : /^-?[0-9]+(\.[0-9]{1,2})?$/.test(rawSales) ? Math.round(Number(rawSales) * 100) : NaN;
    if (!wholeNumber || !Number.isFinite(salesCents) || Math.abs(salesCents) > 1_000_000_00) return c.redirect(`${back}?error=adjust_amount#adjust`);
    const eventId = String(body.event_id ?? '') === '' ? null : Number(body.event_id);
    if (eventId !== null && !data.rows.some((r) => r.event_id === eventId)) return c.redirect(`${back}?error=adjust_event#adjust`);
    let commission = 0;
    if (eventId === null) {
      // Worked out on the sizes, then signed, so a correction (negative) takes back what the sale gave.
      const rule = generalRuleFor(promoter.id);
      const subject = `outside:${promoter.id}:${Date.now()}`;
      const { results, stale } = await evaluateRules({ version: rule.key, lines: rule.lines.filter((l) => l.name === 'commission') }, [
        { subject, variables: { ...emptyInputs(), tickets_sold: Math.abs(quantity), full_price_sales: Math.abs(salesCents) / 100 } },
      ]);
      if (stale) return c.redirect(`${back}?error=rules_down#adjust`);
      commission = Math.sign(quantity) * Math.max(0, Math.round((results.get(subject)?.outputs.commission ?? 0) * 100));
    }
    const saleId = addAdjustment(admin, promoter.id, { kind: 'tickets_sold', quantity, amountCents: salesCents, currency, eventId, label });
    if (commission !== 0) addAdjustment(admin, promoter.id, { kind: 'money', amountCents: commission, currency, label: `${label} (commission)`, parentId: saleId });
    message = () => ({
      title: t(
        `${quantity} ${Math.abs(quantity) === 1 ? 'ticket' : 'tickets'} added: ${label}`,
        `${quantity} ${Math.abs(quantity) < 2 ? 'billet ajouté' : 'billets ajoutés'} : ${label}`,
      ),
      body: commission
        ? t(
            `${formatMoney(salesCents, currency)} in sales: ${formatMoney(commission, currency)} commission added to your balance.`,
            `${formatMoney(salesCents, currency)} en ventes : ${formatMoney(commission, currency)} de commission ajouté à ton solde.`,
          )
        : t('They count for your levels and rewards.', 'Ils comptent pour tes niveaux et tes récompenses.'),
    });
  } else if (kind === 'free_tickets') {
    const eventId = Number(body.event_id);
    const event = summarizeEvents(data.rows, data.percent).find((e) => e.id === eventId && (!e.end || e.end.getTime() >= Date.now()));
    if (!event) return c.redirect(`${back}?error=adjust_event#adjust`);
    if (!wholeNumber) return c.redirect(`${back}?error=adjust_amount#adjust`);
    const type = rewardTypeOf(String(body.reward_type ?? '') || FREE_TICKETS);
    if (!type) return c.redirect(`${back}?error=adjust_event#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'free_tickets', quantity, eventId, label, rewardType: type.key });
    message = () => {
      const plain = type.key === FREE_TICKETS;
      const what = plain ? t(`free ${Math.abs(quantity) === 1 ? 'ticket' : 'tickets'}`, Math.abs(quantity) < 2 ? 'billet gratuit' : 'billets gratuits') : t(type.label_en, type.label_fr);
      return {
        title:
          quantity > 0
            ? t(`${quantity} ${what} for ${event.title}`, `${quantity} ${what} pour ${event.title}`)
            : t(`${plain ? 'Free tickets' : type.label_en} for ${event.title} changed`, `${plain ? 'Billets gratuits' : type.label_fr} pour ${event.title} modifiés`),
        body: t(`${label}. Request them on Payouts & rewards.`, `${label}. Demande-les dans Paiements et récompenses.`),
      };
    };
  } else if (kind === 'merch') {
    if (!wholeNumber) return c.redirect(`${back}?error=adjust_amount#adjust`);
    addAdjustment(admin, promoter.id, { kind: 'merch', quantity, label });
    message = () => ({
      title: quantity > 0 ? t('Merch for you', 'De la marchandise pour toi') : t('Merch changed', 'Marchandise modifiée'),
      body: t(`${label}. Request it on Payouts & rewards.`, `${label}. Demande-la dans Paiements et récompenses.`),
    });
  } else {
    return c.redirect(back);
  }
  audit(c, 'admin.adjustment', { by: admin.id, userId: promoter.id, kind, amountCents, quantity, label });
  const wording = message;
  if (body.notify === '1' && wording) notify(promoter.id, () => ({ ...wording(), link: '/payouts' }));
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
  notify(promoter.id, () => ({
    title: t('Two-step verification was reset', 'La vérification en deux étapes a été réinitialisée'),
    body: t(
      'An admin turned off two-step verification on your account. Turn it on again under Security.',
      'Un admin a désactivé la vérification en deux étapes sur ton compte. Réactive-la sous Sécurité.',
    ),
    link: '/account/security',
  }));
  return c.redirect(`/admin/promoters/${promoter.id}?ok=2fa_reset`);
});

app.post('/admin/promoters/:id/delete', async (c) => {
  const promoter = findUser(Number(c.req.param('id')));
  if (!promoter) return c.notFound();
  if ((await c.req.parseBody()).confirm !== '1') return c.redirect(`/admin/promoters/${promoter.id}`);
  if (promoter.is_admin && countAdmins() === 1) return c.redirect(`/admin/promoters/${promoter.id}?error=last_admin`);
  keepTeamHistory(promoter.id);
  endRulesOf(promoter.id, c.get('user').id);
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
  setEventRule(userId, eventId, rule, c.get('user').id);
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

// --- Rules (Pay & rewards → Rules) -----------------------------------------------------------------------

/** Which rule a request is about, checked: the promoter and the event (one that is not over) must exist. */
async function ruleTargetOf(get: (key: string) => string | undefined): Promise<RuleTargetInfo | null> {
  const scope = get('scope') as RuleScope;
  if (!['default', 'promoter', 'event', 'promoter_event', 'template', 'team'].includes(scope)) return null;
  const target: RuleTargetInfo = { scope };
  if (scope === 'promoter' || scope === 'promoter_event' || scope === 'team') {
    const user = findUser(Number(get('user')));
    if (!user) return null;
    // A team rule is only for a team lead.
    if (scope === 'team' && !isTeamLead(user)) return null;
    target.userId = user.id;
    target.promoterName = user.name;
  }
  if (scope === 'event' || scope === 'promoter_event') {
    const event = (await commissionEvents()).find((e) => e.id === Number(get('event')));
    if (!event) return null;
    if (scope === 'promoter_event' && !event.promoters.some((p) => p.id === target.userId)) return null;
    target.eventId = event.id;
    target.eventTitle = event.title;
  }
  if (scope === 'template' && get('template')) {
    const template = listTemplates().find((t) => t.id === Number(get('template')));
    if (!template) return null;
    target.templateId = template.id;
    target.templateName = template.name;
  }
  return target;
}

const ruleLabels = () => Object.fromEntries(ruleOutputs().map((o) => [o, labelOf(o, 'en')]));

async function renderRuleEdit(
  c: Context<Env>,
  target: RuleTargetInfo,
  text: string,
  opts: { status?: 400; error?: string; problems?: RuleCheck; description?: string; note?: string } = {},
) {
  let check: RuleCheck | null = opts.problems ?? null;
  let engineDown = false;
  if (!check) {
    try {
      check = text.trim() ? await checkDraft(target.scope, target, text) : null;
    } catch (err) {
      if (!(err instanceof RulesEngineUnavailable)) throw err;
      engineDown = true;
    }
  }
  const names = new Map(listUsers().map((u) => [u.id, u.name]));
  const history = target.scope === 'template' && !target.templateId ? [] : ruleHistory(target.scope, target).map((v) => ({ ...v, by: v.created_by ? (names.get(v.created_by) ?? null) : null }));
  const event = target.eventId ? (await commissionEvents()).find((e) => e.id === target.eventId) : undefined;
  return c.html(
    <AdminRuleEditPage
      user={c.get('user')}
      target={target}
      text={text}
      check={check}
      labels={ruleLabels()}
      history={history}
      templates={listTemplates()}
      rewardTypes={listRewardTypes()}
      promoters={target.scope === 'event' ? event?.promoters : undefined}
      engineDown={engineDown}
      canWrite={ruleWriterEnabled()}
      description={opts.description}
      note={opts.note}
      ok={flash(c.req.query('ok'))}
      error={opts.error}
    />,
    opts.status ?? 200,
  );
}

app.get('/admin/rules', async (c) => {
  const events = await commissionEvents();
  const overrides = localDb
    .query<{ event_id: number; n: number }, []>(
      "SELECT event_id, count(DISTINCT user_id) AS n FROM rule_versions v WHERE scope = 'promoter_event' AND text <> '' AND id = (SELECT max(id) FROM rule_versions w WHERE w.scope = v.scope AND w.user_id = v.user_id AND w.event_id = v.event_id) GROUP BY event_id",
    )
    .all();
  const defaultRule = currentRule('default');
  let defaultWords: string[] = [];
  try {
    const checked = defaultRule ? await checkRule(defaultRule.text, ruleOutputs()) : null;
    defaultWords = checked ? ruleInWords(checked.lines, checked.trees, 'en') : [];
  } catch (err) {
    if (!(err instanceof RulesEngineUnavailable)) throw err;
  }
  return c.html(
    <AdminRulesPage
      user={c.get('user')}
      defaultText={defaultRule?.text ?? ''}
      defaultWords={defaultWords}
      templates={listTemplates()}
      rewardTypes={listRewardTypes()}
      events={events.map((e) => ({ ...e, hasRule: !!currentRule('event', { eventId: e.id }), overrides: overrides.find((o) => o.event_id === e.id)?.n ?? 0 }))}
      promotersWithRules={listUsers().filter((u) => currentRule('promoter', { userId: u.id }))}
      teamLeads={teamLeads().map((lead) => ({ lead, hasRule: !!currentRule('team', { userId: lead.id }) }))}
      canAsk={ruleWriterEnabled()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.get('/admin/rules/edit', async (c) => {
  const target = await ruleTargetOf((k) => c.req.query(k));
  if (!target) return c.notFound();
  const copy = target.scope === 'event' && c.req.query('copy') ? listTemplates().find((t) => t.id === Number(c.req.query('copy'))) : undefined;
  const saved = target.scope === 'template' && !target.templateId ? '' : (currentRule(target.scope, target)?.text ?? '');
  return renderRuleEdit(c, target, copy ? copy.text : saved);
});

app.post('/admin/rules/edit', async (c) => {
  const target = await ruleTargetOf((k) => c.req.query(k));
  if (!target) return c.notFound();
  const body = await c.req.parseBody();
  const admin = c.get('user');
  const back = ruleEditHref(target);
  if (body.remove === '1' && target.scope !== 'default') {
    if (target.scope === 'template') {
      if (target.templateId) removeTemplate(target.templateId);
      audit(c, 'admin.rule_template_removed', { by: admin.id, templateId: target.templateId });
      return c.redirect('/admin/rules?ok=rule_removed');
    }
    const version = saveRuleVersion(target.scope, target, '', admin.id);
    audit(c, 'admin.rule_removed', { by: admin.id, scope: target.scope, userId: target.userId, eventId: target.eventId, version });
    return c.redirect(`${back}&ok=rule_removed`);
  }
  const text = String(body.text ?? '').replace(/\r\n?/g, '\n').slice(0, RULE_MAX_LENGTH + 1);
  const name = String(body.name ?? '').trim();
  if (target.scope === 'template' && !name) return renderRuleEdit(c, target, text, { status: 400, error: 'Give the template a name.' });
  if (!text.trim()) return renderRuleEdit(c, target, text, { status: 400, error: 'Write the rule, or remove it.' });
  let check: RuleCheck;
  try {
    check = await checkDraft(target.scope, target, text);
  } catch (err) {
    if (!(err instanceof RulesEngineUnavailable)) throw err;
    return renderRuleEdit(c, target, text, { status: 400, error: flash('rules_down') });
  }
  // Nothing is saved while the rule has a problem.
  if (check.problems.length > 0) return renderRuleEdit(c, target, text, { status: 400, error: 'The rule has a problem: see To fix.', problems: check });
  if (target.scope === 'template') {
    const id = saveRuleTemplate(name, text, admin.id, target.templateId);
    audit(c, 'admin.rule_template_saved', { by: admin.id, templateId: id, name });
    return c.redirect(`${ruleEditHref({ scope: 'template', templateId: id })}&ok=rule_saved`);
  }
  const version = saveRuleVersion(target.scope, target, text, admin.id);
  audit(c, 'admin.rule_saved', { by: admin.id, scope: target.scope, userId: target.userId, eventId: target.eventId, version });
  return c.redirect(`${back}&ok=rule_saved`);
});

// "Ask Claude": Claude writes the rule from a description; it lands in the box, not saved.
const writeCounts = new Map<number, number[]>();
app.post('/admin/rules/write', async (c) => {
  const body = await c.req.parseBody();
  // From a rule's editor the rule is in the address; from the Rules page, in the form ("default", "event:12", "template").
  const [scope, id] = String(body.rule ?? '').split(':');
  const fromForm: Record<string, string | undefined> = { scope, event: scope === 'event' ? id : undefined };
  const target = await ruleTargetOf((k) => c.req.query(k) ?? fromForm[k]);
  if (!target || !ruleWriterEnabled()) return c.notFound();
  const admin = c.get('user');
  const description = String(body.description ?? '').trim().slice(0, 2000);
  const saved = target.scope === 'template' && !target.templateId ? '' : (currentRule(target.scope, target)?.text ?? '');
  if (!description) return renderRuleEdit(c, target, saved, { status: 400, error: 'Describe the deal first.' });
  // Each call costs money: 30 per admin per hour.
  const recent = (writeCounts.get(admin.id) ?? []).filter((at) => Date.now() - at < 3600_000);
  if (recent.length >= 30) return renderRuleEdit(c, target, saved, { status: 400, error: 'That is 30 rules written this hour. Try again later.', description });
  writeCounts.set(admin.id, [...recent, Date.now()]);
  const result = await writeRule(description);
  audit(c, 'admin.rule_written', { by: admin.id, scope: target.scope, eventId: target.eventId, ok: result.ok, descriptionLength: description.length });
  if (!result.ok) return renderRuleEdit(c, target, saved, { status: 400, error: result.error, description });
  return renderRuleEdit(c, target, result.written.rule.slice(0, RULE_MAX_LENGTH), {
    description,
    note: `${result.written.note} Check it below, then save.`.trim(),
  });
});

// Live check while typing (public/app.js): errors, the rule in words and the preview. Nothing is saved.
app.post('/admin/rules/check', async (c) => {
  const target = await ruleTargetOf((k) => c.req.query(k));
  if (!target) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; test?: unknown };
  const text = String(body.text ?? '').slice(0, RULE_MAX_LENGTH + 1);
  const test = body.test === '' || body.test == null ? undefined : Math.min(100_000, Math.max(0, Math.floor(Number(body.test))));
  try {
    const check = text.trim() ? await checkDraft(target.scope, target, text, Number.isFinite(test) ? test : undefined) : { problems: [], en: [], fr: [], outputs: [], preview: [] };
    return c.json({ ...check, labels: ruleLabels() });
  } catch (err) {
    if (!(err instanceof RulesEngineUnavailable)) throw err;
    return c.json({ error: 'rules_down' }, 503);
  }
});

app.post('/admin/rules/types', async (c) => {
  const body = await c.req.parseBody();
  const key = String(body.key ?? '').trim();
  const result = saveRewardType(key, String(body.label_en ?? ''), String(body.label_fr ?? ''), String(body.description_en ?? ''), String(body.description_fr ?? ''), body.guest_list === '1');
  if (result !== 'ok') return c.redirect('/admin/rules?error=reward_type#types');
  audit(c, 'admin.reward_type_saved', { by: c.get('user').id, key });
  return c.redirect('/admin/rules?ok=reward_type_saved#types');
});

// --- Notifications sent by admins: to one promoter, a team, or every promoter -------------------------

const promoters = () => listUsers().filter((u) => !u.is_admin);

function renderNotify(c: Context, opts: { status?: 400; error?: string; ok?: string; values?: Record<string, string> } = {}) {
  return c.html(
    <AdminNotifyPage
      user={c.get('user')}
      promoters={promoters()}
      leads={teamLeads().map((lead) => ({ lead, members: teamMembers(lead.id).length }))}
      sent={recentAnnouncements()}
      values={opts.values ?? {}}
      ok={opts.ok}
      error={opts.error}
    />,
    opts.status ?? 200,
  );
}

app.get('/admin/notifications', (c) => {
  const sent = Number(c.req.query('sent'));
  return renderNotify(c, { ok: Number.isInteger(sent) && c.req.query('sent') ? `Sent to ${sent === 1 ? '1 promoter' : `${sent} promoters`}.` : undefined });
});

app.post('/admin/notifications', async (c) => {
  const body = await c.req.parseBody();
  const values = Object.fromEntries(['to', 'user', 'lead', 'title', 'body', 'link'].map((k) => [k, String(body[k] ?? '').trim()]));
  const again = (error: string) => renderNotify(c, { status: 400, error, values });
  if (!values.title || values.title.length > ANNOUNCEMENT_TITLE_MAX) return again(`Give it a title, up to ${ANNOUNCEMENT_TITLE_MAX} characters.`);
  if (!values.body || values.body.length > ANNOUNCEMENT_BODY_MAX) return again(`Write the message, up to ${ANNOUNCEMENT_BODY_MAX} characters.`);
  const link = announcementLink(values.link!);
  if (link === undefined) return again('The link must be a page of this app, like /payouts.');
  let audience: string;
  let ids: number[];
  if (values.to === 'everyone') {
    audience = 'Every promoter';
    ids = promoters().map((u) => u.id);
  } else if (values.to === 'team') {
    const lead = teamLeads().find((u) => u.id === Number(values.lead));
    if (!lead) return again('Pick a team.');
    audience = `${lead.name}’s team`;
    ids = [lead.id, ...teamMembers(lead.id).filter((u) => !u.is_admin).map((u) => u.id)];
  } else if (values.to === 'one') {
    const promoter = promoters().find((u) => u.id === Number(values.user));
    if (!promoter) return again('Pick a promoter.');
    audience = promoter.name;
    ids = [promoter.id];
  } else {
    return again('Pick who it goes to.');
  }
  if (ids.length === 0) return again('Nobody to send it to.');
  const sent = sendAnnouncement(c.get('user').id, audience, ids, { title: values.title, body: values.body!, link });
  audit(c, 'admin.notification_sent', { by: c.get('user').id, audience, recipients: sent, title: values.title });
  return c.redirect(`/admin/notifications?sent=${sent}`);
});

// --- Banners for promoters ---------------------------------------------------------------------------

app.get('/admin/banners', async (c) =>
  c.html(
    <AdminBannersPage
      user={c.get('user')}
      general={generalBanner()}
      checkout={checkoutNotice()}
      events={await commissionEvents()}
      banners={allEventBanners()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  ),
);

app.post('/admin/banners/checkout', async (c) => {
  const message = parseBanner((await c.req.parseBody()).message);
  setCheckoutNotice(message);
  audit(c, 'admin.checkout_notice_changed', { by: c.get('user').id, message });
  return c.redirect(`/admin/banners?ok=${message ? 'banner_saved' : 'banner_removed'}#checkout`);
});

app.post('/admin/banners/general', async (c) => {
  const message = parseBanner((await c.req.parseBody()).message);
  setGeneralBanner(message);
  audit(c, 'admin.banner_changed', { by: c.get('user').id, message });
  return c.redirect(`/admin/banners?ok=${message ? 'banner_saved' : 'banner_removed'}#general`);
});

app.post('/admin/banners/event', async (c) => {
  const body = await c.req.parseBody();
  const eventId = Number(body.event_id);
  // Only for a draft or upcoming event that promoters see (one of them has a code on it).
  if (!(await commissionEvents()).some((e) => e.id === eventId)) return c.redirect('/admin/banners?error=media_event');
  const message = parseBanner(body.message);
  setEventBanner(eventId, message, c.get('user').id);
  audit(c, 'admin.banner_changed', { by: c.get('user').id, eventId, message });
  return c.redirect(`/admin/banners?ok=${message ? 'banner_saved' : 'banner_removed'}#event-${eventId}`);
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

// --- The index page (/p), for admins ---------------------------------------------------------------------

app.get('/admin/pages/index', async (c) => {
  const items = directoryItems();
  const promoters = items.flatMap((i) => (i.kind === 'promoter' && !i.user.page_hidden_at ? [i.user] : []));
  await Promise.race([Promise.all(promoters.map((u) => prepareShortLinks(u, [], { page: true }))), Bun.sleep(2500)]);
  return c.html(
    <DirectoryEditorPage
      user={c.get('user')}
      settings={directorySettings()}
      items={items}
      links={new Map(promoters.map((u) => [u.id, pageShortLink(u) ?? pageLink(u)!]))}
      version={directoryVersion()}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.post('/admin/pages/index', async (c) => {
  const body = await c.req.parseBody();
  const image = body.image;
  if (image instanceof File && image.size > 0) {
    if (!allowImageUpload(c.get('user').id)) return c.redirect('/admin/pages/index?error=photo_rate');
    const clean = await processImage(new Uint8Array(await image.arrayBuffer()), 'background');
    if (typeof clean === 'string') return c.redirect(`/admin/pages/index?error=background_${{ too_big: 'size', bad_type: 'type', too_many_pixels: 'pixels' }[clean]}`);
    await saveBackgroundImage(clean.bytes, clean.type);
  } else if (body.remove_image === '1') {
    await removeBackgroundImage();
  }
  const uploaded = image instanceof File && image.size > 0;
  const result = saveDirectorySettings({
    title: String(body.title ?? ''),
    tagline: String(body.tagline ?? ''),
    // A new photo is meant to be the background.
    background: uploaded ? 'image' : String(body.background ?? ''),
    color: String(body.color ?? ''),
    color2: String(body.color2 ?? ''),
    newPromoters: String(body.new_promoters ?? ''),
  });
  if (result !== 'ok') return c.redirect(`/admin/pages/index?error=${result === 'bad_color' ? 'bad_color' : 'index_no_image'}`);
  audit(c, 'admin.index_page_updated', { by: c.get('user').id, image: uploaded });
  return c.redirect('/admin/pages/index?ok=index_saved');
});

app.post('/admin/pages/index/add', async (c) => {
  const body = await c.req.parseBody();
  const kind = body.kind === 'heading' ? 'heading' : 'link';
  const result = addItem(kind, body.title, body.url);
  if (result !== 'ok') return c.redirect(`/admin/pages/index?error=index_${result}`);
  audit(c, 'admin.index_item_added', { by: c.get('user').id, kind });
  return c.redirect('/admin/pages/index?ok=index_added');
});

// From the drag and drop (public/app.js): the ids in their new order.
app.post('/admin/pages/index/order', async (c) => {
  const order = String((await c.req.parseBody()).order ?? '');
  const ids = order.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 5000);
  reorderItems(ids);
  return c.json({ ok: true });
});

app.post('/admin/pages/index/:id/visibility', async (c) => {
  const hidden = (await c.req.parseBody()).hidden === '1';
  if (!setItemHidden(Number(c.req.param('id')), hidden)) return c.notFound();
  return c.redirect(`/admin/pages/index?ok=index_saved`);
});

app.post('/admin/pages/index/:id/remove', (c) => {
  if (!removeItem(Number(c.req.param('id')))) return c.notFound();
  audit(c, 'admin.index_item_removed', { by: c.get('user').id, id: Number(c.req.param('id')) });
  return c.redirect('/admin/pages/index?ok=index_removed');
});

app.post('/admin/pages/index/:id', async (c) => {
  const body = await c.req.parseBody();
  const result = updateItem(Number(c.req.param('id')), body.title, body.url);
  if (result === 'missing') return c.notFound();
  if (result !== 'ok') return c.redirect(`/admin/pages/index?error=index_${result}`);
  return c.redirect('/admin/pages/index?ok=index_saved');
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
  const [board, team] = await Promise.all([leaderboard(range, sort, [lead, ...members]), teamTotals(lead, range)]);
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
// A promoter on a team sees the team's total tickets and sales, their team lead's included, and their
// own, but not who else is on the team or what they sold, no commission and no one else's dashboard.
app.get('/team', async (c) => {
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
      const team = (await teamTotals(lead, range)).find((t) => t.currency === board.currency);
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
  // Free tickets are counted by the rules: the track becomes the default rule's free_tickets line.
  setRuleLine('default', {}, FREE_TICKETS, trackOn(rules.tickets) ? `${FREE_TICKETS} = ${trackExpression(rules.tickets)}` : null, c.get('user').id);
  audit(c, 'admin.rewards_saved', { by: c.get('user').id, levels: rules.levels.length });
  return c.redirect('/admin/rewards?ok=rewards_saved');
});

app.post('/admin/rewards/reset', (c) => {
  saveRewardRules(null);
  const tickets = rewardRules().tickets;
  setRuleLine('default', {}, FREE_TICKETS, trackOn(tickets) ? `${FREE_TICKETS} = ${trackExpression(tickets)}` : null, c.get('user').id);
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
// The language being edited: French only for the emails that have it.
const emailLang = (type: EmailType, raw: string | undefined): 'en' | 'fr' => (raw === 'fr' && languagesOf(type).includes('fr') ? 'fr' : 'en');

app.get('/admin/emails/:type', (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  return c.html(
    <AdminEmailEditPage
      user={c.get('user')}
      type={type}
      lang={emailLang(type, c.req.query('lang'))}
      version={String(Date.now())}
      ok={flash(c.req.query('ok'))}
      error={flash(c.req.query('error'))}
    />,
  );
});

app.get('/admin/emails/:type/preview', (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  // Rendered in the language being edited: its wording and the fixed lines around it.
  return c.html(withLang(emailLang(type, c.req.query('lang')), () => renderEmail(type, sampleVars(type, c.get('user').name)).html));
});

app.post('/admin/emails/:type', async (c) => {
  const type = emailType(c.req.param('type'));
  if (!type) return c.notFound();
  const body = await c.req.parseBody();
  const language = emailLang(type, String(body.lang ?? ''));
  const back = `/admin/emails/${type}${language === 'fr' ? '?lang=fr&' : '?'}`;
  if (body.action === 'reset') {
    resetTemplate(type, language);
    audit(c, 'admin.email_reset', { by: c.get('user').id, type });
    return c.redirect(`${back}ok=reset`);
  }
  saveTemplate(
    type,
    {
    subject: String(body.subject ?? ''),
    heading: String(body.heading ?? ''),
    body: String(body.body ?? ''),
    button: String(body.button ?? ''),
    },
    language,
  );
  audit(c, 'admin.email_saved', { by: c.get('user').id, type, lang: language });
  if (body.action !== 'test') return c.redirect(`${back}ok=saved`);
  const me = c.get('user');
  const sent = await sendEmail(type, [{ name: me.name, email: me.email, lang: language }], sampleVars(type, me.name), getTemplate(type, language), { attempts: 1 });
  return c.redirect(`${back}${sent ? 'ok=test_sent' : 'error=test_failed'}`);
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
  // A payout is approved against numbers from the rules: not while the rules engine is down.
  if (status === 'paid' && !(await rulesEngineUp())) return c.redirect('/admin/payouts?error=rules_down');
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
// Once: the rates and free-ticket track used before rules become rules, with the same results.
migrateToRules();
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
// Keeps the "rules engine unavailable" notice and the payout check up to date, even when every number comes from the cache.
setInterval(() => void rulesEngineUp(), 60 * 1000);
void rulesEngineUp();

// Fail fast if the Hi.Events database is unreachable or the role lacks access.
await sql`SELECT 1 FROM promo_codes LIMIT 1`;
console.log(`Listening on :${config.port}`);

// Above the slowest request (one mail attempt with its 10-20 s timeouts), so nobody gets an empty reply.
export default { port: config.port, fetch: app.fetch, idleTimeout: 45 };
