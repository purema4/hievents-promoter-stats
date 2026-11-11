import type { Child } from 'hono/jsx';
import { avatarOf, initials } from './avatars';
import { maxUploadBytes } from './images';
import { placesVersion, promoterMap } from './places';
import { vendorVersion } from './vendor';
import { iconUrl } from './icons';
import { accentWarnings, brandVersion, getBrand, type Brand } from './brand';
import { chartCss, RangeLinks, SalesChart, type Range } from './chart';
import type { Leaderboard, Sort } from './leaderboard';
import { sessionsFor, type DeviceSession } from './auth';
import { hasTwoFactor } from './two-factor';
import { describeAdjustment, type Adjustment } from './adjustments';
import { alerts, type Prefs } from './alert-prefs';
import type { Rewards } from './rewards';
import { describeTrack, LIMITS, levelColors, rewardRules, trackOn, type Level, type LevelColor, type RewardRules, type Track } from './reward-rules';
import { config } from './config';
import { pageLink } from './links';
import { pageShortLink, shortDomain } from './short-links';
import { hiddenByTeam } from './promoter-page';
import { rateFor } from './commission';
import { findInvite, inviteState, type InviteLink } from './invites';
import { BANNER_MAX_LENGTH, generalBanner } from './banners';
import { jsVersion } from './js-version';
import type { RewardType } from './rules';
import { rulesEngineSeemsDown } from './rules-engine';
import { isTeamLead, teamCommissionPercentFor, type TeamCommission } from './teams';
import { codesHref, codesPerPage, type CodeFilter, type CodePage } from './promo-code-list';
import { usualRuleFor, type User } from './local-db';
import { describeRate, describeRule, formatMoney, formatPercent, type EventRule } from './money';
import { countPendingPayouts, type Balance, type PayoutRequest } from './payouts';
import { LinkField, PayoutHistory, RewardHistory } from './promoter-views';
import { countPendingRewards, describeReward, type RewardRequest } from './rewards';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, unreadCount, type Announcement, type Notification } from './notifications';
import { definitions, emailTypes, getReplyTo, getTemplate, isCustomized, languagesOf, type EmailType } from './email-templates';
import type { EmailLogEntry } from './mail';
import { lang, locale, plural, t, type Lang } from './i18n';
import { tokensFor, type ApiToken } from './api-tokens';

export const css = `
:root {
  --bg: #f6f6f4; --surface: #ffffff; --text: #1b1b1a; --muted: #6b6b66; --border: #e3e3de;
  --accent: #2f5bea; --accent-text: #ffffff; --danger: #c0392b; --ok: #1e7a46; --warn: #a05a00;
  --chart: #2f5bea;
  color-scheme: light;
}
/* Dark follows the device unless the account picked Light; picking Dark forces it. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #121211; --surface: #1c1c1a; --text: #ececea; --muted: #9a9a94; --border: #2e2e2b;
    --accent: #6f8cff; --accent-text: #0b0b0a; --danger: #ff7a6b; --ok: #5fd08f; --warn: #f0b35a;
    --chart: #6482f5;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #121211; --surface: #1c1c1a; --text: #ececea; --muted: #9a9a94; --border: #2e2e2b;
  --accent: #6f8cff; --accent-text: #0b0b0a; --danger: #ff7a6b; --ok: #5fd08f; --warn: #f0b35a;
  --chart: #6482f5;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
header { background: var(--surface); border-bottom: 1px solid var(--border); }
header .inner, main { max-width: 960px; margin: 0 auto; padding: 0 16px; }
/* Room for the phone's status bar and notch when running as an installed app. */
header { padding-top: env(safe-area-inset-top); position: sticky; top: 0; z-index: 20; }
.topbar .inner { max-width: 1280px; flex-wrap: nowrap; height: 56px; min-height: 0; padding-top: 0; padding-bottom: 0; }
.topbar .brand { min-width: 0; overflow: hidden; white-space: nowrap; }
.menu-button { display: none; color: var(--text); padding: 4px; margin-left: -4px; }
.topbar-end { display: flex; align-items: center; gap: 16px; margin-left: auto; }
.topbar-account { display: inline-flex; }
/* A standard-width app: header, sidebar and page sit in one centred column, even on very wide screens. */
.shell { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: 230px minmax(0, 1fr); align-items: start; }
.sidebar { position: sticky; z-index: 30; top: calc(57px + env(safe-area-inset-top)); height: calc(100vh - 57px - env(safe-area-inset-top)); width: 230px; overflow-y: auto; padding: 16px 12px calc(16px + env(safe-area-inset-bottom)); background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 18px; }
.sidebar .nav-me { display: none; }
.sidebar a { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 8px; color: var(--text); text-decoration: none; font-size: 15px; }
.sidebar a:hover { background: var(--bg); }
.sidebar a[aria-current] { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--accent); font-weight: 600; }
.nav-group { display: grid; gap: 2px; }
.nav-items { display: grid; gap: 2px; }
.nav-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding: 6px 10px; border-radius: 8px; list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; user-select: none; }
.nav-title::-webkit-details-marker { display: none; }
.nav-title:hover { background: var(--bg); color: var(--text); }
.nav-title:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.nav-chevron { transition: transform 0.15s ease; transform: rotate(-90deg); }
.nav-group[open] .nav-chevron { transform: none; }
.nav-bottom { margin-top: auto; display: grid; gap: 10px; }
.nav-advanced { margin: 0; padding: 0 2px; }
.lang-switch { margin: 0; display: grid; gap: 6px; padding: 4px 10px; }
.lang-label { font-size: 14px; color: var(--muted); }
.lang-options { display: flex; border: 1px solid var(--border); border-radius: 999px; padding: 2px; gap: 2px; }
.lang-options button { flex: 1; text-align: center; background: none; border: 0; border-radius: 999px; padding: 4px 8px; font: inherit; font-size: 13px; color: var(--muted); cursor: pointer; width: auto; }
.lang-options button:hover { color: var(--text); background: var(--bg); }
.lang-options button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); font-weight: 600; }
.account-menu .menu .lang-switch { border-top: 1px solid var(--border); margin-top: 4px; padding: 8px 10px 4px; }
.account-menu .menu .lang-options button { flex: 1; width: auto; padding: 4px 8px; display: block; text-align: center; font-size: 13px; }
.account-menu .menu .lang-options button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); }
.switch { display: flex; align-items: center; gap: 10px; width: 100%; background: none; border: 0; padding: 8px; border-radius: 8px; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
.switch:hover { background: var(--bg); color: var(--text); }
.switch-track { flex: none; width: 34px; height: 20px; border-radius: 999px; background: var(--border); position: relative; transition: background 0.15s ease; }
.switch-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 0.3); transition: transform 0.15s ease; }
.switch[aria-checked="true"] .switch-track { background: var(--accent); }
.switch[aria-checked="true"] .switch-thumb { transform: translateX(14px); }
.sidebar a.nav-cta { justify-content: center; margin: 2px 0 0; background: var(--accent); color: var(--accent-text); font-weight: 700; }
.sidebar a.nav-cta:hover { background: color-mix(in srgb, var(--accent) 85%, var(--text)); }
.nav-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--danger); color: #fff; font: 700 11px/20px system-ui; text-align: center; }
.nav-signout { padding: 0 10px; }
.nav-close { display: none !important; }
.nav-overlay { display: none; }
body.with-nav main { margin: 0; max-width: none; padding-left: 32px; padding-right: 32px; }
body.with-nav .site-footer { margin: 0; max-width: none; padding-left: 32px; }
/* The account menu under the avatar. */
.account-menu { position: relative; }
.account-menu summary { list-style: none; cursor: pointer; display: inline-flex; border-radius: 50%; }
.account-menu summary::-webkit-details-marker { display: none; }
.account-menu summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.account-menu .menu { position: absolute; right: 0; top: calc(100% + 10px); z-index: 40; width: 240px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / 0.18); padding: 8px; display: grid; gap: 2px; }
.account-menu .menu-who { padding: 8px 10px 10px; border-bottom: 1px solid var(--border); margin-bottom: 4px; display: grid; gap: 2px; }
.account-menu .menu-who span { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-menu .menu a, .account-menu .menu button { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-radius: 8px; color: var(--text); text-decoration: none; font: inherit; font-size: 15px; font-weight: 400; background: none; width: 100%; text-align: left; }
.account-menu .menu a:hover, .account-menu .menu button:hover { background: var(--bg); }
.account-menu .menu form { margin: 0; border-top: 1px solid var(--border); margin-top: 4px; padding-top: 4px; }
@media (max-width: 899px) {
  .menu-button { display: inline-flex; }
  .shell { display: block; }
  body.with-nav main { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
  body.with-nav .site-footer { padding-left: 16px; }
  .sidebar { position: fixed; top: 0; bottom: 0; left: 0; height: auto; width: min(300px, 86vw); padding-top: calc(16px + env(safe-area-inset-top)); padding-left: max(12px, env(safe-area-inset-left)); transform: translateX(-105%); transition: transform 0.2s ease; box-shadow: 0 0 40px rgb(0 0 0 / 0.25); }
  .sidebar .nav-me { display: grid; }
  .sidebar:target, .sidebar.open { transform: none; }
  .nav-close { display: block !important; align-self: flex-end; font-size: 28px; line-height: 1; padding: 0 8px !important; }
  .sidebar:target ~ .nav-overlay, .sidebar.open ~ .nav-overlay { display: block; position: fixed; inset: 0; z-index: 25; background: rgb(0 0 0 / 0.35); }
  body.with-nav main, body.with-nav .site-footer { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
header .inner { display: flex; align-items: center; gap: 8px 16px; min-height: 56px; flex-wrap: wrap; padding-top: 10px; padding-bottom: 10px; }
header .inner, main, .site-footer { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
header nav { flex-wrap: wrap; }
.nav-end { display: inline-flex; gap: 14px; align-items: center; }
.avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex: none; background: var(--bg); }
.avatar.small { width: 28px; height: 28px; }
.avatar.large { width: 72px; height: 72px; }
.avatar-initials { display: inline-grid; place-items: center; background: var(--accent); color: var(--accent-text); font-weight: 700; font-size: 15px; }
.avatar.small.avatar-initials { font-size: 11px; }
.avatar.large.avatar-initials { font-size: 26px; }
.who { display: flex; align-items: center; gap: 12px; }
.who h1 { margin: 0; }
.photo-row { display: flex; gap: 14px; align-items: center; }
header .brand { font-weight: 650; margin-right: auto; text-decoration: none; color: var(--text); display: flex; align-items: center; gap: 10px; }
/* Event covers are wide banners: a wide thumbnail keeps most of the picture and its title. */
.cover-thumb { width: 88px; height: 55px; flex: none; object-fit: cover; border-radius: 8px; background: var(--bg); }
.cover-hero { display: block; width: 100%; max-height: 260px; object-fit: cover; border-radius: 10px; margin-bottom: 16px; background: var(--bg); }
.install-banner { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; border-color: var(--accent); }
.install-banner img { border-radius: 10px; flex: none; }
.install-text { flex: 1 1 220px; display: grid; gap: 4px; }
.install-actions { display: flex; gap: 12px; align-items: center; }
.inline-icon { vertical-align: -3px; }
.install-steps { margin: 16px 0; }
.install-steps dl { display: grid; gap: 4px 0; margin: 0; }
.install-steps dt { font-weight: 600; margin-top: 8px; }
.install-steps dd { margin: 0; color: var(--muted); }
.template-list { display: grid; gap: 10px; }
a.template-item { display: flex; gap: 12px; align-items: center; justify-content: space-between; color: inherit; text-decoration: none; }
a.template-item:hover { border-color: var(--accent); }
.badge { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.badge.edited { color: var(--accent); border-color: var(--accent); }
/* Tabs above a page's content (Promoter pages → Index page) */
.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--border); margin: 0 0 16px; }
.tabs a { padding: 8px 12px; margin-bottom: -1px; color: var(--muted); text-decoration: none; font-weight: 600; border-bottom: 2px solid transparent; }
.tabs a:hover { color: var(--text); }
.tabs a[aria-current] { color: var(--accent); border-bottom-color: var(--accent); }
/* Index page editor: rows dragged by their handle (public/app.js) */
.dir-address { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.dir-address > :first-child { flex: 1; min-width: 220px; }
.dir-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.dir-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px 10px 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
.dir-row.off .dir-main > .who, .dir-row.off .dir-heading { opacity: 0.5; }
.dir-row.heading { background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.dir-row.dragging { box-shadow: 0 10px 28px rgb(0 0 0 / 0.18); border-color: var(--accent); position: relative; z-index: 1; }
.dir-handle { flex: none; display: grid; place-items: center; width: 36px; height: 40px; margin: -2px 0; padding: 0; color: var(--muted); background: none; border-radius: 8px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
/* A finger needs a bigger target than a mouse. */
@media (pointer: coarse) { .dir-handle { width: 44px; height: 44px; color: var(--text); background: var(--bg); } .dir-row { padding-left: 8px; } }
body.sorting { user-select: none; -webkit-user-select: none; }
.dir-handle:hover, .dir-handle:focus-visible { color: var(--text); background: var(--bg); }
.dir-row.dragging .dir-handle { cursor: grabbing; }
.dir-main { flex: 1; min-width: 0; display: grid; gap: 4px; padding-top: 4px; }
.dir-sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dir-heading { font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; font-size: 13px; padding-top: 6px; }
.dir-link-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; flex: none; background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--accent); }
.dir-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.dir-tags:empty { display: none; }
.dir-edit summary { cursor: pointer; color: var(--accent); font-size: 13px; width: fit-content; }
.dir-edit[open] { display: grid; gap: 10px; padding: 8px 0 4px; }
.dir-edit-form { display: grid; gap: 10px; max-width: 480px; }
.dir-toggle { flex: none; padding-top: 4px; }
.dir-status { min-height: 1.4em; margin: 6px 0 0; }
.dir-add { margin-top: 20px; }
.dir-fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
.dir-fieldset legend { padding: 0; margin-bottom: 6px; font-size: 14px; }
.dir-image-preview { max-width: 100%; max-height: 160px; border-radius: 8px; object-fit: cover; }
.email-editor { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
iframe.email-preview { width: 100%; height: 720px; border: 1px solid var(--border); border-radius: 10px; background: #f3f3f0; }
.placeholders code { font-size: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0 5px; margin: 2px 2px 2px 0; display: inline-block; }
.form-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
td.failed { color: var(--danger); }
.welcome { max-width: 620px; margin: 0 auto; }
.steps { display: flex; gap: 6px; margin: 0 0 20px; }
.steps span { flex: 1; height: 4px; border-radius: 999px; background: var(--border); }
.steps span.done { background: var(--accent); }
.welcome-hero { text-align: center; padding: 8px 0 16px; }
.welcome-hero .avatar { margin: 0 auto 12px; }
.how { display: grid; gap: 12px; margin: 16px 0; }
.how .card { display: flex; gap: 14px; align-items: flex-start; }
.how .num { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--accent); }
.welcome-actions { display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 20px; }
.card-actions { display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 10px; }
button.small, a.button.small { padding: 6px 12px; font-size: 14px; }
.links-card { margin-bottom: 20px; display: grid; gap: 10px; }
.links-card h2 { margin: 0; }
.link-row { display: grid; gap: 6px; }
.link-clicks { font-size: 14px; }
.link-field { display: flex; gap: 8px; flex-wrap: wrap; }
.link-field input { flex: 1 1 240px; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
button.copied { background: var(--ok); color: #fff; }
.codes-card { margin-bottom: 20px; display: grid; gap: 10px; }
.codes-card h2, .codes-card p { margin: 0; }
.code-list { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.code-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.link-code { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
button.code-copy { display: inline-flex; align-items: center; gap: 8px; }
.code-copy .code-value { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.03em; }
.code-copy .code-action { font-size: 12px; color: var(--muted); }
button.code-copy.copied .code-action { color: inherit; }
.dash-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: space-between; }
.dash-head h1 { margin: 0; }
table.leaderboard th a { color: var(--muted); text-decoration: none; }
table.leaderboard th a[aria-current] { color: var(--text); font-weight: 700; }
table.leaderboard td.rank { width: 40px; }
.rank-badge { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; font-weight: 700; font-size: 13px; color: var(--muted); }
.rank-1 { background: #f2c94c; color: #3d2c00; }
.rank-2 { background: #c9ced6; color: #22262b; }
.rank-3 { background: #d69a5c; color: #33200c; }
table.leaderboard a.who { color: inherit; text-decoration: none; gap: 10px; }
.lead-tag { margin-left: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); }
table.activity td { vertical-align: middle; white-space: nowrap; }
table.activity td .muted, table.activity td.muted { font-size: inherit; }
.level-badge.tiny { font-size: 11px; padding: 0 7px; border-width: 1px; margin-left: 8px; vertical-align: 1px; }
.device-list { display: grid; gap: 8px; }
.device { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.device strong { display: block; }
.qr { width: 200px; height: 200px; background: #fff; padding: 8px; border-radius: 10px; }
.qr svg { width: 100%; height: 100%; display: block; }
p code, td code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.secret { font: 600 15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; word-break: break-all; }
.recovery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; font: 600 15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px 16px; background: var(--bg); border-radius: 10px; margin: 8px 0; }
.setup { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
.setup-steps { flex: 1 1 260px; display: grid; gap: 10px; }
.adjust-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-items: start; }
.adjust-grid h3 { margin: 0; }
table.alert-settings td.check-cell, table.alert-settings th.check-cell { text-align: center; width: 110px; }
table.alert-settings input[type=checkbox] { width: 20px; height: 20px; }
table.alert-settings .hint { display: block; font-size: 13px; color: var(--muted); }
details.alert-box { margin-bottom: 20px; }
details.alert-box > summary { cursor: pointer; font-weight: 600; padding: 4px 0 12px; }
.bell { position: relative; display: inline-flex; color: var(--text); }
.bell-count { position: absolute; top: -6px; right: -9px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--danger); color: #fff; font: 700 11px/18px system-ui; text-align: center; }
.notification-list { display: grid; gap: 8px; }
a.notification, div.notification { display: grid; gap: 2px; color: inherit; text-decoration: none; }
a.notification:hover { border-color: var(--accent); }
a.notification.unread { border-left: 4px solid var(--accent); }
.notification-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0 8px; }
.notification-head h2 { margin: 0; }
.audience { display: grid; gap: 10px; }
.audience .check select { flex: 1; min-width: 0; }
.push-box { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 20px; }
.push-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.push-devices { flex-basis: 100%; margin: 0; }
.logo { height: 28px; width: auto; max-width: 140px; object-fit: contain; }
.login-brand { display: flex; align-items: center; gap: 12px; }
.login-brand .logo { height: 40px; max-width: 180px; }
.site-footer { max-width: 960px; margin: 0 auto; padding: 0 16px 32px; }
.swatch-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
input[type=color] { width: 56px; height: 40px; padding: 2px; }
.preview { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 16px; border-radius: 10px; border: 1px solid var(--border); }
.preview-dark { background: #1c1c1a; color: #ececea; }
.preview-dark button { background: var(--accent-dark); color: var(--accent-dark-text); }
.preview-dark a { color: var(--accent-dark); }
.warn { color: var(--warn); }
.logo-preview { max-height: 60px; max-width: 220px; object-fit: contain; background: var(--bg); border-radius: 8px; padding: 6px; }
header nav { display: flex; gap: 14px; align-items: center; font-size: 14px; }
main { padding-top: 24px; padding-bottom: 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 12px; }
.muted { color: var(--muted); font-size: 13px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin: 20px 0; }
.stat .value { font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stat .label { color: var(--muted); font-size: 13px; }
.stat.highlight { border-color: var(--accent); }
.stat.highlight .value { color: var(--accent); }
.rows { display: grid; gap: 10px; }
.row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.row .event { flex: 1 1 240px; min-width: 0; }
.row .event strong { display: block; overflow-wrap: anywhere; }
.row .numbers { display: flex; gap: 20px; margin-left: auto; font-variant-numeric: tabular-nums; }
.row .numbers div { text-align: right; }
.row .numbers .big { font-size: 22px; font-weight: 650; }
.code { display: inline-block; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0 6px; margin: 2px 4px 2px 0; }
.pending { color: var(--warn); }
form.stack { display: grid; gap: 12px; max-width: 420px; }
label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
label.check { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 14px; }
input, textarea, select { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; width: 100%; }
input[type=checkbox], input[type=radio] { width: auto; }
textarea { min-height: 80px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
button { font: inherit; font-weight: 600; background: var(--accent); color: var(--accent-text); border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer; justify-self: start; }
a.button.big { font-size: 17px; padding: 13px 22px; border-radius: 10px; }
a.button.secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
.payout-callout { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.payout-callout.ready { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.payout-callout-label { font-weight: 600; }
.payout-callout-amount { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
.payout-callout-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.payout-request { scroll-margin-top: 80px; }
#rewards { scroll-margin-top: 72px; } /* below the sticky header */
a.button { display: inline-block; font-weight: 600; background: var(--accent); color: var(--accent-text); border-radius: 8px; padding: 9px 16px; text-decoration: none; }
button.link { background: none; color: var(--accent); padding: 0; font-weight: 400; }
button.danger { background: var(--danger); }
.flash { border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; border: 1px solid; }
.flash.error { color: var(--danger); border-color: var(--danger); }
.flash.ok { color: var(--ok); border-color: var(--ok); }
.table-wrap { overflow-x: auto; }
/* Account → API & Claude: long commands and the table stay inside the card. */
.api-docs > * { min-width: 0; }
.api-docs table.activity td { white-space: normal; min-width: 200px; }
.api-docs table.activity td:first-child { white-space: nowrap; min-width: 0; }
@media (max-width: 600px) { .api-docs thead { display: none; } .api-docs table.activity tr, .api-docs table.activity td { display: block; min-width: 0; } .api-docs table.activity td:first-child { padding-bottom: 0; border-bottom: 0; } }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 13px; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.login { max-width: 380px; margin: 10vh auto 0; }
.two-col { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.inline { margin: 0; }
.codes-line { margin-bottom: 12px; }
h2.first, p.first { margin-top: 0; }
.event-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); }
.event-card { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.event-card:hover { border-color: var(--accent); }
a.event-card-main { display: grid; gap: 14px; color: inherit; text-decoration: none; }
a.event-card-main .event-main { min-width: 0; display: flex; gap: 12px; align-items: center; }
.event-card .card-actions { margin-top: auto; }
.event-stats { display: flex; flex-wrap: wrap; gap: 8px; font-variant-numeric: tabular-nums; }
.event-stats > span { flex: 1 1 auto; display: grid; align-content: start; gap: 2px; padding: 10px; border-radius: 8px; background: var(--bg); }
.event-stats .big { font-size: 19px; white-space: nowrap; }
.event-stats .primary { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
.event-stats .primary .big { color: var(--accent); font-size: 28px; line-height: 1.1; }
.banner { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 16px; padding: 10px 12px; border: 1px solid var(--warn); border-left-width: 4px; border-radius: 8px; background: color-mix(in srgb, var(--warn) 10%, var(--surface)); font-size: 14px; }
.banner p { margin: 0; min-width: 0; white-space: pre-line; overflow-wrap: anywhere; }
.banner svg { flex: none; margin-top: 1px; color: var(--warn); }
.banner-close { margin: -6px -6px -6px auto; flex: none; background: none; border: 0; color: var(--muted); font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.banner-close:hover { background: var(--bg); color: var(--text); }
.event-card .banner { margin: 0; }
.banner-form { display: grid; gap: 8px; justify-items: start; margin: 0; }
.banner-form textarea { font: inherit; min-height: 0; }
a.event-card-main .event { flex: 1; min-width: 0; display: grid; gap: 2px; }
a.event-card-main .event strong { overflow-wrap: anywhere; }
a.event-card-main .big { font-size: 22px; font-weight: 650; }
.crumbs { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.prev-next { display: flex; gap: 16px; margin-left: auto; }
.status { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid; }
.status.pending { color: var(--warn); }
.status.paid { color: var(--ok); }
.status.rejected { color: var(--muted); }
table.balance td { border: 0; padding: 4px 0; }
table.balance tr.total td { border-top: 1px solid var(--border); font-weight: 650; padding-top: 8px; }
.payout-block { margin-bottom: 16px; }
.payout-actions { display: grid; gap: 8px; min-width: 220px; }
.payout-actions form { display: flex; gap: 6px; }
.payout-actions input { padding: 6px 8px; }
.payout-actions button { padding: 6px 12px; white-space: nowrap; }
button.secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
input.code-input { font: 600 22px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.3em; text-align: center; }
.waiting { display: flex; gap: 10px; align-items: center; font-size: 14px; }
.waiting::before { content: ''; flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .waiting::before { animation: none; } }
details.code-fallback { margin: 8px 0 16px; }
h3 { font-size: 15px; margin: 0 0 12px; }
.progress { height: 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); overflow: hidden; margin: 10px 0 6px; }
.progress-fill { height: 100%; background: var(--chart); border-radius: 999px; }
.level-card { margin-bottom: 20px; }
.level-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.level-badge { font-weight: 700; font-size: 14px; padding: 2px 12px; border-radius: 999px; border: 2px solid var(--level, var(--border)); background: color-mix(in srgb, var(--level, var(--border)) 14%, var(--surface)); }
.level-c-gray { --level: #8a8a84; }
.level-c-bronze { --level: #b06d2c; }
.level-c-silver { --level: #8f97a3; }
.level-c-gold { --level: #c9971a; }
.level-c-teal { --level: #4f8f9e; }
.level-c-blue { --level: var(--accent); }
.level-c-purple { --level: #8a5cd6; }
.level-c-pink { --level: #d0559b; }
.level-c-red { --level: var(--danger); }
.level-c-green { --level: var(--ok); }
.level-next { margin: 0 0 8px; }
.level-preview { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 0; }
.rules-table { width: auto; }
.rules-table td { padding: 6px 8px 6px 0; border: 0; }
.rules-table input:not([type]) { min-width: 170px; }
.rules-table input[type=number] { min-width: 90px; }
.rules-table select { min-width: 130px; }
.rules-now p { margin: 0; }
.rules-form { margin-top: 16px; }
.rules-table th { padding: 0 6px 4px 0; border: 0; }
.rules-table input[type=number] { max-width: 130px; }
.repeat-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.repeat-row input[type=number] { width: 100px; }
.repeat-row input:not([type]) { width: 160px; }
.reset-rules { margin-top: 16px; }
.unlocks { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
.unlocks li::before { content: '○'; display: inline-block; width: 1.4em; }
.unlocks li.ready { color: var(--text); font-weight: 600; }
.unlocks li.ready::before { content: '●'; color: var(--ok); }
.chip.warn { color: var(--warn); border-color: var(--warn); margin-left: 6px; }
.chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; margin: 2px 0; border-radius: 999px; color: var(--ok); border: 1px solid var(--ok); }
.reward-card { display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.reward-card > div { flex: 1; }
.reward-list { display: grid; gap: 18px; }
.reward-row { display: grid; gap: 8px; }
.reward-form { display: grid; gap: 8px; grid-template-columns: 1fr auto; margin: 0; }
.reward-form .wide { grid-column: 1 / -1; }
.reward-form button { justify-self: start; }
@media (max-width: 480px) { .reward-form { grid-template-columns: 1fr; } }
.account-form { display: grid; gap: 16px; margin-bottom: 8px; }
.stack-card { display: grid; gap: 12px; align-content: start; }
.stack-card h2 { margin: 8px 0 0; }
.stack-card h2.first { margin-top: 0; }
.field-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
.theme-choice { display: flex; gap: 16px; flex-wrap: wrap; }
.profile dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; font-size: 14px; }
.profile dt { color: var(--muted); }
.profile dd { margin: 0; overflow-wrap: anywhere; }
details.code-fallback summary { cursor: pointer; color: var(--muted); font-size: 14px; margin-bottom: 12px; }
/* The promoter's page settings and the dashboard card. */
.page-card { margin-bottom: 20px; display: grid; gap: 10px; }
.page-card h2, .page-card p { margin: 0; }
.my-page { grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: start; margin-bottom: 16px; }
.my-page-links { display: grid; gap: 12px; min-width: 0; }
.my-page-qr { margin: 0; display: grid; gap: 6px; justify-items: center; max-width: 200px; text-align: center; }
.my-page-qr img { width: 180px; height: 180px; border-radius: 12px; background: #fff; padding: 8px; border: 1px solid var(--border); }
.page-link-row { display: grid; gap: 4px; }
.page-link-label { font-size: 13px; color: var(--muted); font-weight: 600; }
.page-event-list { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.hide-page { margin: 20px 0 8px; }
@media (max-width: 640px) {
  .my-page { grid-template-columns: 1fr; }
  .my-page-qr { justify-self: center; }
}

.page-links { display: grid; gap: 6px; }
.page-link { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.page-link a { overflow-wrap: anywhere; }
.hidden-page .page-link a { color: var(--muted); text-decoration: line-through; }
table.page-table td { vertical-align: top; }
.rename-short { margin-top: 6px; font-size: 14px; }
.rename-short summary { cursor: pointer; color: var(--accent); }
.rename-form { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.rename-field { display: flex; align-items: center; gap: 4px; }
.rename-field input { width: 180px; }
.rename-short p { margin: 6px 0 0; }
table.page-table a.who { color: inherit; text-decoration: none; gap: 10px; }
.page-link-kind { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); min-width: 34px; }
@media (min-width: 700px) { table.page-table a.who { white-space: nowrap; } }
/* An admin viewing as a promoter: a bar fixed at the bottom of every page. */
.impersonation-banner { position: fixed; z-index: 60; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; gap: 12px 16px; flex-wrap: wrap; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: #8a4b00; color: #fff; font-size: 14px; box-shadow: 0 -4px 16px rgb(0 0 0 / 0.2); }
.impersonation-banner form { margin: 0; }
.impersonation-banner button { background: #fff; color: #111; padding: 6px 14px; font-size: 14px; }
body.impersonating { padding-bottom: 96px; }
body.impersonating .sidebar { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
/* Teams (/admin/teams) and the team field on a promoter's admin page. */
.inline-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.inline-form select { flex: 1 1 200px; width: auto; min-width: 0; }
.team-card { margin-top: 16px; }
.team-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.team-head a.who, .team-members a.who { color: inherit; text-decoration: none; gap: 10px; }
.team-members { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 4px; }
.team-members li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 0; border-top: 1px solid var(--border); }
.team-members form { margin: 0; }
.team-actions { display: grid; gap: 10px; margin-top: 12px; }
.team-rate { margin: 12px 0 0; }
/* Invite links */
.invite-form { margin-top: 8px; }
.invite-card { display: grid; gap: 8px; }
.invite-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.invite-meta { margin: 0; }
.invite-card form { margin: 0; }
.invite-state { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--bg); color: var(--muted); }
.invite-state.invite-open { color: var(--ok); }
.invite-closed strong { color: var(--muted); }
/* Pay & rewards → Commissions */
.rate-card { margin-top: 16px; scroll-margin-top: 72px; }
.rate-card > p.muted { margin: 2px 0 8px; }
.rate-rows { display: grid; }
.rate-row { display: flex; justify-content: space-between; align-items: center; gap: 8px 16px; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid var(--border); margin: 0; }
.rate-row a.who { color: inherit; text-decoration: none; gap: 10px; }
.rate-row a.who > span { display: grid; }
.rate-now { font-size: 13px; }
.rate-fields { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rate-fields select { width: auto; }
.rate-fields input { width: 110px; }
/* Promoter maps (admin dashboard, team pages) */
.map-card { display: grid; gap: 8px; }
.map-card p { margin: 0; }
.promoter-map { height: 400px; border-radius: 8px; overflow: hidden; background: var(--bg); z-index: 0; }
.map-places { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; align-items: start; }
.map-place { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.map-place summary { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; min-height: 44px; cursor: pointer; font-weight: 600; list-style: none; }
.map-place summary::-webkit-details-marker { display: none; }
.map-place summary::after { content: '▸'; color: var(--muted); }
.map-place[open] summary::after { content: '▾'; }
.map-place summary span:first-child { flex: 1; }
.map-place[open], .map-place.selected { border-color: var(--accent); }
.map-count { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--bg); color: var(--muted); }
/* Promoters per place: one blue, light to dark, the same on the map pins, the list and the legend (tiles are light in both themes). */
.map-pin, .leaflet-marker-icon.map-pin { display: grid; place-items: center; border-radius: 999px; border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); font: 700 12px/1 system-ui, sans-serif; }
.tier-1 { background: #86b6ef; color: #0d366b; }
.tier-2 { background: #3987e5; color: #ffffff; }
.tier-3 { background: #1c5cab; color: #ffffff; }
.tier-4 { background: #0d366b; color: #ffffff; }
.map-count.tier-1, .map-count.tier-2, .map-count.tier-3, .map-count.tier-4 { min-width: 24px; text-align: center; }
.map-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.map-legend li { display: flex; align-items: center; gap: 6px; }
.map-legend .map-pin { width: 18px; height: 18px; border-width: 1px; box-shadow: none; }
.map-missing summary { font-weight: 500; color: var(--muted); }
.map-note { padding: 0 12px; }
.map-people { list-style: none; margin: 0; padding: 0 12px 10px; display: grid; gap: 2px; }
.map-people a.who { color: inherit; text-decoration: none; gap: 10px; padding: 6px 0; min-height: 40px; }
.map-people a.who:hover span { text-decoration: underline; }
.map-popup strong { display: block; margin-bottom: 4px; }
.map-popup ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 220px; overflow-y: auto; }
.map-popup a { display: block; padding: 6px 0; min-height: 32px; }
@media (max-width: 640px) {
  .promoter-map { height: 300px; }
  .map-places { grid-template-columns: 1fr; }
}
.commission-field { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
/* Events → Promo codes */
.filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0 0 12px; }
.filter-bar input[type='search'] { flex: 1 1 240px; width: auto; }
.filter-bar select { width: auto; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px; }
/* Events → Media drives */
.media-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0; }
.media-form input { flex: 1 1 280px; width: auto; }
.team-rate label { display: grid; gap: 6px; }
.team-rate-row { display: flex; gap: 8px; align-items: center; }
.team-rate-row input { width: 120px; }
.team-actions form { margin: 0; }
button.link.danger-link { color: var(--danger); text-align: left; }
/* Promoters' public pages (/p/<alias>): link-in-bio style, built for phones first. */
body.lp { min-height: 100vh; min-height: 100dvh; background: var(--bg); overflow-x: hidden; -webkit-font-smoothing: antialiased; }
.lp-backdrop { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.lp-backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(56px) saturate(1.5); transform: scale(1.35); opacity: 0.6; }
.lp-backdrop::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 15%, transparent) 0%, color-mix(in srgb, var(--bg) 70%, transparent) 45%, var(--bg) 90%); }
.lp-backdrop.plain { background: radial-gradient(120% 55% at 50% 0%, color-mix(in srgb, var(--accent) 38%, var(--bg)) 0%, var(--bg) 100%); }
.lp-backdrop.plain::after { display: none; }
.lp-wrap { position: relative; z-index: 1; max-width: 520px; margin: 0 auto; padding: calc(32px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom)); display: grid; gap: 22px; }
.lp-share { position: absolute; z-index: 2; top: calc(14px + env(safe-area-inset-top)); right: 16px; width: 44px; height: 44px; padding: 0; border-radius: 50%; display: grid; place-items: center; color: var(--text); background: color-mix(in srgb, var(--surface) 72%, transparent); border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.lp-share.copied { background: var(--ok); color: #fff; }
.lp-head { display: grid; justify-items: center; gap: 8px; text-align: center; padding-top: 18px; }
.lp-avatar { width: 108px; height: 108px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 4px var(--bg), 0 0 0 7px var(--accent), 0 16px 40px rgb(0 0 0 / 0.28); }
.lp-initials { display: grid; place-items: center; background: var(--accent); color: var(--accent-text); font: 800 38px/1 system-ui, sans-serif; }
.lp-name { font-size: clamp(26px, 7vw, 32px); line-height: 1.1; font-weight: 800; letter-spacing: -0.025em; margin: 12px 0 0; overflow-wrap: anywhere; }
.lp-tagline { margin: 0; color: var(--muted); font-size: 15px; max-width: 34ch; }
.lp-pill { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; padding: 7px 14px; border-radius: 999px; color: var(--text); text-decoration: none; font-weight: 600; font-size: 14px; background: color-mix(in srgb, var(--surface) 72%, transparent); border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.lp-events { display: grid; gap: 16px; }
.lp-event { display: grid; color: var(--text); text-decoration: none; background: var(--surface); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 22px; overflow: hidden; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.12); transition: transform 0.18s ease, box-shadow 0.18s ease; -webkit-tap-highlight-color: transparent; }
a.lp-event:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgb(0 0 0 / 0.06), 0 20px 44px rgb(0 0 0 / 0.18); }
a.lp-event:active { transform: scale(0.985); }
a.lp-event:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.lp-cover { position: relative; display: block; aspect-ratio: 16 / 9; background: color-mix(in srgb, var(--accent) 22%, var(--surface)); }
.lp-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
.lp-cover.blank { aspect-ratio: auto; height: 76px; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, var(--text))); }
.lp-date { position: absolute; left: 12px; top: 12px; display: grid; justify-items: center; min-width: 52px; padding: 6px 10px 7px; border-radius: 14px; color: #fff; background: rgb(10 10 10 / 0.6); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); line-height: 1.05; }
.lp-month { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.85; }
.lp-day { font-size: 22px; font-weight: 800; }
.lp-next { position: absolute; right: 12px; top: 12px; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: 0.02em; color: var(--accent-text); background: var(--accent); box-shadow: 0 4px 14px rgb(0 0 0 / 0.25); }
.lp-body { display: grid; gap: 6px; padding: 14px 16px 16px; }
.lp-title { font-size: 19px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.lp-when { font-size: 14px; color: var(--muted); }
.lp-cta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 8px; padding: 13px 16px; border-radius: 14px; font-weight: 800; color: var(--accent-text); background: var(--accent); }
.lp-cta-code { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; opacity: 0.9; }
.lp-cta.muted-cta { justify-content: center; color: var(--text); background: var(--bg); border: 1px dashed var(--border); font-weight: 600; }
.lp-empty { margin: 0; padding: 28px 20px; text-align: center; color: var(--muted); background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid var(--border); border-radius: 22px; }
.lp-share-wide { justify-self: center; display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 999px; color: var(--text); background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.lp-share-wide.copied { background: var(--ok); color: #fff; border-color: transparent; }
.lp-footer { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 600; }
.lp-footer img { height: 22px; width: auto; border-radius: 4px; }
.lp-missing { padding-top: 22vh; }
.lp-section { margin: 14px 4px 0; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.lp-section:first-child { margin-top: 0; }
.lp-link-icon { display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--accent); }
.lp-people { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.lp-person { display: flex; align-items: center; gap: 14px; padding: 12px 16px 12px 12px; color: var(--text); text-decoration: none; background: var(--surface); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 18px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.08); transition: transform 0.18s ease; -webkit-tap-highlight-color: transparent; }
.lp-person:hover { transform: translateY(-2px); }
.lp-person:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.lp-person > svg { flex: none; color: var(--muted); }
.lp-person-avatar { flex: none; width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.lp-person-avatar.lp-initials { font-size: 18px; }
.lp-person-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.lp-person-name { font-weight: 800; overflow-wrap: anywhere; }
.lp-person-link { font-size: 14px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .lp-event, .lp-person { transition: none; } a.lp-event:hover, a.lp-event:active, .lp-person:hover { transform: none; } }
${chartCss}
/* Pay & rewards → Rules */
.rule-editor { display: grid; gap: 20px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); align-items: start; }
@media (max-width: 899px) { .rule-editor { grid-template-columns: 1fr; } }
.rule-editor form { display: grid; gap: 10px; margin: 0; }
.rule-editor textarea.rule-text { min-height: 240px; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; overflow-wrap: normal; overflow-x: auto; tab-size: 2; }
.rule-panel { display: grid; gap: 14px; position: sticky; top: 72px; }
.rule-panel h3 { margin: 0 0 6px; font-size: 14px; }
.rule-panel ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14px; }
.rule-problems li { color: var(--danger); }
.rule-ok { color: var(--ok); font-size: 14px; margin: 0; }
.rule-panel table td, .rule-panel table th { padding: 6px 8px; }
.rule-panel tr.made-up td { color: var(--muted); }
.rule-test { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--muted); }
.rule-test input { width: 90px; }
.rule-vars dt { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 8px; }
.rule-vars dd { margin: 0; color: var(--muted); font-size: 13px; }
.rule-history li { font-size: 13px; }
.rule-pending { color: var(--muted); font-size: 13px; margin: 0; }
/* Payouts & rewards: the rewards shop */
.shop { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; margin: 0; }
/* On phones the cart is a sheet that slides up from the bottom, opened from a bar that stays at the bottom
   of the screen (set up by app.js: without scripts the cart simply comes after the events). */
@media (max-width: 899px) {
  .shop { grid-template-columns: 1fr; }
  .shop .cart { position: static; }
  .shop.sheet .cart { position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 70; max-height: 85vh; overflow-y: auto; border-radius: 16px 16px 0 0; border-bottom: 0; padding-bottom: calc(16px + env(safe-area-inset-bottom)); box-shadow: 0 -12px 40px rgb(0 0 0 / 0.3); transform: translateY(105%); transition: transform 0.25s ease; visibility: hidden; }
  .shop.sheet .cart.open { transform: none; visibility: visible; }
  .shop.sheet .cart-close { display: grid; }
  .shop.sheet .cart-jump:not([hidden]) { display: flex; }
  .shop.sheet { padding-bottom: 72px; }
}
@media (prefers-reduced-motion: reduce) { .shop.sheet .cart { transition: none; } }
.shop-events { display: grid; gap: 16px; align-content: start; }
.shop-event-card h3 { margin: 0; font-size: 18px; }
.shop-event-card { overflow: hidden; }
.shop-event-head { position: relative; overflow: hidden; display: flex; gap: 14px; align-items: center; margin: -16px -16px 8px; padding: 16px; }
.shop-event-head > :not(.shop-event-backdrop) { position: relative; z-index: 1; }
.shop-event-head p.muted { margin: 2px 0 0; color: var(--text); opacity: 0.75; }
.shop-event-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(28px) saturate(1.6); transform: scale(1.4); opacity: 0.45; pointer-events: none; }
.with-cover .shop-event-head { border-bottom: 1px solid var(--border); }
.shop-event-head .cover-thumb { width: 104px; height: 65px; border-radius: 10px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.25); }
.shop-event-card > p.muted { margin: 2px 0 10px; }
.bank-card { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
table.shop-table { width: 100%; }
table.shop-table td { vertical-align: middle; padding: 12px 8px; }
table.shop-table tr:last-child td { border-bottom: 0; }
table.shop-table tr.locked { opacity: 0.6; }
/* A reward in the cart: the whole row is tinted, never its cells one by one (they wrap on phones). */
table.shop-table tr.in-cart { background: color-mix(in srgb, var(--accent) 8%, transparent); }
table.shop-table tr.in-cart td { background: none; }
@keyframes cart-pop { 0% { transform: translateY(12px) scale(0.96); } 60% { transform: translateY(-3px) scale(1.02); } 100% { transform: none; } }
.cart-jump.pop { animation: cart-pop 0.35s ease-out; }
@media (prefers-reduced-motion: reduce) { .cart-jump.pop { animation: none; } }
td.shop-avail { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.shop-avail .big { font-size: 22px; font-weight: 650; }
td.shop-add { width: 1%; text-align: right; white-space: nowrap; }
.stepper:not([hidden]) { display: inline-flex; align-items: stretch; height: 44px; border-radius: 999px; overflow: hidden; background: var(--accent); color: var(--accent-text); box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent); }
.stepper button { display: grid; place-items: center; width: 44px; padding: 0; border-radius: 0; background: transparent; color: inherit; }
.stepper button:hover:not(:disabled) { background: rgb(255 255 255 / 0.14); }
.stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
.stepper-n { display: grid; place-items: center; min-width: 40px; padding: 0 6px; font-weight: 700; font-size: 17px; font-variant-numeric: tabular-nums; border-left: 1px solid rgb(255 255 255 / 0.35); border-right: 1px solid rgb(255 255 255 / 0.35); }
/* Narrow screens: the reward on its own line, then how many are available and the button. */
@media (max-width: 600px) {
  table.shop-table tr { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); border-radius: 10px; }
  table.shop-table tr:last-child { border-bottom: 0; }
  table.shop-table td { border-bottom: 0; padding: 4px 8px; }
  table.shop-table td:first-child { grid-column: 1 / -1; }
  td.shop-avail { text-align: left; }
}
button.plus[hidden] { display: none; }
button.plus { display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; border-radius: 50%; }
button.plus svg, button.step svg { display: block; }
button.plus:disabled { opacity: 0.35; cursor: not-allowed; }
.cart-jump { display: none; position: fixed; left: 12px; right: 12px; width: calc(100% - 24px); bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 65; justify-content: center; align-items: center; gap: 8px; padding: 14px 16px; border-radius: 12px; background: var(--accent); color: var(--accent-text); font-weight: 700; font-size: 16px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
.cart-backdrop { position: fixed; inset: 0; z-index: 68; background: rgb(0 0 0 / 0.5); }
.cart-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cart-head h3 { margin: 0; }
.cart-close { display: none; place-items: center; width: 36px; height: 36px; padding: 0; border-radius: 50%; font-size: 22px; line-height: 1; background: var(--bg); color: var(--text); border: 1px solid var(--border); }
.cart-line { display: grid; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.cart-line:last-child { border-bottom: 0; }
.cart-steps { display: flex; gap: 8px; align-items: center; }
button.step { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 50%; background: var(--bg); color: var(--text); border: 1px solid var(--border); }
.cart-n { min-width: 20px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.cart-steps .link { margin-left: auto; }
.cart-field { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.shop-type { font-size: 20px; font-weight: 700; line-height: 1.2; }
.shop-what { margin: 0; font-size: 14px; }
.shop-event { margin: 0; font-size: 14px; }
.who { margin: 0; font-size: 14px; font-weight: 600; color: var(--accent); }
.checkout-lines { display: grid; gap: 12px; margin: 16px 0; }
.checkout-line { display: flex; gap: 16px; align-items: flex-start; }
.checkout-qty { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 56px; }
.checkout-body { display: grid; gap: 6px; min-width: 0; }
.checkout-type { font-size: 22px; font-weight: 700; }
.checkout-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 4px 0 0; font-size: 15px; }
.checkout-facts dt { color: var(--muted); }
.checkout-facts dd { margin: 0; }
.who-strong { font-weight: 700; }
.checkout-confirm { display: grid; gap: 12px; margin: 16px 0; }
.checkout-confirm h2 { margin: 12px 0 0; }
.checkout-qty { display: flex; align-items: center; gap: 6px; }
.checkout-qty select { font: inherit; font-size: 22px; font-weight: 700; padding: 2px 6px; width: auto; }
.checkout-payout { display: grid; gap: 12px; }
.checkout-include { font-size: 17px; }
.payout-fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); align-items: start; }
.payout-fields label { display: grid; gap: 4px; }
.payout-fields p { grid-column: 1 / -1; margin: 0; }
/* Not ticked: the payout fields stay, dimmed, and are not sent as a request. */
.checkout-payout:has(input[name="payout"]:not(:checked)) .payout-fields { opacity: 0.45; }
.checkout-actions { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.notice-text { white-space: pre-line; font-size: 16px; }
.cart { position: sticky; top: 72px; display: grid; gap: 10px; }
.cart h3 { margin: 0; }
.cart-lines { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 14px; }
.cart-lines li { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.write-card { margin-bottom: 16px; }
.write-card summary { cursor: pointer; font-weight: 600; }
.write-card form { margin-top: 10px; }
.deal-card { margin-bottom: 20px; display: grid; gap: 8px; }
.deal-card h2, .deal-card p { margin: 0; }
.deal-card ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
pre.code-block { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; white-space: pre; }

`;

// Changes whenever the CSS does, so browsers never keep a stale copy.
export const cssVersion = new Bun.CryptoHasher('sha256').update(css).digest('hex').slice(0, 10);

export function formatDate(date: Date | null, timezone: string | null): string {
  if (!date) return t('No date', 'Pas de date');
  try {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone ?? 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
  }
}


function BrandMark(props: { brand: Brand }) {
  return (
    <>
      {props.brand.logoType && <img class="logo" src={`/brand/logo?v=${props.brand.updatedAt}`} alt="" />}
      <span>{props.brand.name}</span>
    </>
  );
}

// Always on screen while an admin views the app as a promoter.
function ImpersonationBanner(props: { user: User }) {
  const until = new Intl.DateTimeFormat('en-CA', { timeStyle: 'short', timeZone: config.timezone }).format(new Date(props.user.impersonator!.until * 1000));
  return (
    <div class="impersonation-banner" role="status">
      <span>
        <strong>Viewing as {props.user.name}.</strong> You see what they see, but nothing can be changed. Ends at {until}
      </span>
      <form method="post" action="/impersonate/stop">
        <button type="submit">Back to my account</button>
      </form>
    </div>
  );
}

// What a change gets while viewing as a promoter.
export function ReadOnlyPage(props: { user: User }) {
  return (
    <Layout title={t('Viewing only', 'Consultation seulement')} user={props.user}>
      <h1>{t('Viewing only', 'Consultation seulement')}</h1>
      <p>
        {t(
          `You are viewing the app as ${props.user.name}, so changes are turned off: nothing was sent or saved. To change something for them, go back to your account and use their admin page.`,
          `Tu consultes l’app en tant que ${props.user.name}, donc les modifications sont désactivées : rien n’a été envoyé ni enregistré. Pour changer quelque chose pour cette personne, retourne à ton compte et utilise sa page d’admin.`,
        )}
      </p>
      <p>
        <a href="/">{t('Back to their dashboard', 'Retour à son tableau de bord')}</a>
      </p>
    </Layout>
  );
}

/** A notice from the team, kept as they typed it: the text is escaped and its line breaks kept. */
export function Banner(props: { text: string; label: string; dismissible?: boolean }) {
  // Closed for good on this device, until the text changes (app.js keeps the key).
  const key = props.dismissible ? `banner:${Bun.hash(props.text).toString(36)}` : undefined;
  return (
    <div class="banner" role="note" aria-label={props.label} data-banner-key={key}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z" />
      </svg>
      <p>{props.text}</p>
      {key && (
        <button type="button" class="banner-close" data-banner-close hidden aria-label={t('Close this notice', 'Fermer cet avis')}>
          ×
        </button>
      )}
    </div>
  );
}

export function Layout(props: {
  title: string;
  user?: User;
  children: Child;
  hideInstallBanner?: boolean;
  promoterView?: boolean; // an admin seeing a promoter's page gets its banner too
}) {
  const brand = getBrand();
  const notice = props.user && (!props.user.is_admin || props.promoterView) ? generalBanner() : '';
  // The last call to the rules engine failed: the numbers on this page may be the last ones known.
  const rulesDown = !!props.user && rulesEngineSeemsDown();
  return (
    <html lang={lang()} data-theme={props.user?.theme === 'light' || props.user?.theme === 'dark' ? props.user.theme : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <title>{props.title === brand.name ? brand.name : `${props.title} · ${brand.name}`}</title>
        <link rel="stylesheet" href={`/app.css?v=${cssVersion}`} />
        <link rel="stylesheet" href={`/brand.css?v=${brandVersion()}`} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href={iconUrl('icon.svg')} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={iconUrl('icon-180.png')} />
        <meta name="theme-color" content={brand.accent} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={brand.name} />
        <script src={`/app.js?v=${jsVersion}`} defer></script>
      </head>
      <body class={props.user ? (props.user.impersonator ? 'with-nav impersonating' : 'with-nav') : undefined}>
        {props.user?.impersonator && <ImpersonationBanner user={props.user} />}
        {props.user && (
          <header class="topbar">
            <div class="inner">
              {/* Opens the sidebar on phones; works without scripts through the #sidebar target. */}
              <a class="menu-button" href="#sidebar" aria-label={t('Menu', 'Menu')} aria-controls="sidebar">
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <path fill="currentColor" d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
                </svg>
              </a>
              <a class="brand" href="/">
                <BrandMark brand={brand} />
              </a>
              <span class="topbar-end">
                <Bell userId={props.user.id} />
                <AccountMenu user={props.user} />
              </span>
            </div>
          </header>
        )}
        {props.user ? (
          <div class="shell">
            <Sidebar user={props.user} />
            <a class="nav-overlay" href="#" aria-label={t('Close the menu', 'Fermer le menu')} tabindex={-1}></a>
            <div>
              <main>
                {notice && <Banner text={notice} label={t('Notice for all promoters', 'Avis à tous les promoteurs')} dismissible />}
                {rulesDown && (
                  <Banner
                    text={
                      props.user.is_admin
                        ? 'The rules engine is not available: commissions and rewards shown are the last ones known, and payouts cannot be approved until it is back.'
                        : t(
                            'Some numbers may be a little behind right now. They will catch up shortly.',
                            'Certains chiffres peuvent avoir un peu de retard en ce moment. Ils vont se mettre à jour sous peu.',
                          )
                    }
                    label={t('Rules engine unavailable', 'Calculs temporairement indisponibles')}
                  />
                )}
                {!props.user.app_installed_at && !props.user.impersonator && !props.hideInstallBanner && <InstallBanner brand={brand} />}
                {props.children}
              </main>
              {brand.footer && <footer class="site-footer muted">{brand.footer}</footer>}
            </div>
          </div>
        ) : (
          <>
            <main>{props.children}</main>
            {brand.footer && <footer class="site-footer muted">{brand.footer}</footer>}
          </>
        )}
      </body>
    </html>
  );
}

const shareIcon = () => (
  <svg class="inline-icon" viewBox="0 0 24 24" width="16" height="16" aria-label={t('Share', 'Partager')}>
    <path fill="currentColor" d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4L12 2Zm-7 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9h-2v9H7v-9H5Z" />
  </svg>
);

// Shown by /app.js only where it applies: not inside the installed app, and not after "Not now".
function InstallBanner(props: { brand: Brand }) {
  const fr = lang() === 'fr';
  return (
    <div class="card install-banner" data-install-banner hidden>
      <img src={iconUrl('icon-192.png')} alt="" width="44" height="44" />
      <div class="install-text">
        <strong>{fr ? <>Installe l’app {props.brand.name}</> : <>Install the {props.brand.name} app</>}</strong>
        <span class="muted">
          {t(
            'It works like an app on your phone: open it from your home screen and get notifications for payouts, rewards and milestones.',
            'Elle fonctionne comme une app sur ton téléphone : ouvre-la depuis ton écran d’accueil et reçois des notifications pour tes paiements, tes récompenses et tes étapes atteintes.',
          )}
        </span>
        <span data-install-ios hidden>
          {fr ? (
            <>
              Sur iPhone : touche {shareIcon()} <strong>Partager</strong> dans Safari, puis <strong>Sur l’écran d’accueil</strong>.
            </>
          ) : (
            <>
              On iPhone: tap {shareIcon()} <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.
            </>
          )}
        </span>
      </div>
      <div class="install-actions">
        <button type="button" data-install-button hidden>
          {t('Install', 'Installer')}
        </button>
        <button type="button" class="link" data-install-done>
          {t('I already installed it', 'Je l’ai déjà installée')}
        </button>
        <button type="button" class="link" data-install-dismiss>
          {t('Not now', 'Pas maintenant')}
        </button>
      </div>
    </div>
  );
}

export function InstallSteps() {
  const fr = lang() === 'fr';
  return (
    <div class="card stack-card install-steps">
      <h2 class="first">{t('Install the app', 'Installer l’app')}</h2>
      <p class="muted">
        {t(
          'This site is an app you can install (a PWA). Installed, it opens from your home screen like any other app and can send you notifications.',
          'Ce site est une app que tu peux installer (une PWA). Une fois installée, elle s’ouvre depuis ton écran d’accueil comme n’importe quelle autre app et peut t’envoyer des notifications.',
        )}
      </p>
      {fr ? (
        <dl>
          <dt>iPhone ou iPad</dt>
          <dd>
            Ouvre ce site dans Safari, touche {shareIcon()} <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>.
            Ouvre-la ensuite depuis l’écran d’accueil : les notifications fonctionnent seulement là.
          </dd>
          <dt>Android</dt>
          <dd>
            Dans Chrome, touche <strong>Installer</strong> sur la bannière, ou ouvre le menu ⋮ et choisis{' '}
            <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).
          </dd>
          <dt>Ordinateur</dt>
          <dd>
            Dans Chrome ou Edge, clique sur l’icône d’installation à droite de la barre d’adresse, ou sur le menu, puis sur{' '}
            <strong>Installer</strong>.
          </dd>
        </dl>
      ) : (
        <dl>
          <dt>iPhone or iPad</dt>
          <dd>
            Open this site in Safari, tap {shareIcon()} <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
            Open it from the home screen; notifications only work there.
          </dd>
          <dt>Android</dt>
          <dd>
            In Chrome, tap <strong>Install</strong> on the banner, or open the ⋮ menu and choose{' '}
            <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
          </dd>
          <dt>Computer</dt>
          <dd>
            In Chrome or Edge, click the install icon at the right of the address bar, or the menu, then{' '}
            <strong>Install</strong>.
          </dd>
        </dl>
      )}
      <p class="muted">
        {t(
          'After installing, sign in once in the app and turn on notifications from the bell.',
          'Après l’installation, connecte-toi une fois dans l’app et active les notifications à partir de la cloche.',
        )}
      </p>
    </div>
  );
}

export function Avatar(props: { user: User; size?: 'small' | 'large' }) {
  const avatar = avatarOf(props.user);
  const cls = `avatar${props.size ? ` ${props.size}` : ''}`;
  return avatar ? (
    <img class={cls} src={`/avatar/${avatar.userId}?v=${avatar.version}`} alt="" />
  ) : (
    <span class={`${cls} avatar-initials`} aria-hidden="true">
      {initials(props.user.name)}
    </span>
  );
}

function Bell(props: { userId: number }) {
  const unread = unreadCount(props.userId);
  return (
    <a class="bell" href="/notifications" aria-label={unread ? t(`Notifications, ${unread} unread`, `Notifications, ${unread} non ${unread > 1 ? 'lues' : 'lue'}`) : 'Notifications'}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {unread > 0 && <span class="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </a>
  );
}

// Opens under the avatar; a <details> element, so it works with the keyboard and without scripts.
function AccountMenu(props: { user: User }) {
  const u = props.user;
  return (
    <details class="account-menu">
      <summary aria-label={t('Your account', 'Ton compte')}>
        <Avatar user={u} size="small" />
      </summary>
      <div class="menu">
        <div class="menu-who">
          <strong>{u.name}</strong>
          <span>{u.email}</span>
        </div>
        <a href="/notifications">Notifications {count(unreadCount(u.id))}</a>
        <a href="/account">{t('Account', 'Compte')}</a>
        <a href="/account/security">{t('Security', 'Sécurité')}</a>
        {!!u.show_advanced && <a href="/account/api">{t('API & Claude', 'API et Claude')}</a>}
        <LangSwitch user={u} />
        <form method="post" action="/logout">
          <button type="submit">{t('Sign out', 'Se déconnecter')}</button>
        </form>
      </div>
    </details>
  );
}

// An accordion: open by default so it works without scripts; /app.js remembers which ones were closed
// and always opens the one holding the current page.
function NavGroup(props: { id: string; title: string; children: Child }) {
  return (
    <details class="nav-group" data-nav-group={props.id} open>
      <summary class="nav-title">
        <span>{props.title}</span>
        <svg class="nav-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />
        </svg>
      </summary>
      <div class="nav-items">{props.children}</div>
    </details>
  );
}

// Français / English, in the avatar menu and at the bottom of the side menu. "Auto" follows the browser.
function LangSwitch(props: { user: User }) {
  const current = props.user.lang_pref ?? 'auto';
  const options = [
    ['fr', 'Français'],
    ['en', 'English'],
    ['auto', t('Auto', 'Auto')],
  ] as const;
  return (
    <form class="lang-switch" method="post" action="/lang" aria-label={t('Language', 'Langue')}>
      <input type="hidden" name="back" value="/" data-back-here />
      <span class="lang-label">{t('Language', 'Langue')}</span>
      <span class="lang-options">
        {options.map(([value, label]) => (
          <button
            type="submit"
            name="lang"
            value={value}
            aria-pressed={current === value ? 'true' : 'false'}
            lang={value === 'auto' ? undefined : value}
            title={value === 'auto' ? t('Use the language of my browser', 'Utiliser la langue de mon navigateur') : undefined}
          >
            {label}
          </button>
        ))}
      </span>
    </form>
  );
}

// At the bottom of the menu: shows the Advanced section (API & Claude) for those who want it.
function AdvancedToggle(props: { on: boolean }) {
  return (
    <form class="nav-advanced" method="post" action="/account/advanced">
      <input type="hidden" name="on" value={props.on ? '0' : '1'} />
      {/* Filled in by /app.js with the current page, to come back to it. */}
      <input type="hidden" name="back" value="/" data-back-here />
      <button type="submit" class="switch" role="switch" aria-checked={props.on ? 'true' : 'false'}>
        <span class="switch-track" aria-hidden="true">
          <span class="switch-thumb" />
        </span>
        <span>{t('Advanced options', 'Options avancées')}</span>
      </button>
    </form>
  );
}

const count = (n: number) => (n > 0 ? <span class="nav-count">{n > 99 ? '99+' : n}</span> : null);

// One grouped menu: a fixed sidebar on computers, a slide-in panel on phones. /app.js marks the
// current page.
function Sidebar(props: { user: User }) {
  const u = props.user;
  const unread = unreadCount(u.id);
  return (
    <nav class="sidebar" id="sidebar" aria-label="Main">
      <a class="nav-close" href="#" aria-label="Close the menu">
        ×
      </a>
      {u.is_admin ? (
        <>
          {/* Grouped by task: what needs me today, who, which event, how people are paid, setup. */}
          <NavGroup id="today" title="Today">
            <a href="/admin/dashboard">Dashboard</a>
            <a href="/admin/payouts">Requests {count(countPendingPayouts() + countPendingRewards())}</a>
          </NavGroup>
          <NavGroup id="people" title="People">
            <a href="/admin">Promoters</a>
            <a href="/admin/teams">Teams</a>
            <a href="/admin/invites">Invite links</a>
            <a href="/admin/notifications">Send a notification</a>
          </NavGroup>
          <NavGroup id="events" title="Events">
            <a href="/admin/codes">Promo codes</a>
            <a href="/admin/media">Media drives</a>
            <a href="/admin/banners">Banners</a>
          </NavGroup>
          <NavGroup id="pay" title="Pay &amp; rewards">
            <a href="/admin/commissions">Commissions</a>
            <a href="/admin/rewards">Levels &amp; rewards</a>
            <a href="/admin/rules">Rules (advanced)</a>
          </NavGroup>
          <NavGroup id="sharing" title="Sharing">
            <a href="/admin/pages">Promoter pages</a>
            <a href="/admin/links">Event links</a>
          </NavGroup>
          <NavGroup id="settings" title="Settings">
            <a href="/admin/branding">Branding</a>
            <a href="/admin/emails">Emails</a>
          </NavGroup>
        </>
      ) : (
        <>
          <a class="nav-cta" href="/rewards/checkout">
            {t('Make a request', 'Faire une demande')}
          </a>
          <NavGroup id="sales" title={t('My sales', 'Mes ventes')}>
            <a href="/">{t('Dashboard', 'Tableau de bord')}</a>
            <a href="/payouts">{t('Payouts & rewards', 'Paiements et récompenses')}</a>
            <a href="/page">{t('My page', 'Ma page')}</a>
            {(isTeamLead(u) || !!u.team_lead_id) && <a href="/team">{t('My team', 'Mon équipe')}</a>}
          </NavGroup>
        </>
      )}
      {/* On computers these live in the avatar menu; the phone panel keeps them too. */}
      <div class="nav-me">
        <NavGroup id="me" title={t('Me', 'Moi')}>
          <a href="/notifications">Notifications {count(unread)}</a>
          <a href="/account">{t('Account', 'Compte')}</a>
          <a href="/account/security">{t('Security', 'Sécurité')}</a>
        </NavGroup>
      </div>
      {!!u.show_advanced && (
        <NavGroup id="advanced" title={t('Advanced', 'Avancé')}>
          <a href="/account/api">{t('API & Claude', 'API et Claude')}</a>
        </NavGroup>
      )}
      <div class="nav-bottom">
        <LangSwitch user={u} />
        <AdvancedToggle on={!!u.show_advanced} />
        <form class="nav-signout nav-me" method="post" action="/logout">
          <button class="link" type="submit">
            {t('Sign out', 'Se déconnecter')}
          </button>
        </form>
      </div>
    </nav>
  );
}

export function Flash(props: { error?: string; ok?: string }) {
  return (
    <>
      {props.error && <div class="flash error">{props.error}</div>}
      {props.ok && <div class="flash ok">{props.ok}</div>}
    </>
  );
}

export function LoginPage(props: {
  error?: string;
  email?: string;
  sent?: boolean;
  withPassword?: boolean;
  offline?: boolean;
}) {
  return (
    <Layout title={props.offline ? t('Offline', 'Hors ligne') : t('Sign in', 'Connexion')}>
      <div class="login card">
        <h1 class="login-brand">
          <BrandMark brand={getBrand()} />
        </h1>
        {props.offline ? (
          <p class="muted">{props.error}</p>
        ) : props.sent ? (
          <>
            <p>{t('Check your email.', 'Vérifie tes courriels.')}</p>
            <p class="muted">
              {lang() === 'fr' ? (
                <>
                  Si <strong>{props.email}</strong> correspond à un compte de promoteur, un lien de connexion s’en vient. Ça peut
                  prendre une minute, et il peut se retrouver dans les indésirables.
                </>
              ) : (
                <>
                  If <strong>{props.email}</strong> belongs to a promoter account, a sign-in link is on its way. It can take a
                  minute, and it may land in spam.
                </>
              )}
            </p>
            <p class="waiting" data-wait-login>
              {t(
                'Open the link on any device. This page signs in by itself as soon as you do.',
                'Ouvre le lien sur n’importe quel appareil. Cette page se connecte toute seule dès que tu le fais.',
              )}
            </p>
            <Flash error={props.error} />
            <details class="code-fallback" open={!!props.error}>
              <summary>{t('Or type the 6-digit code from the email', 'Ou tape le code à 6 chiffres du courriel')}</summary>
            <form class="stack" method="post" action="/login/code">
              <input type="hidden" name="email" value={props.email ?? ''} />
              <label>
                {t('Code', 'Code')}
                <input
                  class="code-input"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxlength={6}
                  required
                />
              </label>
              <button type="submit">{t('Sign in', 'Se connecter')}</button>
            </form>
            </details>
            <p class="muted">
              <a href="/login">{t('Use a different email', 'Utiliser un autre courriel')}</a>
            </p>
          </>
        ) : props.withPassword ? (
          <>
            <Flash error={props.error} />
            <form class="stack" method="post" action="/login">
              <label>
                {t('Email', 'Courriel')}
                <input type="email" name="email" value={props.email ?? ''} autocomplete="username" required autofocus />
              </label>
              <label>
                {t('Password', 'Mot de passe')}
                <input type="password" name="password" autocomplete="current-password" required />
              </label>
              <button type="submit">{t('Sign in', 'Se connecter')}</button>
            </form>
            <p class="muted">
              <a href="/login">{t('Email me a link instead', 'Envoie-moi plutôt un lien par courriel')}</a>
            </p>
          </>
        ) : (
          <>
            {getBrand().loginMessage && <p>{getBrand().loginMessage}</p>}
            <p class="muted">
              {t(
                'Enter your email and we will send you a link to sign in. No password needed.',
                'Entre ton courriel et on t’envoie un lien de connexion. Pas besoin de mot de passe.',
              )}
            </p>
            <Flash error={props.error} />
            <form class="stack" method="post" action="/login/link">
              <label>
                {t('Email', 'Courriel')}
                <input type="email" name="email" value={props.email ?? ''} autocomplete="email" required autofocus />
              </label>
              <button type="submit">{t('Email me a sign-in link', 'M’envoyer un lien de connexion')}</button>
            </form>
            <p class="muted">
              <a href="/login?method=password">{t('Sign in with a password', 'Se connecter avec un mot de passe')}</a>
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}

// Mail scanners (Outlook Safe Links and similar) open links ahead of the user. They fetch this page
// but do not run scripts, so the single-use token is only spent when /app.js submits the form in a
// real browser, which happens instantly. The button is the fallback when scripts are off.
export function LoginConfirmPage(props: { token: string }) {
  return (
    <Layout title={t('Signing in', 'Connexion en cours')}>
      <div class="login card">
        <h1 class="login-brand">
          <BrandMark brand={getBrand()} />
        </h1>
        <p class="muted">{t('Signing you in…', 'Connexion en cours…')}</p>
        <form class="stack" method="post" action="/login/verify" data-auto-submit>
          <input type="hidden" name="token" value={props.token} />
          <button type="submit">{t('Continue', 'Continuer')}</button>
        </form>
      </div>
    </Layout>
  );
}

function timeAgo(epochSeconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - epochSeconds) / 60));
  if (minutes < 1) return t('just now', 'à l’instant');
  return t(minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`, `il y a ${plural(minutes, ['minute', 'minute'], ['minutes', 'minutes'])}`);
}

// Shown after a link is opened somewhere other than the browser or app that asked for it.
export function ApproveDevicePage(props: { request?: { rowId: number; from: string | null; at: number }; done?: boolean }) {
  return (
    <Layout title={t('Sign in', 'Connexion')}>
      <div class="login card">
        <h1>{t("You're signed in", 'Connexion réussie')}</h1>
        {props.request ? (
          <>
            <p>
              {lang() === 'fr' ? (
                <>
                  Connecter aussi l’appareil qui a demandé ce lien ? La demande a été faite {timeAgo(props.request.at)} depuis{' '}
                  <strong>{props.request.from ?? 'un autre appareil'}</strong>, par exemple l’app installée sur ton téléphone.
                </>
              ) : (
                <>
                  Also sign in the device that asked for this link? It was requested {timeAgo(props.request.at)} from{' '}
                  <strong>{props.request.from ?? 'another device'}</strong>, for example the installed app on your phone.
                </>
              )}
            </p>
            <p class="muted">
              {t('Only say yes if you asked for it yourself just now.', 'Dis oui seulement si tu viens de le demander toi-même.')}
            </p>
            <form class="stack" method="post" action="/login/approve">
              <input type="hidden" name="request" value={String(props.request.rowId)} />
              <button type="submit" name="answer" value="yes">
                {t('Yes, sign it in', 'Oui, le connecter')}
              </button>
              <button class="secondary" type="submit" name="answer" value="no">
                {t('No, only this browser', 'Non, seulement ce navigateur')}
              </button>
            </form>
          </>
        ) : props.done ? (
          <p>
            {t(
              'Done. Go back to the app or the other device: it signs in by itself within a few seconds.',
              'C’est fait. Retourne dans l’app ou sur l’autre appareil : la connexion se fait toute seule en quelques secondes.',
            )}
          </p>
        ) : (
          <p class="muted">
            {t(
              'That request has expired. On the other device, ask for a new link.',
              'Cette demande a expiré. Sur l’autre appareil, demande un nouveau lien.',
            )}{' '}
            <a href="/">{t('Continue here', 'Continuer ici')}</a>
          </p>
        )}
      </div>
    </Layout>
  );
}

export function AccountPage(props: { user: User; error?: string; ok?: string }) {
  const u = props.user;
  const theme = u.theme ?? 'system';
  const mb = Math.round(maxUploadBytes / 1024 / 1024);
  return (
    <Layout title={t('Account', 'Compte')} user={u}>
      <h1>{t('Account', 'Compte')}</h1>
      <p class="muted">
        {t(`Signed in as ${u.email}.`, `Tu utilises le compte ${u.email}.`)}
        {u.password_hash
          ? ''
          : t(
              ' You sign in with a link sent to this email; to change it, ask the team.',
              ' Tu te connectes avec un lien envoyé à ce courriel; pour le changer, demande à l’équipe.',
            )}
      </p>
      <Flash error={props.error} ok={props.ok} />

      <form class="account-form" method="post" action="/account/profile" enctype="multipart/form-data">
        <div class="two-col">
          <div class="card stack-card">
            <h2 class="first">{t('About you', 'À propos de toi')}</h2>
            <div class="photo-row">
              <Avatar user={u} size="large" />
              <div class="muted">
                {u.avatar_source === 'upload'
                  ? t('Your uploaded photo.', 'La photo que tu as téléversée.')
                  : u.avatar_source === 'admin'
                    ? t('A photo the team chose for you. Upload your own to replace it.', 'Une photo choisie pour toi par l’équipe. Téléverse la tienne pour la remplacer.')
                  : u.avatar_source === 'instagram'
                    ? t(
                        `Your Instagram photo (${u.avatar_for ? `@${u.avatar_for}` : ''}), refreshed weekly.`,
                        `Ta photo Instagram (${u.avatar_for ? `@${u.avatar_for}` : ''}), mise à jour chaque semaine.`,
                      )
                    : t('Add your Instagram below to use its photo, or upload one.', 'Ajoute ton Instagram plus bas pour utiliser sa photo, ou téléverses-en une.')}
              </div>
            </div>
            <label>
              {t(
                `Upload a photo instead (PNG, JPEG or WebP, up to ${mb} MB)`,
                `Téléverser une photo à la place (PNG, JPEG ou WebP, jusqu’à ${mb} Mo)`,
              )}
              <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" />
            </label>
            {(u.avatar_source === 'upload' || u.avatar_source === 'admin') && (
              <label class="check">
                <input type="checkbox" name="use_instagram_photo" value="1" />{' '}
                {t('Remove my photo and use my Instagram one', 'Retirer ma photo et utiliser celle d’Instagram')}
              </label>
            )}
            <div class="field-row">
              <label>
                {t('First name', 'Prénom')}
                <input name="first_name" value={u.first_name ?? ''} autocomplete="given-name" maxlength={60} />
              </label>
              <label>
                {t('Last name', 'Nom')}
                <input name="last_name" value={u.last_name ?? ''} autocomplete="family-name" maxlength={60} />
              </label>
            </div>
            <label>
              {t('Phone', 'Téléphone')}
              <input name="phone" type="tel" value={u.phone ?? ''} autocomplete="tel" maxlength={30} />
            </label>
            <label>
              {t('City or region', 'Ville ou région')}
              <CityInput value={u.city} />
            </label>
            <label>
              Instagram
              <input name="instagram" value={u.instagram ?? ''} placeholder={t('@yourname', '@tonnom')} maxlength={60} />
            </label>
            <label>
              {t(
                'Promoter alias (in your links as aff=…; letters, numbers, - and _)',
                'Alias de promoteur (dans tes liens, sous la forme aff=…; lettres, chiffres, - et _)',
              )}
              <input name="alias" value={u.alias ?? ''} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{1,29}" maxlength={30} required />
            </label>
          </div>
          <div class="card stack-card">
            <h2 class="first">{t('Payouts', 'Paiements')}</h2>
            <label>
              {t('Preferred payout method', 'Mode de paiement préféré')}
              <select name="payout_method">
                {config.payoutMethods.map((m) => (
                  <option value={m} selected={m === (u.payout_method ?? config.payoutMethods[0])}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Payout email or account', 'Courriel ou compte pour les paiements')}
              <input name="payout_details" value={u.payout_details ?? ''} placeholder={u.email} maxlength={200} />
            </label>
            <p class="muted">
              {t(
                'Used to fill in your payout requests. You can still change it per request.',
                'Sert à remplir tes demandes de paiement. Tu peux quand même le changer à chaque demande.',
              )}
            </p>

            <h2>{t('Appearance', 'Apparence')}</h2>
            <div class="theme-choice" role="radiogroup" aria-label={t('Theme', 'Thème')}>
              {(['system', 'light', 'dark'] as const).map((th) => (
                <label class="check">
                  <input type="radio" name="theme" value={th} checked={theme === th} />
                  {th === 'system'
                    ? t('Same as my device', 'Comme mon appareil')
                    : th === 'light'
                      ? t('Light', 'Clair')
                      : t('Dark', 'Sombre')}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button type="submit">{t('Save', 'Enregistrer')}</button>
      </form>

      <InstallSteps />

      {u.password_hash ? <PasswordForm /> : null}
    </Layout>
  );
}

function PasswordForm() {
  return (
    <>
      <h2>{t('Change password', 'Changer de mot de passe')}</h2>
      <form class="stack" method="post" action="/account/password">
        <label>
          {t('Current password', 'Mot de passe actuel')}
          <input type="password" name="current" autocomplete="current-password" required />
        </label>
        <label>
          {t('New password (at least 10 characters)', 'Nouveau mot de passe (au moins 10 caractères)')}
          <input type="password" name="password" autocomplete="new-password" minlength={10} required />
        </label>
        <button type="submit">{t('Update password', 'Mettre à jour le mot de passe')}</button>
      </form>
    </>
  );
}

// A promoter's usual commission: the default percentage, their own percentage, or a flat amount per
// ticket sold. Per event, admins can set another one on Commissions.
function CommissionField(props: { user?: User }) {
  const u = props.user;
  const kind = u?.commission_flat_cents != null ? 'flat' : u?.commission_percent != null ? 'percent' : 'default';
  const value = kind === 'flat' ? (u!.commission_flat_cents! / 100).toFixed(2) : kind === 'percent' ? String(u!.commission_percent) : '';
  return (
    <div class="commission-field">
      <span>Commission</span>
      <span class="rate-fields">
        <select name="commission_kind" aria-label="How they are paid">
          <option value="default" selected={kind === 'default'}>
            Default ({formatPercent(config.commissionPercent)} of sales)
          </option>
          <option value="percent" selected={kind === 'percent'}>
            % of sales
          </option>
          <option value="flat" selected={kind === 'flat'}>
            CAD per ticket
          </option>
        </select>
        <input name="commission_value" inputmode="decimal" aria-label="Percentage or amount per ticket" placeholder="10 or 2.50" value={value} />
      </span>
      <span class="muted">Their usual rate. For one event, set another on Commissions.</span>
    </div>
  );
}

export function AdminPage(props: {
  user: User;
  promoters: (User & { codes: string[] })[];
  unassigned: number; // promo codes on events that are not over, assigned to nobody
  error?: string;
  ok?: string;
}) {
  // For "X's team" under each name.
  const names = new Map(props.promoters.map((p) => [p.id, p.name]));
  return (
    <Layout title="Promoters" user={props.user}>
      <h1>Promoters</h1>
      <p class="muted">
        Each promoter sees the sales of the promo codes assigned to them, across all events, and their commission: a
        percentage of the full-price sales (by default {formatPercent(config.commissionPercent)}) or a flat amount per
        ticket sold.
      </p>
      <Flash error={props.error} ok={props.ok} />

      <div class="two-col">
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Codes</th>
                <th class="num">Commission</th>
              </tr>
            </thead>
            <tbody>
              {props.promoters.map((p) => (
                <tr>
                  <td>
                    <div class="who">
                      <Avatar user={p} size="small" />
                      <div>
                        <a href={`/admin/promoters/${p.id}`}>{p.name}</a>
                        {p.is_admin ? <span class="muted"> (admin)</span> : null}
                        {isTeamLead(p) ? <span class="muted"> (team lead)</span> : null}
                        {!p.is_admin && !avatarOf(p) ? <span class="chip warn">No photo</span> : null}
                        {!p.is_admin && !p.city?.trim() ? <span class="chip warn">No city</span> : null}
                        <div class="muted">
                          {p.email}
                          {p.alias ? ` · aff=${p.alias}` : ''}
                          {p.team_lead_id && names.has(p.team_lead_id) ? ` · ${names.get(p.team_lead_id)}'s team` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{p.codes.length ? p.codes.map((c) => <span class="code">{c}</span>) : <span class="muted">None</span>}</td>
                  <td class="num">{describeRule(usualRuleFor(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2 class="first">Add a promoter</h2>
          <form class="stack" method="post" action="/admin/promoters">
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Email
              <input type="email" name="email" required />
            </label>
            <label>
              Promo codes (comma or space separated, case does not matter)
              <textarea name="codes" />
            </label>
            <CommissionField />
            <label class="check">
              <input type="checkbox" name="invite" value="1" checked /> Email them a sign-in link now
            </label>
            <label class="check">
              <input type="checkbox" name="is_admin" value="1" /> Admin (can manage promoters)
            </label>
            <button type="submit">Create promoter</button>
          </form>
        </div>
      </div>

      <p class="muted">
        <a href="/admin/codes">Promo codes in Hi.Events →</a>
        {props.unassigned > 0 && (
          <>
            {' '}
            <a href="/admin/codes?show=unassigned">
              {props.unassigned} on upcoming events {props.unassigned === 1 ? 'is' : 'are'} assigned to nobody
            </a>
          </>
        )}
      </p>
    </Layout>
  );
}

// Events → Promo codes: every code in Hi.Events, searched, filtered and paged on the server.
export function AdminCodesPage(props: { user: User; filter: CodeFilter; result: CodePage }) {
  const f = props.filter;
  const r = props.result;
  const first = (r.page - 1) * codesPerPage + 1;
  return (
    <Layout title="Promo codes" user={props.user}>
      <h1>Promo codes</h1>
      <p class="muted">The promo codes in Hi.Events and who each one is assigned to. Assign codes on a promoter's page.</p>
      <form class="card filter-bar" method="get" action="/admin/codes">
        <input type="search" name="q" value={f.q} placeholder="Code, event or promoter" aria-label="Search" maxlength={100} />
        <select name="when" aria-label="Events">
          <option value="upcoming" selected={f.when === 'upcoming'}>
            Upcoming events
          </option>
          <option value="past" selected={f.when === 'past'}>
            Past events
          </option>
          <option value="all" selected={f.when === 'all'}>
            All events
          </option>
        </select>
        <select name="show" aria-label="Assigned">
          <option value="all" selected={f.show === 'all'}>
            Assigned or not
          </option>
          <option value="assigned" selected={f.show === 'assigned'}>
            Assigned
          </option>
          <option value="unassigned" selected={f.show === 'unassigned'}>
            Assigned to nobody
          </option>
        </select>
        <button type="submit">Search</button>
        {(f.q || f.show !== 'all' || f.when !== 'upcoming') && <a href="/admin/codes">Clear</a>}
      </form>
      <p class="muted">
        {r.total === 0
          ? 'No promo codes match.'
          : `${r.total === 1 ? '1 promo code' : `${r.total} promo codes`}${r.pages > 1 ? `, ${first} to ${first + r.rows.length - 1} shown` : ''}.`}
      </p>
      {r.rows.length > 0 && (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Event</th>
                <th class="num">Orders</th>
                <th>Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((pc) => (
                <tr>
                  <td>
                    <span class="code">{pc.code}</span>
                  </td>
                  <td>
                    {pc.event_title}
                    <div class="muted">{formatDate(pc.event_start, pc.event_timezone)}</div>
                  </td>
                  <td class="num">{pc.order_usage_count}</td>
                  <td>{pc.owners.length ? pc.owners.join(', ') : <span class="muted">Nobody</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.pages > 1 && (
        <nav class="pager" aria-label="Pages">
          {r.page > 1 ? <a href={codesHref(f, { page: r.page - 1 })}>← Previous</a> : <span />}
          <span class="muted">
            Page {r.page} of {r.pages}
          </span>
          {r.page < r.pages ? <a href={codesHref(f, { page: r.page + 1 })}>Next →</a> : <span />}
        </nav>
      )}
    </Layout>
  );
}

/** A promoter's public page: the full link and the short link, each one click to copy. */
function PageLinks(props: { promoter: User; clicks?: number | null }) {
  const p = props.promoter;
  const full = pageLink(p);
  if (!full) return <span class="muted">No alias yet</span>;
  const short = pageShortLink(p);
  return (
    <div class={`page-links${p.page_hidden_at ? ' hidden-page' : ''}`}>
      <PageLink href={full} kind={short ? 'Full' : undefined} />
      {short && (
        <PageLink href={short} kind="Kutt">
          {props.clicks != null && <span class="muted">{props.clicks === 1 ? '1 click' : `${props.clicks} clicks`}</span>}
        </PageLink>
      )}
      {p.page_hidden_at ? <span class="muted">Hidden by {hiddenByTeam(p) ? 'an admin' : 'the promoter'}</span> : null}
    </div>
  );
}

function PageLink(props: { href: string; kind?: string; children?: Child }) {
  return (
    <span class="page-link">
      {props.kind && <span class="page-link-kind">{props.kind}</span>}
      <a href={props.href} target="_blank" rel="noopener">
        {props.href.replace(/^https?:\/\//, '')}
      </a>
      <button type="button" class="secondary small" data-copy-text={props.href}>
        Copy
      </button>
      {props.children}
    </span>
  );
}

/** Renames a promoter's page short link in Kutt. */
function RenameShortLink(props: { promoter: User }) {
  const short = pageShortLink(props.promoter);
  let host = shortDomain();
  let current = '';
  if (short) {
    const url = new URL(short);
    host = url.host;
    current = decodeURIComponent(url.pathname.slice(1));
  }
  return (
    <details class="rename-short">
      <summary>{short ? 'Change the Kutt link' : 'Pick the Kutt link'}</summary>
      <form method="post" action={`/admin/pages/${props.promoter.id}/short-link`} class="rename-form">
        <label>
          New address
          <span class="rename-field">
            {host && <span class="muted">{host}/</span>}
            <input name="address" value={current} maxlength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" required autocomplete="off" />
          </span>
        </label>
        <button type="submit" class="small">
          Save
        </button>
      </form>
      {short && <p class="muted">The link is renamed in Kutt and keeps its clicks. The old address stops working.</p>}
    </details>
  );
}

/** The two tabs of Promoter pages: each promoter's page, and the index page listing them all (/p). */
export function PagesTabs(props: { current: 'pages' | 'index' }) {
  return (
    <nav class="tabs" aria-label="Promoter pages">
      <a href="/admin/pages" aria-current={props.current === 'pages' ? 'page' : undefined}>
        Each promoter's page
      </a>
      <a href="/admin/pages/index" aria-current={props.current === 'index' ? 'page' : undefined}>
        Index page
      </a>
    </nav>
  );
}

export function AdminPagesPage(props: {
  user: User;
  promoters: User[];
  clicks: Map<number, number | null>;
  kutt: boolean;
  ok?: string;
  error?: string;
}) {
  return (
    <Layout title="Promoter pages" user={props.user}>
      <h1>Promoter pages</h1>
      <PagesTabs current="pages" />
      <p class="muted">
        Each promoter's public page lists their upcoming events, with their code in each link.{' '}
        {props.kutt ? 'The second link is the Kutt short link.' : 'Short links show here once Kutt is set up (KUTT_URL and KUTT_API_KEY).'}
      </p>
      <Flash ok={props.ok} error={props.error} />
      <p>
        <a class="button secondary" href="/admin/pages.csv" download="promoter-pages.csv">
          Download as CSV
        </a>
      </p>
      {props.promoters.length === 0 ? (
        <div class="card muted">No promoters yet.</div>
      ) : (
        <div class="card table-wrap">
          <table class="page-table">
            <thead>
              <tr>
                <th>Promoter</th>
                <th>Links</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.promoters.map((p) => (
                <tr>
                  <td>
                    <a class="who" href={`/admin/promoters/${p.id}`}>
                      <Avatar user={p} size="small" />
                      <span>{p.name}</span>
                    </a>
                  </td>
                  <td>
                    <PageLinks promoter={p} clicks={props.clicks.get(p.id)} />
                    {props.kutt && p.alias && !p.page_hidden_at && <RenameShortLink promoter={p} />}
                  </td>
                  <td>
                    {p.alias && (
                      <form method="post" action={`/admin/pages/${p.id}/visibility`}>
                        <input type="hidden" name="hidden" value={p.page_hidden_at ? '0' : '1'} />
                        <button type="submit" class="link">
                          {p.page_hidden_at ? 'Show' : 'Hide'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function PromoterPage(props: {
  user: User;
  promoter: User;
  codes: string[];
  balances: Balance[];
  payouts: PayoutRequest[];
  rewardRequests: RewardRequest[];
  rewards: Rewards;
  adjustments: Adjustment[];
  teamLeads: User[];
  team: User[]; // their promoters, when they are a team lead
  events: { id: number; title: string; upcoming: boolean }[]; // events with their codes
  rewardTypes: RewardType[];
  error?: string;
  ok?: string;
}) {
  const p = props.promoter;
  const upcoming = props.events.filter((e) => e.upcoming);
  const currency = props.balances[0]?.currency ?? 'CAD';
  return (
    <Layout title={p.name} user={props.user}>
      <p class="muted">
        <a href="/admin">Promoters</a> / {p.name}
      </p>
      <div class="who">
        <Avatar user={p} size="large" />
        <h1>{p.name}</h1>
      </div>
      <Flash error={props.error} ok={props.ok} />

      <div class="two-col">
        <div class="card">
          <h2 class="first">Details and codes</h2>
          <form class="stack" method="post" action={`/admin/promoters/${p.id}`}>
            <label>
              Name
              <input name="name" value={p.name} required />
            </label>
            <label>
              Email
              <input type="email" name="email" value={p.email} required />
            </label>
            <label>
              Promo codes
              <textarea name="codes">{props.codes.join(', ')}</textarea>
            </label>
            <label>
              Alias (in their links as aff=…; they can change it too)
              <input name="alias" value={p.alias ?? ''} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{1,29}" maxlength={30} required />
            </label>
            <CommissionField user={p} />
            <label class="check">
              <input type="checkbox" name="is_admin" value="1" checked={!!p.is_admin} /> Admin
            </label>
            <button type="submit">Save</button>
          </form>
        </div>

        <div class="card">
          <h2 class="first">Sign-in link</h2>
          <p class="muted">
            Emails {p.email} a link that signs them in, valid {config.inviteLinkDays} days. Promoters can also request one
            themselves on the sign-in page.
          </p>
          <form method="post" action={`/admin/promoters/${p.id}/invite`}>
            <button type="submit">Email a sign-in link</button>
          </form>
          <h2>Delete</h2>
          <form class="stack" method="post" action={`/admin/promoters/${p.id}/delete`}>
            <label class="check">
              <input type="checkbox" name="confirm" value="1" required /> Yes, delete {p.name}
            </label>
            <button class="danger" type="submit">Delete promoter</button>
          </form>
          <p class="muted">Deleting removes their login only. Nothing in Hi.Events changes.</p>
        </div>
      </div>

      <h2>Team</h2>
      <div class="card">
        {p.is_admin ? (
          <p class="muted first">Admins see every team and are on none.</p>
        ) : isTeamLead(p) ? (
          <>
            <p class="first">
              Team lead of{' '}
              {props.team.length === 0
                ? 'no promoters yet'
                : props.team.map((m, i) => (
                    <>
                      {i > 0 && ', '}
                      <a href={`/admin/promoters/${m.id}`}>{m.name}</a>
                    </>
                  ))}
              . <a href={`/admin/teams/${p.id}`}>Team sales →</a>
            </p>
            <p class="muted">Add or remove promoters on <a href="/admin/teams">Teams</a>.</p>
            <TeamCommissionForm lead={p} from="promoter" />
            <form method="post" action="/admin/teams/lead">
              <input type="hidden" name="user_id" value={String(p.id)} />
              <input type="hidden" name="lead" value="0" />
              <input type="hidden" name="from" value="promoter" />
              <button class="secondary" type="submit">
                No longer team lead
              </button>
            </form>
          </>
        ) : (
          <>
            <form class="inline-form" method="post" action={`/admin/promoters/${p.id}/team`}>
              <select name="team_lead_id" aria-label="Team lead">
                <option value="">No team</option>
                {props.teamLeads.map((l) => (
                  <option value={String(l.id)} selected={l.id === p.team_lead_id}>
                    {l.name}'s team
                  </option>
                ))}
              </select>
              <button type="submit">Save</button>
            </form>
            <p class="muted">Their team lead sees their sales, nothing else.</p>
            <form method="post" action="/admin/teams/lead">
              <input type="hidden" name="user_id" value={String(p.id)} />
              <input type="hidden" name="lead" value="1" />
              <input type="hidden" name="from" value="promoter" />
              <button class="secondary" type="submit">
                Make {p.name} a team lead
              </button>
            </form>
          </>
        )}
      </div>

      <h2>Security</h2>
      <div class="card profile">
        <dl>
          <dt>Two-step</dt>
          <dd>{hasTwoFactor(p) ? 'On' : 'Off'}</dd>
          <dt>App</dt>
          <dd>{p.app_installed_at ? `Installed (${new Date(p.app_installed_at * 1000).toISOString().slice(0, 10)})` : 'Not installed yet'}</dd>
          <dt>Devices</dt>
          <dd>
            {sessionsFor(p.id)
              .map((d) => `${d.device ?? 'Unknown device'}${d.is_app ? ' (app)' : ''}`)
              .join(', ') || 'Not signed in anywhere'}
          </dd>
          <dt>API</dt>
          <dd>{apiAccessSummary(tokensFor(p.id))}</dd>
        </dl>
        {tokensFor(p.id).length > 0 && (
          <form class="stack" method="post" action={`/admin/promoters/${p.id}/api-revoke`}>
            <button class="secondary" type="submit">
              Remove their API keys and connected apps
            </button>
          </form>
        )}
        {hasTwoFactor(p) && (
          <form class="stack" method="post" action={`/admin/promoters/${p.id}/2fa-reset`}>
            <label class="check">
              <input type="checkbox" name="confirm" value="1" required /> They lost their phone and recovery codes
            </label>
            <button class="secondary" type="submit">
              Reset two-step verification
            </button>
          </form>
        )}
      </div>

      <h2>Profile</h2>
      <div class="card profile">
        <dl>
          <dt>Name</dt>
          <dd>{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.name}</dd>
          <dt>Phone</dt>
          <dd>{p.phone || '—'}</dd>
          <dt>City</dt>
          <dd>{p.city || '—'}</dd>
          <dt>Instagram</dt>
          <dd>{p.instagram || '—'}</dd>
          {p.joined_with_invite && (
            <>
              <dt>Joined with</dt>
              <dd>Invite link "{findInvite(p.joined_with_invite)?.label ?? 'deleted'}"</dd>
            </>
          )}
          <dt>Public page</dt>
          <dd>
            <PageLinks promoter={p} />
          </dd>
          <dt>Payout</dt>
          <dd>
            {p.payout_method ?? '—'}
            {p.payout_details ? `: ${p.payout_details}` : ''}
          </dd>
        </dl>
        <p class="muted">Filled in by the promoter on their Account page.</p>
      </div>

      <h2 id="photo">Photo</h2>
      <div class="card stack-card">
        <div class="photo-row">
          <Avatar user={p} size="large" />
          <div class="muted">
            {p.avatar_source === 'upload'
              ? 'Uploaded by them.'
              : p.avatar_source === 'admin'
                ? 'Set by the team. They can replace it on Account.'
                : p.avatar_source === 'instagram'
                  ? `From their Instagram${p.avatar_for ? ` (@${p.avatar_for})` : ''}, refreshed weekly.`
                  : 'No photo yet: their initials show instead.'}
          </div>
        </div>
        <form class="stack" method="post" action={`/admin/promoters/${p.id}/photo`} enctype="multipart/form-data">
          <label>
            Set their photo (PNG, JPEG or WebP, up to {Math.round(maxUploadBytes / 1024 / 1024)} MB). They are told.
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required />
          </label>
          <button type="submit">Save photo</button>
        </form>
        {(p.avatar_source === 'upload' || p.avatar_source === 'admin') && (
          <form method="post" action={`/admin/promoters/${p.id}/photo/remove`}>
            <button class="secondary" type="submit">
              Remove this photo{p.instagram ? ' and use their Instagram one' : ''}
            </button>
          </form>
        )}
        <p class="muted">Location and other details stored in photos are removed when they are saved.</p>
      </div>

      <h2>Sales and commission</h2>
      <div class="grid">
        {props.balances.map((b) => (
          <div class="card stat highlight">
            <div class="value">{formatMoney(b.earned, b.currency)}</div>
            <div class="label">
              Commission earned ({describeRate(rateFor(p))})
              {b.fromTeam !== 0 && <> · incl. {formatMoney(b.fromTeam, b.currency)} team commission</>}
            </div>
          </div>
        ))}
        {props.balances.map((b) => (
          <div class="card stat">
            <div class="value">{formatMoney(b.available, b.currency)}</div>
            <div class="label">Not yet requested</div>
          </div>
        ))}
      </div>
      <p>
        <a href={`/admin/promoters/${p.id}/view`}>Open {p.name}'s dashboard</a>
        <span class="muted"> · events, daily sales and commission, exactly as they see it</span>
      </p>
      <p>
        <a href={`/admin/rules/edit?scope=promoter&user=${p.id}`}>{p.name}'s rule</a>
        <span class="muted"> · their own commission or rewards on every event, on top of the default rule</span>
      </p>
      {isTeamLead(p) && (
        <p>
          <a href={`/admin/rules/edit?scope=team&user=${p.id}`}>{p.name}'s team rule</a>
          <span class="muted"> · added on top of their rule, on their team's sales: their team commission</span>
        </p>
      )}
      {!p.is_admin && (
        <form class="inline-form" method="post" action={`/admin/promoters/${p.id}/impersonate`}>
          <button class="secondary" type="submit">
            View the app as {p.name}
          </button>
          <span class="muted">Every page they see, read-only, for up to an hour. A banner takes you back.</span>
        </form>
      )}

      <h2 id="adjust">Adjust by hand</h2>
      <p class="muted">
        For anything outside Hi.Events or a correction. Each change is added to {p.name}'s numbers with the reason you
        give, shows in their history, and can be undone below.
      </p>
      <div class="adjust-grid">
        <form class="card stack-card" method="post" action={`/admin/promoters/${p.id}/adjust`}>
          <input type="hidden" name="kind" value="money" />
          <h3>Money</h3>
          <label>
            Amount ({currency}; negative to remove)
            <input name="amount" inputmode="decimal" placeholder="50.00" required />
          </label>
          <label>
            Reason (they see it)
            <input name="label" maxlength={200} placeholder="Bonus for the summer tour" required />
          </label>
          <NotifyBox />
          <button type="submit">Add money</button>
        </form>
        <form class="card stack-card" method="post" action={`/admin/promoters/${p.id}/adjust`}>
          <input type="hidden" name="kind" value="outside_sale" />
          <h3>Sales outside Hi.Events</h3>
          <label>
            What it was
            <input name="label" maxlength={200} placeholder="Warehouse party, door sales" required />
          </label>
          <label>
            For which event
            <select name="event_id">
              <option value="">None: their usual commission, added now</option>
              {props.events.map((e) => (
                <option value={String(e.id)}>{e.title}</option>
              ))}
            </select>
          </label>
          <div class="field-row">
            <label>
              Tickets sold
              <input name="quantity" type="number" step="1" placeholder="12" required />
            </label>
            <label>
              Sales total ({currency})
              <input name="sales" inputmode="decimal" placeholder="300.00" />
            </label>
          </div>
          <p class="muted">
            For an event, they count in its rule as outside_tickets and outside_sales. Without one, {p.name} gets the
            commission their own rule gives on these sales, added to their balance now. The tickets count for their
            levels, merch and ranking.
          </p>
          <NotifyBox />
          <button type="submit">Add sales</button>
        </form>
        <form class="card stack-card" method="post" action={`/admin/promoters/${p.id}/adjust`}>
          <input type="hidden" name="kind" value="free_tickets" />
          <h3>Free tickets and other rewards</h3>
          {upcoming.length === 0 ? (
            <p class="muted">They have no upcoming events with their codes.</p>
          ) : (
            <>
              <div class="field-row">
                <label>
                  Event
                  <select name="event_id" required>
                    {upcoming.map((e) => (
                      <option value={String(e.id)}>{e.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reward
                  <select name="reward_type">
                    {props.rewardTypes.map((t) => (
                      <option value={t.key}>{t.label_en}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div class="field-row">
                <label>
                  How many (negative to take back)
                  <input name="quantity" type="number" step="1" value="1" required />
                </label>
                <label>
                  Reason
                  <input name="label" maxlength={200} placeholder="Thanks for the flyers" required />
                </label>
              </div>
              <NotifyBox />
              <button type="submit">Give free tickets</button>
            </>
          )}
        </form>
        <form class="card stack-card" method="post" action={`/admin/promoters/${p.id}/adjust`}>
          <input type="hidden" name="kind" value="merch" />
          <h3>Merch</h3>
          <p class="muted">
            {props.rewards.merch.available} available to request now, {props.rewards.merch.used} requested so far.
          </p>
          <div class="field-row">
            <label>
              How many (negative to take back)
              <input name="quantity" type="number" step="1" value="1" required />
            </label>
            <label>
              Reason
              <input name="label" maxlength={200} placeholder="Top seller of the month" required />
            </label>
          </div>
          <NotifyBox />
          <button type="submit">Give merch</button>
        </form>
      </div>

      <h2>Changes made by hand</h2>
      {props.adjustments.length === 0 ? (
        <p class="muted">None yet.</p>
      ) : (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Change</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.adjustments.map((a) => (
                <tr>
                  <td>{a.created_at.slice(0, 10)}</td>
                  <td>
                    <strong>{describeAdjustment(a, formatMoney)}</strong>
                    {a.kind === 'free_tickets' && a.event_id && (
                      <div class="muted">{props.rewards.tickets.find((t) => t.event.id === a.event_id)?.event.title ?? `Event #${a.event_id}`}</div>
                    )}
                  </td>
                  <td>{a.label}</td>
                  <td>
                    <form method="post" action={`/admin/promoters/${p.id}/adjust/${a.id}/undo`}>
                      <button class="link" type="submit">
                        Undo
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Payouts</h2>
      <PayoutHistory payouts={props.payouts} />
      <h2>Rewards</h2>
      <RewardHistory requests={props.rewardRequests} />
    </Layout>
  );
}

function NotifyBox() {
  return (
    <label class="check">
      <input type="checkbox" name="notify" value="1" checked /> Tell them (notification)
    </label>
  );
}

export function AdminPayoutsPage(props: {
  user: User;
  pending: PayoutRequest[];
  done: PayoutRequest[];
  pendingRewards: RewardRequest[];
  doneRewards: RewardRequest[];
  error?: string;
  ok?: string;
}) {
  return (
    <Layout title="Requests" user={props.user}>
      <h1>Requests</h1>
      <p class="muted">What promoters asked for. Each decision emails them.</p>
      <Flash error={props.error} ok={props.ok} />
      <h2>Rewards waiting</h2>
      {props.pendingRewards.length === 0 ? (
        <p class="muted">No reward requests waiting.</p>
      ) : (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promoter</th>
                <th>Reward</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.pendingRewards.map((r) => (
                <tr>
                  <td>
                    {r.user_id ? <a href={`/admin/promoters/${r.user_id}`}>{r.promoter_name}</a> : r.promoter_name}
                    <div class="muted">Requested {r.created_at.slice(0, 16)}</div>
                  </td>
                  <td>
                    <strong>{describeReward(r)}</strong>
                    {r.details && <div>{r.details}</div>}
                  </td>
                  <td>
                    <div class="payout-actions">
                      <form method="post" action={`/admin/rewards/${r.id}/fulfil`}>
                        <input name="admin_note" placeholder="Message (optional)" maxlength={200} />
                        <button type="submit">Mark given</button>
                      </form>
                      <form method="post" action={`/admin/rewards/${r.id}/reject`}>
                        <input name="admin_note" placeholder="Reason" maxlength={200} required />
                        <button class="secondary" type="submit">Decline</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.doneRewards.length > 0 && (
        <details class="table-view">
          <summary>Reward history ({props.doneRewards.length})</summary>
          <RewardHistory requests={props.doneRewards} />
        </details>
      )}

      <h2>Payouts waiting</h2>
      <p class="muted">Pay them the usual way, then mark the request as paid here; the promoter gets an email.</p>

      {props.pending.length === 0 ? (
        <p class="muted">No requests waiting.</p>
      ) : (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promoter</th>
                <th class="num">Amount</th>
                <th>Pay to</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.pending.map((r) => (
                <tr>
                  <td>
                    {r.user_id ? <a href={`/admin/promoters/${r.user_id}`}>{r.promoter_name}</a> : r.promoter_name}
                    <div class="muted">Requested {r.created_at.slice(0, 16).replace('T', ' ')}</div>
                  </td>
                  <td class="num">{formatMoney(r.amount_cents, r.currency)}</td>
                  <td>
                    <strong>{r.method}</strong>
                    {r.details && <div>{r.details}</div>}
                    {r.note && <div class="muted">Note: {r.note}</div>}
                  </td>
                  <td>
                    <div class="payout-actions">
                      <form method="post" action={`/admin/payouts/${r.id}/paid`}>
                        <input name="admin_note" placeholder="Reference (optional)" maxlength={200} />
                        <button type="submit">Mark paid</button>
                      </form>
                      <form method="post" action={`/admin/payouts/${r.id}/reject`}>
                        <input name="admin_note" placeholder="Reason" maxlength={200} required />
                        <button class="secondary" type="submit">Decline</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Payout history</h2>
      {props.done.length === 0 ? (
        <p class="muted">Nothing paid yet.</p>
      ) : (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promoter</th>
                <th class="num">Amount</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {props.done.map((r) => (
                <tr>
                  <td>
                    {r.promoter_name}
                    <div class="muted">{r.promoter_email}</div>
                  </td>
                  <td class="num">{formatMoney(r.amount_cents, r.currency)}</td>
                  <td>
                    <span class={`status ${r.status}`}>{r.status === 'paid' ? 'Paid' : 'Declined'}</span>
                    <div class="muted">{r.processed_at?.slice(0, 10)}</div>
                  </td>
                  <td>
                    {r.admin_note}
                    <div class="muted">
                      {r.method}
                      {r.details ? `: ${r.details}` : ''}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function AdminBrandingPage(props: { user: User; error?: string; ok?: string }) {
  const brand = getBrand();
  const warnings = accentWarnings(brand.accent);
  return (
    <Layout title="Branding" user={props.user}>
      <h1>Branding</h1>
      <p class="muted">How the site, the installed app and the emails look to promoters. Only admins can change this.</p>
      <Flash error={props.error} ok={props.ok} />
      <form class="account-form" method="post" action="/admin/branding" enctype="multipart/form-data">
        <div class="two-col">
          <div class="card stack-card">
            <h2 class="first">Name and text</h2>
            <label>
              Name (header, browser tab, installed app, emails)
              <input name="name" value={brand.name} maxlength={40} required />
            </label>
            <label>
              Welcome message on the sign-in page
              <textarea name="login_message" maxlength={300}>
                {brand.loginMessage}
              </textarea>
            </label>
            <label>
              Footer (for example a contact email; leave empty for none)
              <input name="footer" value={brand.footer} maxlength={200} />
            </label>
          </div>
          <div class="card stack-card">
            <h2 class="first">Colour and logo</h2>
            <label>
              Accent colour (buttons, links, charts)
              <span class="swatch-row">
                <input type="color" name="accent" value={brand.accent} />
                <span class="muted">{brand.accent}</span>
              </span>
            </label>
            {warnings.map((w) => (
              <p class="warn">{w}</p>
            ))}
            <p class="muted">A lighter version is worked out automatically for dark mode.</p>
            <label>
              Logo (PNG, JPEG or WebP, up to {Math.round(maxUploadBytes / 1024 / 1024)} MB; shrunk to fit 600 × 300, shown about 28 px high)
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
            </label>
            {brand.logoType && (
              <>
                <img class="logo-preview" src={`/brand/logo?v=${brand.updatedAt}`} alt="Current logo" />
                <label class="check">
                  <input type="checkbox" name="remove_logo" value="1" /> Remove the logo
                </label>
              </>
            )}
          </div>
        </div>
        <button type="submit">Save branding</button>
      </form>

      <h2>Preview</h2>
      <div class="two-col">
        <div class="preview card">
          <button type="button">Button</button>
          <a href="/admin/branding">A link</a>
          <span class="chip">1 free ticket ready</span>
        </div>
        <div class="preview preview-dark">
          <button type="button">Button</button>
          <a href="/admin/branding">A link</a>
          <span>Dark mode</span>
        </div>
      </div>
    </Layout>
  );
}

function timeLabel(sqliteUtc: string): string {
  const date = new Date(`${sqliteUtc.replace(' ', 'T')}Z`);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t('just now', 'à l’instant');
  if (minutes < 60) return t(`${minutes} min ago`, `il y a ${minutes} min`);
  if (minutes < 24 * 60) return t(`${Math.round(minutes / 60)} h ago`, `il y a ${Math.round(minutes / 60)} h`);
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: config.timezone }).format(date);
}

// Admins choose, per alert, email and/or app notification (the bell and phone push). Both off = off.
function AlertSettings(props: { prefs: Prefs }) {
  return (
    <details class="alert-box card" open>
      <summary>What you are told about, and how</summary>
      <form method="post" action="/notifications/settings">
        <div class="table-wrap">
          <table class="alert-settings">
            <thead>
              <tr>
                <th>Alert</th>
                <th class="check-cell">Email</th>
                <th class="check-cell">App notification</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr>
                  <td>
                    {a.label}
                    <span class="hint">
                      {a.hint}
                      {!props.prefs[a.key].email && !props.prefs[a.key].app ? ' Off.' : ''}
                    </span>
                  </td>
                  <td class="check-cell">
                    <input type="checkbox" name={`${a.key}:email`} value="1" checked={props.prefs[a.key].email} aria-label={`${a.label}: email`} />
                  </td>
                  <td class="check-cell">
                    <input type="checkbox" name={`${a.key}:app`} value="1" checked={props.prefs[a.key].app} aria-label={`${a.label}: app notification`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="muted">App notification means the bell here and a push on devices where you turned notifications on. Untick both to stop an alert.</p>
        <button type="submit">Save</button>
      </form>
    </details>
  );
}

export function NotificationsPage(props: {
  user: User;
  notifications: Notification[];
  pushKey: string;
  devices: number;
  prefs?: Prefs;
  ok?: string;
  error?: string;
}) {
  const unread = props.notifications.filter((n) => !n.read_at).length;
  return (
    <Layout title="Notifications" user={props.user}>
      <h1>Notifications</h1>
      <Flash ok={props.ok} error={props.error} />
      {props.prefs && <AlertSettings prefs={props.prefs} />}
      <div class="card push-box" data-push-key={props.pushKey}>
        <div>
          <strong>{t('Phone notifications', 'Notifications sur le téléphone')}</strong>
          <div class="muted" data-push-status>
            {t(
              'Get a notification on this device for payouts, rewards and milestones. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen) and open it from there.',
              'Reçois une notification sur cet appareil pour tes paiements, tes récompenses et tes étapes atteintes. Sur iPhone, ajoute d’abord l’app à ton écran d’accueil (Partager → Sur l’écran d’accueil) et ouvre-la à partir de là.',
            )}
          </div>
        </div>
        <div class="push-actions">
          <button type="button" data-push-toggle hidden>
            {t('Turn on', 'Activer')}
          </button>
          <form class="inline" method="post" action="/notifications/test">
            <button class="secondary" type="submit">
              {t('Send a test', 'Envoyer un test')}
            </button>
          </form>
        </div>
        <p class="muted push-devices">
          {props.devices === 0
            ? t('No device has phone notifications on yet.', 'Aucun appareil n’a encore les notifications activées.')
            : t(
                `Phone notifications are on for ${props.devices === 1 ? '1 device' : `${props.devices} devices`}.`,
                `Les notifications sont activées sur ${plural(props.devices, ['appareil', 'appareil'], ['appareils', 'appareils'])}.`,
              )}
        </p>
      </div>
      {props.notifications.length > 0 && (
        <div class="notification-head">
          <h2>
            {unread > 0
              ? t(`${unread} unread`, `${unread} non ${unread > 1 ? 'lues' : 'lue'}`)
              : t('All read', 'Tout est lu')}
          </h2>
          {unread > 0 && (
            <form class="inline" method="post" action="/notifications/read">
              <button class="secondary" type="submit">
                {t('Mark all as read', 'Tout marquer comme lu')}
              </button>
            </form>
          )}
        </div>
      )}
      {props.notifications.length === 0 ? (
        <p class="muted">
          {t(
            'Nothing yet. Payouts, rewards and milestones will show up here.',
            'Rien pour l’instant. Tes paiements, tes récompenses et tes étapes atteintes vont apparaître ici.',
          )}
        </p>
      ) : (
        <div class="notification-list">
          {props.notifications.map((n) => (
            // Through /notifications/<id>: marked as read on the way.
            <a class={`card notification${n.read_at ? '' : ' unread'}`} href={`/notifications/${n.id}`}>
              <strong>{n.title}</strong>
              <span>{n.body}</span>
              <span class="muted">{timeLabel(n.created_at)}</span>
            </a>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function AdminEmailsPage(props: { user: User; log: EmailLogEntry[]; ok?: string; error?: string }) {
  return (
    <Layout title="Emails" user={props.user}>
      <h1>Emails</h1>
      <p class="muted">
        Every email shares one layout with your branding (logo, colour, footer). Edit the wording of each one below.
      </p>
      <Flash ok={props.ok} error={props.error} />
      <div class="two-col">
        <div class="template-list">
          {emailTypes.map((type) => (
            <a class="card template-item" href={`/admin/emails/${type}`}>
              <span>
                <strong>{definitions[type].label}</strong>
                <span class="muted">
                  {' '}
                  · to {definitions[type].audience.toLowerCase()}
                  {languagesOf(type).length > 1 ? ' · English and French' : ''}
                </span>
              </span>
              <span class={`badge${isCustomized(type) || isCustomized(type, 'fr') ? ' edited' : ''}`}>
                {isCustomized(type) || isCustomized(type, 'fr') ? 'Edited' : 'Default'}
              </span>
            </a>
          ))}
        </div>
        <form class="card stack-card" method="post" action="/admin/emails/settings">
          <h2 class="first">Replies</h2>
          <label>
            Reply-to address (where replies from promoters go; leave empty to use the sender)
            <input type="email" name="reply_to" value={getReplyTo()} placeholder="promoters@example.com" />
          </label>
          <button type="submit">Save</button>
        </form>
      </div>

      <h2>Recently sent</h2>
      {props.log.length === 0 ? (
        <p class="muted">Nothing sent yet.</p>
      ) : (
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>To</th>
                <th>Subject</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {props.log.map((e) => (
                <tr>
                  <td>{e.created_at.slice(5, 16)}</td>
                  <td>{e.recipient}</td>
                  <td>{e.subject}</td>
                  <td class={e.status === 'failed' ? 'failed' : ''}>
                    {e.status === 'sent' ? 'Sent' : 'Failed'}
                    {e.attempts > 1 ? ` after ${e.attempts} tries` : ''}
                    {e.error && <div class="muted">{e.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

export function AdminEmailEditPage(props: { user: User; type: EmailType; lang: Lang; version: string; ok?: string; error?: string }) {
  const def = definitions[props.type];
  const t = getTemplate(props.type, props.lang);
  const both = languagesOf(props.type).length > 1;
  const href = (l: Lang) => `/admin/emails/${props.type}${l === 'fr' ? '?lang=fr' : ''}`;
  return (
    <Layout title={def.label} user={props.user}>
      <p class="muted">
        <a href="/admin/emails">Emails</a> / {def.label}
      </p>
      <h1>{def.label}</h1>
      <p class="muted">
        Sent to {def.audience.toLowerCase()}
        {both ? ', in French to those whose browser is in French, in English to everyone else.' : '.'}
      </p>
      {both && (
        <nav class="tabs" aria-label="Language">
          <a href={href('en')} aria-current={props.lang === 'en' ? 'page' : undefined}>
            English
          </a>
          <a href={href('fr')} aria-current={props.lang === 'fr' ? 'page' : undefined}>
            Français
          </a>
        </nav>
      )}
      <Flash ok={props.ok} error={props.error} />
      <div class="email-editor">
        <form class="card stack-card" method="post" action={`/admin/emails/${props.type}`} lang={props.lang}>
          <input type="hidden" name="lang" value={props.lang} />
          <label>
            Subject
            <input name="subject" value={t.subject} maxlength={200} required />
          </label>
          <label>
            Heading
            <input name="heading" value={t.heading} maxlength={200} />
          </label>
          <label>
            Text (leave a blank line between paragraphs; **bold** for emphasis)
            <textarea name="body" rows={9} maxlength={4000}>
              {t.body}
            </textarea>
          </label>
          <label>
            Button label (leave empty for no button)
            <input name="button" value={t.button} maxlength={60} />
          </label>
          <p class="muted placeholders">
            Placeholders:{' '}
            {def.placeholders.map((p) => (
              <code>{`{{${p}}}`}</code>
            ))}
          </p>
          <div class="form-actions">
            <button type="submit" name="action" value="save">
              Save
            </button>
            <button class="secondary" type="submit" name="action" value="test">
              Save and send me a test
            </button>
            {isCustomized(props.type, props.lang) && (
              <button class="link" type="submit" name="action" value="reset" formnovalidate>
                Reset to default
              </button>
            )}
          </div>
        </form>
        <div>
          <p class="muted">Preview with sample details:</p>
          <iframe
            class="email-preview"
            src={`/admin/emails/${props.type}/preview?v=${props.version}${props.lang === 'fr' ? '&lang=fr' : ''}`}
            sandbox="allow-same-origin"
            title="Email preview"
          ></iframe>
        </div>
      </div>
    </Layout>
  );
}

const WELCOME_STEPS = 4;

function Steps(props: { at: number }) {
  return (
    <div
      class="steps"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={WELCOME_STEPS}
      aria-valuenow={props.at}
      aria-label={t(`Step ${props.at} of ${WELCOME_STEPS}`, `Étape ${props.at} sur ${WELCOME_STEPS}`)}
    >
      {Array.from({ length: WELCOME_STEPS }, (_, i) => (
        <span class={i < props.at ? 'done' : ''} />
      ))}
    </div>
  );
}

function SkipForm() {
  return (
    <form class="inline" method="post" action="/welcome/done">
      <button class="link" type="submit">
        {t('Skip for now', 'Passer pour l’instant')}
      </button>
    </form>
  );
}

export function WelcomePage(props: {
  user: User;
  step: number;
  codes: string[];
  pushKey: string;
  error?: string;
}) {
  const u = props.user;
  const hasPhoto = !!avatarOf(u);
  const brand = getBrand();
  const rules = rewardRules();
  const levels = rules.levels;
  const first = u.first_name || u.name.split(' ')[0];
  const fr = lang() === 'fr';
  const mb = Math.round(maxUploadBytes / 1024 / 1024);
  return (
    <Layout title={t('Welcome', 'Bienvenue')} user={u} hideInstallBanner>
      <div class="welcome">
        <Steps at={props.step} />
        {props.step === 1 && (
          <>
            <div class="welcome-hero">
              <Avatar user={u} size="large" />
              <h1>{t(`Welcome to ${brand.name}, ${first}`, `Bienvenue chez ${brand.name}, ${first}`)}</h1>
              <p class="muted">
                {t('Two minutes to get you set up. Here is how it works.', 'Deux minutes pour te préparer. Voici comment ça marche.')}
              </p>
            </div>
            <div class="how">
              <div class="card">
                <span class="num">1</span>
                <div>
                  <strong>{t('Share your promo codes', 'Partage tes codes promo')}</strong>
                  <div class="muted">
                    {t('Every ticket bought with', 'Chaque billet acheté avec')}{' '}
                    {props.codes.length ? props.codes.map((c) => <span class="code">{c}</span>) : t('your codes', 'tes codes')}{' '}
                    {t('counts for you, on every event, live.', 'compte pour toi, pour chaque événement, en direct.')}
                  </div>
                </div>
              </div>
              <div class="card">
                <span class="num">2</span>
                <div>
                  <strong>{t('Earn commission', 'Gagne une commission')}</strong>
                  <div class="muted">
                    {t(
                      'On every ticket sold with your codes, set by the team for each event. Request a payout whenever you like.',
                      'Sur chaque billet vendu avec tes codes, fixée par l’équipe pour chaque événement. Demande ton paiement quand tu veux.',
                    )}
                  </div>
                </div>
              </div>
              <div class="card">
                <span class="num">3</span>
                <div>
                  <strong>{t('Unlock rewards and levels', 'Débloque des récompenses et des niveaux')}</strong>
                  <div class="muted">
                    {trackOn(rules.tickets) && (
                      <>
                        {t('Free tickets for each event:', 'Billets gratuits pour chaque événement :')}{' '}
                        {describeTrack(rules.tickets, 'ticket').replace(/^./, (c) => c.toLowerCase())}{' '}
                      </>
                    )}
                    {trackOn(rules.merch) && (
                      <>
                        {t('Merch:', 'Marchandise :')} {describeTrack(rules.merch, 'merch').replace(/^./, (c) => c.toLowerCase())}{' '}
                      </>
                    )}
                    {levels.length > 1 &&
                      t(`Climb from ${levels[0]!.name} to ${levels.at(-1)!.name}.`, `Monte de ${levels[0]!.name} jusqu’à ${levels.at(-1)!.name}.`)}
                  </div>
                </div>
              </div>
            </div>
            <div class="welcome-actions">
              <SkipForm />
              <a class="button" href="/welcome?step=2">
                {t('Next', 'Suivant')}
              </a>
            </div>
          </>
        )}
        {props.step === 2 && (
          <>
            <h1>{t('About you', 'À propos de toi')}</h1>
            <p class="muted">
              {t(
                'So the team knows who you are and how to pay you. You can change this later in Account.',
                'Pour que l’équipe sache qui tu es et comment te payer. Tu pourras changer ça plus tard dans Compte.',
              )}
            </p>
            <form class="card stack-card" method="post" action="/welcome/profile">
              <div class="field-row">
                <label>
                  {t('First name', 'Prénom')}
                  <input name="first_name" value={u.first_name ?? ''} autocomplete="given-name" maxlength={60} required />
                </label>
                <label>
                  {t('Last name', 'Nom')}
                  <input name="last_name" value={u.last_name ?? ''} autocomplete="family-name" maxlength={60} />
                </label>
              </div>
              <label>
                {t('Phone', 'Téléphone')}
                <input name="phone" type="tel" value={u.phone ?? ''} autocomplete="tel" maxlength={30} />
              </label>
              <label>
                {t('City or region', 'Ville ou région')}
                <CityInput value={u.city} />
              </label>
              <label>
                {t('Instagram (its photo becomes your profile picture)', 'Instagram (sa photo devient ta photo de profil)')}
                <input name="instagram" value={u.instagram ?? ''} placeholder={t('@yourname', '@tonnom')} maxlength={60} />
              </label>
              <label>
                {t('How should we pay you?', 'Comment veux-tu recevoir tes paiements ?')}
                <select name="payout_method">
                  {config.payoutMethods.map((m) => (
                    <option value={m} selected={m === (u.payout_method ?? config.payoutMethods[0])}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Payout email (for e-Transfer)', 'Courriel pour les paiements (pour le virement Interac)')}
                <input name="payout_details" type="email" value={u.payout_details ?? u.email} maxlength={200} />
              </label>
              <div class="welcome-actions">
                <a href="/welcome?step=1">{t('Back', 'Retour')}</a>
                <button type="submit">{t('Next', 'Suivant')}</button>
              </div>
            </form>
          </>
        )}
        {props.step === 3 && (
          <>
            <h1>{t('Your photo', 'Ta photo')}</h1>
            <p class="muted">
              {t(
                'It shows on your public page and to the team. A clear photo of your face works best.',
                'Elle s’affiche sur ta page publique et pour l’équipe. Une photo claire de ton visage, c’est l’idéal.',
              )}
            </p>
            <Flash error={props.error} />
            <form class="card stack-card" method="post" action="/welcome/photo" enctype="multipart/form-data">
              <div class="photo-row">
                <Avatar user={u} size="large" />
                <div class="muted">
                  {!hasPhoto
                    ? t('No photo yet.', 'Pas encore de photo.')
                    : u.avatar_source === 'instagram'
                      ? t('This is your Instagram photo. Upload another one if you prefer.', 'C’est ta photo Instagram. Téléverses-en une autre si tu préfères.')
                      : t('Looking good. Upload another one to change it.', 'Belle photo! Téléverses-en une autre pour la changer.')}
                </div>
              </div>
              <label>
                {fr
                  ? `${hasPhoto ? 'Téléverser une autre photo' : 'Téléverser une photo'} (PNG, JPEG ou WebP, jusqu’à ${mb} Mo)`
                  : `${hasPhoto ? 'Upload another photo' : 'Upload a photo'} (PNG, JPEG or WebP, up to ${mb} MB)`}
                <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required={!hasPhoto} />
              </label>
              <div class="welcome-actions">
                <a href="/welcome?step=2">{t('Back', 'Retour')}</a>
                {!hasPhoto && <a href="/welcome?step=4">{t('Skip for now', 'Passer pour l’instant')}</a>}
                <button type="submit">{hasPhoto ? t('Next', 'Suivant') : t('Save my photo', 'Enregistrer ma photo')}</button>
              </div>
            </form>
          </>
        )}
        {props.step === 4 && (
          <>
            <h1>{t('Get the app', 'Installe l’app')}</h1>
            <p class="muted">
              {t(
                'Install it on your phone and turn on notifications to hear about every payout, reward and milestone.',
                'Installe-la sur ton téléphone et active les notifications pour être au courant de chaque paiement, récompense et étape atteinte.',
              )}
            </p>
            <InstallSteps />
            <div class="card push-box" data-push-key={props.pushKey}>
              <div>
                <strong>Notifications</strong>
                <div class="muted" data-push-status>
                  {t('On iPhone, do this from the app on your Home Screen.', 'Sur iPhone, fais-le à partir de l’app sur ton écran d’accueil.')}
                </div>
              </div>
              <div class="push-actions">
                <button type="button" data-push-toggle hidden>
                  {t('Turn on', 'Activer')}
                </button>
              </div>
            </div>
            <form class="welcome-actions" method="post" action="/welcome/done">
              <a href="/welcome?step=3">{t('Back', 'Retour')}</a>
              <button type="submit">{t('Go to my dashboard', 'Aller à mon tableau de bord')}</button>
            </form>
          </>
        )}
      </div>
    </Layout>
  );
}

type ShortLinkStatus = { enabled: boolean; host: string; domain: string; count: number; lastError: { at: Date; message: string } | null };

export function AdminLinksPage(props: {
  user: User;
  baseUrl: string;
  template: string;
  example: string | null;
  shortLinks: ShortLinkStatus;
  /** The Kutt account's domains; null when Kutt is off or did not answer. */
  kuttDomains: string[] | null;
  ok?: string;
  error?: string;
}) {
  const short = props.shortLinks;
  const domains = props.kuttDomains;
  return (
    <Layout title="Event links" user={props.user}>
      <h1>Event links</h1>
      <p class="muted">
        Each promoter gets a link per event with their promo code and alias, ready to copy and share. Hi.Events applies
        the code from <code>promo_code=</code> and credits the affiliate from <code>aff=</code>.
      </p>
      <Flash ok={props.ok} error={props.error} />
      <form class="card stack-card" method="post" action="/admin/links">
        <label>
          Ticketing site address (Hi.Events FRONTEND_URL)
          <input type="url" name="base_url" value={props.baseUrl} placeholder="https://tickets.example.com" required />
        </label>
        <label>
          Link format
          <input name="template" value={props.template} maxlength={300} required />
        </label>
        <p class="muted placeholders">
          <code>{'{event_url}'}</code> the event page, <code>{'{code}'}</code> the promo code, <code>{'{alias}'}</code> the
          promoter's alias.
        </p>
        {props.example && (
          <p>
            Example: <code class="example-link">{props.example}</code>
          </p>
        )}
        <button type="submit">Save</button>
      </form>
      <p class="muted">
        For aff= tracking in Hi.Events, create an affiliate with the same code as the promoter's alias on the event
        (Hi.Events → event → Affiliates).
      </p>
      <div class="card stack-card" id="short-links">
        <h2 class="first">Short links</h2>
        {short.enabled ? (
          <>
            <p>
              On: promoters share short links from <strong>{short.domain || short.host}</strong> ({short.count} {short.count === 1 ? 'link' : 'links'} so far), and
              see how many clicks each one gets. A short link keeps working when the link format, an alias or an event
              title changes.
            </p>
            {short.lastError && (
              <p class="flash error">
                Kutt last failed at {short.lastError.at.toLocaleString('en-CA', { timeZone: config.timezone })}: {short.lastError.message}.
                Promoters see the long links until it answers again.
              </p>
            )}
            <form class="stack-card" method="post" action="/admin/links/short-domain">
              <label>
                Domain for short links
                <select name="domain">
                  <option value="" selected={!short.domain}>
                    {short.host} (Kutt's own domain)
                  </option>
                  {(domains ?? []).map((d) => (
                    <option value={d} selected={d === short.domain}>
                      {d}
                    </option>
                  ))}
                  {short.domain && !(domains ?? []).includes(short.domain) && (
                    <option value={short.domain} selected>
                      {short.domain}
                      {domains ? ' (no longer in the Kutt account)' : ''}
                    </option>
                  )}
                </select>
              </label>
              <p class="muted">
                {domains
                  ? 'To add a domain, add it in Kutt (Settings → Domains) with the account this app uses, then reload this page.'
                  : 'Kutt did not answer, so its domains could not be listed. Reload in a few minutes.'}{' '}
                Changing the domain gives promoters new short links on it; the ones they already shared keep working.
              </p>
              <button type="submit">Save domain</button>
            </form>
          </>
        ) : (
          <p class="muted">
            Off. To give promoters short links with click counts, set <code>KUTT_URL</code> and <code>KUTT_API_KEY</code> to
            a Kutt site and the API key of a Kutt account kept for this app, then restart.
          </p>
        )}
      </div>
    </Layout>
  );
}

const BLANK_ROWS = 3;
const numberValue = (n: number) => (Number.isFinite(n) ? String(n) : '');
const colorNames: Record<LevelColor, string> = {
  gray: 'Gray',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  teal: 'Teal',
  blue: 'Blue (accent)',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
  green: 'Green',
};

function MilestoneRows(props: { prefix: 'ticket' | 'merch'; track: Track; unit: string }) {
  const rows = [...props.track.milestones, ...Array.from({ length: BLANK_ROWS }, () => ({ at: NaN, count: NaN, label: '' }))];
  return (
    <div class="table-wrap">
      <table class="rules-table">
        <thead>
          <tr>
            <th>At ({props.unit})</th>
            <th>Gives (1 if empty)</th>
            {props.prefix === 'merch' && <th>What (optional)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr>
              <td>
                <input type="number" name={`${props.prefix}_at`} value={numberValue(m.at)} min={1} max={LIMITS.tickets} aria-label={`Milestone ${i + 1}: ${props.unit}`} />
              </td>
              <td>
                <input type="number" name={`${props.prefix}_count`} value={numberValue(m.count)} min={1} max={LIMITS.count} aria-label={`Milestone ${i + 1}: how many (1 if empty)`} />
              </td>
              {props.prefix === 'merch' && (
                <td>
                  <input name="merch_label" value={m.label} maxlength={LIMITS.label} placeholder={i === 0 ? 'Like: Hoodie' : undefined} aria-label={`Milestone ${i + 1}: what`} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepeatRow(props: { prefix: 'ticket' | 'merch'; track: Track; unit: string }) {
  return (
    <div class="repeat-row">
      <span>Then</span>
      <input type="number" name={`${props.prefix}_every_count`} value={numberValue(props.track.count)} min={1} max={LIMITS.count} aria-label="How many each time" />
      {props.prefix === 'merch' && (
        <input name="merch_every_label" value={props.track.label} maxlength={LIMITS.label} placeholder="merch item" aria-label="What each time (optional)" />
      )}
      <span>every</span>
      <input type="number" name={`${props.prefix}_every`} value={numberValue(props.track.every)} min={0} max={LIMITS.tickets} aria-label={`Every how many ${props.unit}`} />
      <span>more {props.unit} (0 for none)</span>
    </div>
  );
}

export function AdminRewardsPage(props: { user: User; rules: RewardRules; saved: RewardRules; customized: boolean; ok?: string; error?: string }) {
  const { rules, saved } = props;
  const levelRows = [...rules.levels, ...Array.from({ length: BLANK_ROWS }, () => ({ name: '', at: NaN, color: '' as LevelColor }))];
  return (
    <Layout title="Levels & rewards" user={props.user}>
      <h1>Levels &amp; rewards</h1>
      <p class="muted">
        Promoters climb levels and earn free tickets and merch as they sell. Changes apply to everyone right away, counted
        from all their sales so far; rewards already requested stay requested.
      </p>
      <p class="muted">
        Commission is set on <a href="/admin/commissions">Commissions</a>; deals with VIP or guest list on{' '}
        <a href="/admin/rules">Rules (advanced)</a>.
      </p>
      <Flash ok={props.ok} error={props.error} />

      <div class="card stack-card rules-now">
        <h2 class="first">What promoters see now</h2>
        <p class="level-preview">
          {saved.levels.map((l) => (
            <span>
              <LevelBadge level={l} /> <span class="muted">{l.at}+</span>
            </span>
          ))}
        </p>
        <p>
          <strong>Free tickets for each event:</strong> {describeTrack(saved.tickets, 'ticket')}
        </p>
        <p>
          <strong>Merch:</strong> {describeTrack(saved.merch, 'merch')}
        </p>
      </div>

      <form method="post" action="/admin/rewards" class="stack-card rules-form">
        <div class="card stack-card">
          <h2 class="first">Levels</h2>
          <p class="muted">
            By tickets sold in total (with sales entered by hand). The first level starts at 0. To remove a level, clear its
            name.
          </p>
          <div class="table-wrap">
            <table class="rules-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>From (tickets)</th>
                  <th>Color</th>
                </tr>
              </thead>
              <tbody>
                {levelRows.map((l, i) => (
                  <tr>
                    <td>
                      <input name="level_name" value={l.name} maxlength={LIMITS.name} aria-label={`Level ${i + 1}: name`} />
                    </td>
                    <td>
                      <input type="number" name="level_at" value={numberValue(l.at)} min={0} max={LIMITS.tickets} aria-label={`Level ${i + 1}: from how many tickets`} />
                    </td>
                    <td>
                      <select name="level_color" aria-label={`Level ${i + 1}: color`}>
                        {levelColors.map((c) => (
                          <option value={c} selected={c === (l.color || levelColors[i % levelColors.length])}>
                            {colorNames[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card stack-card">
          <h2 class="first">Free tickets</h2>
          <p class="muted">
            Counted per event, from the promoter's sales for that event. They use them on that event or ask to roll them
            over to another upcoming one; you accept or decline each request. Unrequested ones are lost when the event is
            over. Clear a row to remove it; leave every row empty and "every" at 0 to turn free tickets off.
          </p>
          <MilestoneRows prefix="ticket" track={rules.tickets} unit="sales" />
          <RepeatRow prefix="ticket" track={rules.tickets} unit="sales" />
        </div>

        <div class="card stack-card">
          <h2 class="first">Merch</h2>
          <p class="muted">
            Counted from all tickets sold. Name what each milestone gives (like Hoodie) or leave it empty for "a merch item";
            the promoter tells you the size when they request it. Clear a row to remove it; leave every row empty and "every" at
            0 to turn merch off.
          </p>
          <MilestoneRows prefix="merch" track={rules.merch} unit="tickets" />
          <RepeatRow prefix="merch" track={rules.merch} unit="tickets" />
        </div>

        <button type="submit">Save levels and rewards</button>
      </form>

      {props.customized && (
        <form method="post" action="/admin/rewards/reset" class="reset-rules">
          <button type="submit" class="secondary">
            Back to the default levels and rewards
          </button>
        </form>
      )}
    </Layout>
  );
}

export function LevelBadge(props: { level: Level; tiny?: boolean }) {
  return <span class={`level-badge level-c-${props.level.color}${props.tiny ? ' tiny' : ''}`}>{props.level.name}</span>;
}

// Drawn with CSS rather than emoji, which some phones and fonts show as empty boxes.
const medal = (rank: number) => <span class={`rank-badge${rank <= 3 ? ` rank-${rank}` : ''}`}>{rank}</span>;

/** When each promoter last came, signed in, installed the app and turned on two-step verification. */
function PromoterActivity(props: { promoters: User[] }) {
  // Most recently active first; never signed in last.
  const promoters = [...props.promoters].sort((a, b) => (b.last_seen_at ?? 0) - (a.last_seen_at ?? 0) || a.name.localeCompare(b.name));
  const installed = promoters.filter((p) => p.app_installed_at).length;
  const twoFactor = promoters.filter((p) => p.totp_enabled_at).length;
  const ago = (epoch: number, now: string) => {
    const text = since(epoch).replace('active now', now);
    return text[0]!.toUpperCase() + text.slice(1);
  };
  const day = (epoch: number) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: config.timezone }).format(new Date(epoch * 1000));
  return (
    <>
      <h2 id="activity">Promoter activity</h2>
      {promoters.length === 0 ? (
        <p class="muted">No promoters yet.</p>
      ) : (
        <>
          <p class="muted">
            {installed} of {promoters.length} installed the app · {twoFactor} of {promoters.length} use two-step verification.
          </p>
          <div class="card table-wrap">
            <table class="leaderboard activity">
              <thead>
                <tr>
                  <th>Promoter</th>
                  <th>Last active</th>
                  <th>Last sign-in</th>
                  <th>App</th>
                  <th>Two-step</th>
                </tr>
              </thead>
              <tbody>
                {promoters.map((p) => (
                  <tr>
                    <td>
                      <a class="who" href={`/admin/promoters/${p.id}`}>
                        <Avatar user={p} size="small" />
                        <span>{p.name}</span>
                      </a>
                    </td>
                    <td class={p.last_seen_at ? undefined : 'muted'}>{p.last_seen_at ? ago(p.last_seen_at, 'active now') : 'Never'}</td>
                    <td class={p.last_login_at ? undefined : 'muted'}>{p.last_login_at ? ago(p.last_login_at, 'just now') : 'Never'}</td>
                    <td>
                      {p.app_installed_at ? (
                        <span class="chip" title={`Since ${day(p.app_installed_at)}`}>Installed</span>
                      ) : (
                        <span class="muted">No</span>
                      )}
                    </td>
                    <td>
                      {p.totp_enabled_at ? (
                        <span class="chip" title={`Since ${day(p.totp_enabled_at)}`}>On</span>
                      ) : (
                        <span class="muted">Off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// Promoters ranked for the period, on the admin dashboard and on team pages.
function BoardTable(props: {
  board: Leaderboard;
  sort: Sort;
  sortHref: (s: Sort) => string;
  href?: (u: User) => string; // none: names are not links
  owed?: boolean;
  leadId?: number; // tagged "Team lead" on team pages
}) {
  const { board, sort, sortHref } = props;
  const cur = board.currency;
  return (
    <div class="card table-wrap">
      <table class="leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('Promoter', 'Promoteur')}</th>
            <th class="num">
              <a href={sortHref('tickets')} aria-current={sort === 'tickets' ? 'true' : undefined}>{t('Tickets', 'Billets')}</a>
            </th>
            <th class="num">
              <a href={sortHref('sales')} aria-current={sort === 'sales' ? 'true' : undefined}>{t('Sales', 'Ventes')}</a>
            </th>
            <th class="num">
              <a href={sortHref('commission')} aria-current={sort === 'commission' ? 'true' : undefined}>{t('Commission', 'Commission')}</a>
            </th>
            {props.owed && <th class="num">{t('Owed', 'Dû')}</th>}
            <th>{t('Last sale', 'Dernière vente')}</th>
          </tr>
        </thead>
        <tbody>
          {board.entries.map((e, i) => (
            <tr>
              <td class="rank">{medal(i + 1)}</td>
              <td>
                {(() => {
                  const who = (
                    <>
                      <Avatar user={e.user} size="small" />
                      <span>
                        {e.user.name}
                        <LevelBadge level={e.level} tiny />
                        {e.user.id === props.leadId && <span class="lead-tag">{t('Team lead', 'Chef d’équipe')}</span>}
                      </span>
                    </>
                  );
                  return props.href ? (
                    <a class="who" href={props.href(e.user)}>
                      {who}
                    </a>
                  ) : (
                    <span class="who">{who}</span>
                  );
                })()}
              </td>
              <td class="num">{e.tickets}</td>
              <td class="num">{formatMoney(e.fullPrice, cur)}</td>
              <td class="num">{formatMoney(e.commission, cur)}</td>
              {props.owed && <td class="num">{formatMoney(e.owed, cur)}</td>}
              <td class="muted">{e.lastSale ?? t('No sales yet', 'Aucune vente encore')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type TeamRow = { lead: User; members: number; tickets: number; sales: number; commission: number; teamCommission: number };

// City, with suggestions of Canadian places as they type (public/places.json, loaded by /app.js on first
// focus; no outside service). Anything else can still be typed.
export function CityInput(props: { value: string | null | undefined }) {
  return (
    <input
      id="city"
      name="city"
      value={props.value ?? ''}
      autocomplete="off"
      maxlength={80}
      placeholder={t('Montréal, QC', 'Montréal (QC)')}
      data-places={`/places.json?v=${placesVersion}`}
    />
  );
}

// The colour tiers of the promoter map, as in /map.js.
const tierOf = (n: number) => (n >= 10 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1);
const tiers = [
  { tier: 1, label: '1' },
  { tier: 2, label: '2–4' },
  { tier: 3, label: '5–9' },
  { tier: 4, label: '10+' },
];

// Where promoters are, by city, as a heat map (/map.js with Leaflet and OpenStreetMap tiles). Admins see
// everyone; team leads their team. Cities only, never more precise. Each place opens (on the map, or in
// the list below it, which works without the map too) to its promoters, linking to their page.
export function PromoterMapCard(props: { title: string; users: User[]; promoterHref: (u: User) => string }) {
  const map = promoterMap(props.users);
  const onMap = map.points.reduce((n, p) => n + p.users.length, 0);
  const promoters = (n: number) => plural(n, ['promoter', 'promoteur'], ['promoters', 'promoteurs']);
  const places = (n: number) => plural(n, ['place', 'endroit'], ['places', 'endroits']);
  // What the map needs: the place, and its promoters' names and links (relative to the app).
  const data = map.points.map((p) => ({ label: p.label, lat: p.lat, lng: p.lng, people: p.users.map((u) => ({ name: u.name, href: props.promoterHref(u) })) }));
  const people = (users: User[]) => (
    <ul class="map-people">
      {users.map((u) => (
        <li>
          <a class="who" href={props.promoterHref(u)}>
            <Avatar user={u} size="small" />
            <span>{u.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <h2>{props.title}</h2>
      <div class="card map-card">
        {map.points.length > 0 ? (
          <>
            <link rel="stylesheet" href={`/vendor/leaflet.css?v=${vendorVersion}`} />
            <div
              class="promoter-map"
              data-promoter-map={JSON.stringify(data)}
              role="img"
              aria-label={t(
                `Map of ${promoters(onMap)} in ${places(map.points.length)}. The places are listed below.`,
                `Carte de ${promoters(onMap)} dans ${places(map.points.length)}. Les endroits sont listés plus bas.`,
              )}
            />
            <script src={`/vendor/leaflet.js?v=${vendorVersion}`} defer />
            <script src={`/vendor/leaflet-heat.js?v=${vendorVersion}`} defer />
            <script src="/map.js" defer />
            <ul class="map-legend" aria-label={t('Promoters per place', 'Promoteurs par endroit')}>
              <li>{t('Promoters per place:', 'Promoteurs par endroit :')}</li>
              {tiers.map((tier) => (
                <li>
                  <span class={`map-pin tier-${tier.tier}`} aria-hidden="true" />
                  {tier.label}
                </li>
              ))}
            </ul>
            <p class="muted">
              {t(
                'Tap a place on the map, or open one below, to see its promoters. Nearby places share a pin when zoomed out.',
                'Touche un endroit sur la carte, ou ouvre-en un plus bas, pour voir ses promoteurs. Les endroits proches partagent une épingle quand on dézoome.',
              )}
            </p>
            <div class="map-places">
              {map.points.map((p) => (
                <details class="map-place" data-place={p.label}>
                  <summary>
                    <span>{p.label}</span>
                    <span class={`map-count tier-${tierOf(p.users.length)}`}>{p.users.length}</span>
                  </summary>
                  {people(p.users)}
                </details>
              ))}
            </div>
          </>
        ) : (
          <p class="muted">{t('No promoter has a city that can be put on the map yet.', 'Aucun promoteur n’a encore une ville qu’on peut placer sur la carte.')}</p>
        )}
        {map.noCity.length > 0 && (
          <details class="map-place map-missing">
            <summary>
              <span>{t('No city yet', 'Pas encore de ville')}</span>
              <span class="map-count">{map.noCity.length}</span>
            </summary>
            <p class="muted map-note">{t('They are reminded on their dashboard.', 'Un rappel s’affiche sur leur tableau de bord.')}</p>
            {people(map.noCity)}
          </details>
        )}
        {map.unknown.length > 0 && (
          <details class="map-place map-missing">
            <summary>
              <span>{t('City not found on the map', 'Ville introuvable sur la carte')}</span>
              <span class="map-count">{map.unknown.length}</span>
            </summary>
            <ul class="map-people">
              {map.unknown.map((u) => (
                <li>
                  <a class="who" href={props.promoterHref(u)}>
                    <Avatar user={u} size="small" />
                    <span>
                      {u.name} <span class="muted">({u.city})</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

export function AdminDashboardPage(props: { user: User; board: Leaderboard; teams: TeamRow[]; range: Range; sort: Sort; promoters: User[] }) {
  const { board, range, sort } = props;
  const cur = board.currency;
  const sortHref = (s: Sort) => `/admin/dashboard?range=${range}&sort=${s}`;
  const rangeLabel = range === 'all' ? 'all time' : `last ${range} days`;
  const teamTotal = props.teams.reduce((sum, t) => sum + t.teamCommission, 0);
  return (
    <Layout title="Dashboard" user={props.user}>
      <div class="dash-head">
        <h1>Dashboard</h1>
        <RangeLinks current={range} basePath={`/admin/dashboard`} />
      </div>
      <p class="muted">Sales through promoter codes, {rangeLabel}.</p>
      <div class="grid">
        <div class="card stat highlight">
          <div class="value">{board.totals.tickets}</div>
          <div class="label">Tickets sold by promoters</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(board.totals.fullPrice, cur)}</div>
          <div class="label">Sales at full price</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(board.totals.commission + teamTotal, cur)}</div>
          <div class="label">Commission earned{teamTotal > 0 && <> · incl. {formatMoney(teamTotal, cur)} team commission</>}</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(board.totals.owed, cur)}</div>
          <div class="label">
            Still owed (all time){board.totals.pending > 0 && <> · <a href="/admin/payouts">{board.totals.pending} waiting</a></>}
          </div>
        </div>
      </div>

      <SalesChart title="Tickets sold per day" daily={board.daily} percent={100} range={range} basePath="/admin/dashboard" currency={cur} />

      <h2>Best promoters</h2>
      {board.entries.length === 0 ? (
        <p class="muted">No promoters with codes yet.</p>
      ) : (
        <BoardTable board={board} sort={sort} sortHref={sortHref} href={(u) => `/admin/promoters/${u.id}`} owed />
      )}

      {props.teams.length > 0 && (
        <>
          <h2>Teams</h2>
          <p class="muted">Each team with its team lead, {rangeLabel}. Commission is what the team lead and their promoters earn on their own sales; team commission is the team lead's share of their promoters' sales.</p>
          <div class="card table-wrap">
            <table class="leaderboard">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team lead</th>
                  <th class="num">Promoters</th>
                  <th class="num">Tickets</th>
                  <th class="num">Sales</th>
                  <th class="num">Commission</th>
                  <th class="num">Team commission</th>
                </tr>
              </thead>
              <tbody>
                {props.teams.map((t, i) => (
                  <tr>
                    <td class="rank">{medal(i + 1)}</td>
                    <td>
                      <a class="who" href={`/admin/teams/${t.lead.id}?range=${range}`}>
                        <Avatar user={t.lead} size="small" />
                        <span>{t.lead.name}</span>
                      </a>
                    </td>
                    <td class="num">{t.members}</td>
                    <td class="num">{t.tickets}</td>
                    <td class="num">{formatMoney(t.sales, cur)}</td>
                    <td class="num">{formatMoney(t.commission, cur)}</td>
                    <td class="num">
                      {formatMoney(t.teamCommission, cur)}
                      <div class="muted">{teamCommissionPercentFor(t.lead) > 0 ? formatPercent(teamCommissionPercentFor(t.lead)) : 'team rule'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PromoterMapCard title="Where promoters are" users={props.promoters} promoterHref={(u) => `/admin/promoters/${u.id}`} />

      <PromoterActivity promoters={props.promoters} />
    </Layout>
  );
}

/** "Team commission (10% of $1,516.00)", "(team rule)" or "(10% of $1,516.00 + team rule)". */
function teamLabel(percent: number, sales: number, rule: number, cur: string): string {
  const parts = [
    percent > 0 ? t(`${formatPercent(percent)} of ${formatMoney(sales, cur)}`, `${formatPercent(percent)} de ${formatMoney(sales, cur)}`) : '',
    rule > 0 ? t('team rule', 'règle d’équipe') : '',
  ].filter(Boolean);
  const label = t('Team commission', 'Commission d’équipe');
  return parts.length ? `${label} (${parts.join(' + ')})` : label;
}

// A team's sales, team lead included. Three views: the team lead's on /team (with their team
// commission and each promoter's dashboard), a promoter's on /team (the team's totals and their own,
// but not who else is on the team or what they sold), and an admin's on /admin/teams/:id. Nothing to act on.
export function TeamPage(props: {
  user: User;
  lead: User;
  members: User[];
  board: Leaderboard;
  team: TeamCommission[];
  range: Range;
  sort: Sort;
  basePath: string;
  memberHref: ((u: User) => string) | null; // null for a promoter looking at their own team
}) {
  const { board, range, sort } = props;
  const cur = board.currency;
  const mode = props.lead.id === props.user.id ? 'lead' : props.memberHref ? 'admin' : 'member';
  const self = mode === 'lead';
  const mine = mode !== 'admin';
  const sortHref = (s: Sort) => `${props.basePath}?range=${range}&sort=${s}`;
  const rangeLabel = range === 'all' ? t('all time', 'depuis le début') : t(`last ${range} days`, `${range} derniers jours`);
  const ranked = new Set(board.entries.map((e) => e.user.id));
  const notSelling = props.members.filter((m) => !ranked.has(m.id));
  const percent = teamCommissionPercentFor(props.lead);
  const team = props.team.find((t) => t.currency === cur) ?? { sales: 0, commission: 0 };
  const href = props.memberHref ? (u: User) => (u.id === props.lead.id && self ? '/' : props.memberHref!(u)) : undefined;
  const yours = board.entries.find((e) => e.user.id === props.user.id) ?? { tickets: 0, fullPrice: 0 };
  const intro = {
    lead: t('Sales by your team, you included', 'Ventes de ton équipe, incluant les tiennes'),
    member: t(
      `Sales by your team, ${props.lead.name} (your team lead) and you included`,
      `Ventes de ton équipe, incluant celles de ${props.lead.name} (ton chef d’équipe) et les tiennes`,
    ),
    admin: `Sales by ${props.lead.name}'s team, ${props.lead.name} included`,
  }[mode];
  const myTeam = t('My team', 'Mon équipe');
  return (
    <Layout title={mine ? myTeam : `${props.lead.name}'s team`} user={props.user}>
      {!mine && (
        <p class="muted">
          <a href="/admin/teams">Teams</a> / {props.lead.name}
        </p>
      )}
      <div class="dash-head">
        <h1>{mine ? myTeam : `${props.lead.name}'s team`}</h1>
        <RangeLinks current={range} basePath={props.basePath} />
      </div>
      <p class="muted">
        {intro}, {rangeLabel}.
        {self && t(' Payouts and rewards stay with each promoter and the admins.', ' Les paiements et les récompenses restent entre chaque promoteur et les admins.')}
      </p>
      {self && (
        <p>
          <a href="/team/invites">{t('Invite promoters to your team →', 'Inviter des promoteurs dans ton équipe →')}</a>
        </p>
      )}
      <div class="grid">
        {mode === 'member' ? (
          <div class="card stat highlight">
            <div class="value">{yours.tickets}</div>
            <div class="label">{t('Tickets sold by you', 'Billets vendus par toi')}</div>
          </div>
        ) : (
          <div class="card stat highlight">
            <div class="value">{formatMoney(team.commission, cur)}</div>
            <div class="label">
              {teamLabel(percent, team.sales, (team as TeamCommission).rule ?? 0, cur)}
            </div>
          </div>
        )}
        <div class="card stat">
          <div class="value">{board.totals.tickets}</div>
          <div class="label">{t('Tickets sold by the team', 'Billets vendus par l’équipe')}</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(board.totals.fullPrice, cur)}</div>
          <div class="label">{t('Sales at full price', 'Ventes au plein prix')}</div>
        </div>
        {mode === 'member' && (
          <div class="card stat">
            <div class="value">{formatMoney(yours.fullPrice, cur)}</div>
            <div class="label">{t('Your sales at full price', 'Tes ventes au plein prix')}</div>
          </div>
        )}
        <div class="card stat">
          <div class="value">{props.members.length}</div>
          <div class="label">
            {t(
              `${props.members.length === 1 ? 'Promoter' : 'Promoters'} on the team`,
              `${props.members.length < 2 ? 'Promoteur' : 'Promoteurs'} dans l’équipe`,
            )}
          </div>
        </div>
      </div>
      {mode !== 'member' && (
        <p class="muted">
          {percent > 0
            ? self
              ? t(
                  `The team commission is ${formatPercent(percent)} of the full-price sales of your promoters, from the day each joined the team, on top of what they earn. Your own sales earn your own commission. It is part of your balance on Payouts.`,
                  `La commission d’équipe est de ${formatPercent(percent)} des ventes au plein prix de tes promoteurs, à partir du jour où chacun s’est joint à l’équipe, en plus de ce qu’ils gagnent. Tes propres ventes te rapportent ta propre commission. Elle fait partie de ton solde dans Paiements.`,
                )
              : `The team commission is ${formatPercent(percent)} of the full-price sales of ${props.lead.name}'s promoters, from the day each joined the team, on top of what they earn. Their own sales earn their own commission. It is part of their balance on Payouts.`
            : self
              ? t('No team commission is set for you yet.', 'Aucune commission d’équipe n’est encore fixée pour toi.')
              : 'No team commission is set. Set it on Teams.'}
        </p>
      )}

      <SalesChart
        title={t('Tickets sold per day', 'Billets vendus par jour')}
        daily={board.daily}
        percent={100}
        range={range}
        basePath={props.basePath}
        currency={cur}
        ticketsOnly={mode === 'member'}
      />

      {mode !== 'member' && <h2>{mine ? t('Your team', 'Ton équipe') : 'The team'}</h2>}
      {props.members.length === 0 && mode !== 'member' && (
        <p class="muted">
          {self
            ? t('No promoters on your team yet. An admin adds them.', 'Pas encore de promoteurs dans ton équipe. Un admin les ajoute.')
            : 'No promoters on this team yet.'}
        </p>
      )}
      {/* A promoter sees the team's totals, not who else is on it or what they sold: that is for the team lead. */}
      {mode !== 'member' && board.entries.length > 0 && (
        <BoardTable
          board={board}
          sort={sort}
          sortHref={sortHref}
          href={href}
          leadId={props.lead.id}
        />
      )}
      {mode !== 'member' && notSelling.length > 0 && (
        <p class="muted">
          {t('No codes yet:', 'Pas encore de codes :')}{' '}
          {notSelling.map((m, i) => (
            <>
              {i > 0 && ', '}
              {href ? <a href={href(m)}>{m.name}</a> : m.name}
            </>
          ))}
        </p>
      )}
      {mode !== 'member' && href && (
        <PromoterMapCard title={mine ? t('Where your team is', 'Où est ton équipe') : 'Where the team is'} users={[props.lead, ...props.members]} promoterHref={href} />
      )}
    </Layout>
  );
}

function PromoterSelect(props: { name: string; promoters: User[]; label: string }) {
  return (
    <select name={props.name} required aria-label={props.label}>
      <option value="">{props.label}</option>
      {props.promoters.map((p) => (
        <option value={String(p.id)}>{p.name}</option>
      ))}
    </select>
  );
}

// A team lead's share of their promoters' sales, on Teams and on the team lead's admin page.
function TeamCommissionForm(props: { lead: User; from: 'teams' | 'promoter' }) {
  return (
    <form class="team-rate" method="post" action={`/admin/teams/${props.lead.id}/commission`}>
      <input type="hidden" name="from" value={props.from} />
      <label>
        Team commission % on their promoters' sales
        <span class="team-rate-row">
          <input
            type="number"
            name="team_commission_percent"
            min="0"
            max="100"
            step="0.01"
            value={props.lead.team_commission_percent == null ? '' : String(props.lead.team_commission_percent)}
            placeholder="0"
          />
          <button class="secondary" type="submit">
            Save
          </button>
        </span>
      </label>
    </form>
  );
}

// Invite links: on People → Invite links for admins, and on My team → Invite for team leads.
export function InvitesPage(props: {
  user: User;
  invites: InviteLink[];
  teamLeads: User[]; // admins: the teams a link can put people on
  names: Map<number, string>;
  ok?: string;
  error?: string;
}) {
  const admin = !!props.user.is_admin;
  const base = admin ? '/admin/invites' : '/team/invites';
  const state = { open: t('Working', 'Actif'), off: t('Turned off', 'Désactivé'), expired: t('Expired', 'Expiré'), full: t('Full', 'Complet') } as const;
  const day = (epoch: number) => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: config.timezone }).format(new Date(epoch * 1000));
  return (
    <Layout title={t('Invite links', 'Liens d’invitation')} user={props.user}>
      {!admin && (
        <p class="muted">
          <a href="/team">{t('My team', 'Mon équipe')}</a> / {t('Invite links', 'Liens d’invitation')}
        </p>
      )}
      <h1>{t('Invite links', 'Liens d’invitation')}</h1>
      <p class="muted">
        {admin
          ? 'Share a link: whoever opens it enters their name and email, gets a sign-in link by email and becomes a promoter. You are told when someone joins, so you can give them their promo codes.'
          : t(
              'Share a link: whoever opens it enters their name and email, gets a sign-in link by email and joins your team. The admins give them their promo codes.',
              'Partage un lien : la personne qui l’ouvre entre son nom et son courriel, reçoit un lien de connexion par courriel et rejoint ton équipe. Les admins lui donnent ses codes promo.',
            )}
      </p>
      <Flash error={props.error} ok={props.ok} />

      <form class="card stack-card invite-form" method="post" action={base}>
        <h2 class="first">{t('New invite link', 'Nouveau lien d’invitation')}</h2>
        <label>
          {t('Name (for you, like "Montreal street team")', 'Nom (pour toi, comme « Équipe de rue Laval »)')}
          <input name="label" maxlength={80} required />
        </label>
        <div class="field-row">
          {admin && (
            <label>
              Team
              <select name="team_lead_id">
                <option value="">No team</option>
                {props.teamLeads.map((l) => (
                  <option value={String(l.id)}>{l.name}'s team</option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('Works for', 'Valide pendant')}
            <select name="days">
              <option value="7">{t('7 days', '7 jours')}</option>
              <option value="1">{t('1 day', '1 jour')}</option>
              <option value="30">{t('30 days', '30 jours')}</option>
              <option value="">{t('No end date', 'Sans date de fin')}</option>
            </select>
          </label>
          <label>
            {t('Sign-ups (empty for no limit)', 'Inscriptions (vide pour aucune limite)')}
            <input name="max_uses" type="number" min="1" max="1000" step="1" />
          </label>
        </div>
        <button type="submit">{t('Create link', 'Créer le lien')}</button>
      </form>

      <h2>{t('Links', 'Liens')}</h2>
      {props.invites.length === 0 ? (
        <p class="muted">{t('No invite links yet.', 'Aucun lien d’invitation pour l’instant.')}</p>
      ) : (
        <div class="rows">
          {props.invites.map((i) => {
            const st = inviteState(i);
            return (
              <div class={`card invite-card${st === 'open' ? '' : ' invite-closed'}`}>
                <div class="invite-head">
                  <strong>{i.label}</strong>
                  <span class={`invite-state invite-${st}`}>{state[st]}</span>
                </div>
                <p class="muted invite-meta">
                  {plural(i.uses, ['sign-up', 'inscription'], ['sign-ups', 'inscriptions'])}
                  {i.max_uses !== null ? t(` of ${i.max_uses}`, ` sur ${i.max_uses}`) : ''}
                  {i.expires_at
                    ? ` · ${i.expires_at < Date.now() / 1000 ? t('ended', 'terminé le') : t('works until', 'valide jusqu’au')} ${day(i.expires_at)}`
                    : t(' · no end date', ' · sans date de fin')}
                  {admin && (i.team_lead_id ? ` · ${props.names.get(i.team_lead_id) ?? 'a team lead'}'s team` : ' · no team')}
                  {admin && i.created_by && ` · made by ${props.names.get(i.created_by) ?? 'someone'}`}
                </p>
                {st === 'open' && <LinkField link={`${config.appUrl}/join/${i.token}`} label={t(`Join: ${i.label}`, `Rejoindre : ${i.label}`)} />}
                {(st === 'open' || st === 'off') && (
                  <form method="post" action={`${base}/${i.id}/${st === 'off' ? 'on' : 'off'}`}>
                    <button class="link" type="submit">
                      {st === 'off' ? t('Turn back on', 'Réactiver') : t('Turn off', 'Désactiver')}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

// The page an invite link opens: name and email, or why the link does not work.
export function JoinPage(props: { invite: InviteLink | null; team?: string | null; signedIn?: boolean; error?: string; values?: Record<string, string> }) {
  const brand = getBrand();
  const st = props.invite ? inviteState(props.invite) : null;
  return (
    <Layout title={t('Join', 'Rejoindre')}>
      <div class="login card">
        <h1 class="login-brand">
          <BrandMark brand={brand} />
        </h1>
        {!props.invite || st !== 'open' ? (
          <>
            <p>
              {props.invite
                ? t('This invite link no longer works.', 'Ce lien d’invitation ne fonctionne plus.')
                : t('This invite link does not work.', 'Ce lien d’invitation ne fonctionne pas.')}
            </p>
            <p class="muted">{t('Ask whoever sent it for a new one.', 'Demande-en un nouveau à la personne qui te l’a envoyé.')}</p>
          </>
        ) : props.signedIn ? (
          <>
            <p>{t('You already have an account.', 'Tu as déjà un compte.')}</p>
            <p>
              <a href="/">{t('Go to your dashboard', 'Aller à ton tableau de bord')}</a>
            </p>
          </>
        ) : (
          <>
            <p>
              {t(
                `Join as a promoter${props.team ? ` on ${props.team}'s team` : ''}: follow the tickets you sell, your commission and your rewards, live.`,
                `Deviens promoteur${props.team ? ` dans l’équipe de ${props.team}` : ''} : suis en direct les billets que tu vends, ta commission et tes récompenses.`,
              )}
            </p>
            <Flash error={props.error} />
            <form class="stack" method="post" action={`/join/${props.invite.token}`}>
              <div class="field-row">
                <label>
                  {t('First name', 'Prénom')}
                  <input name="first_name" value={props.values?.first_name ?? ''} maxlength={60} autocomplete="given-name" required />
                </label>
                <label>
                  {t('Last name', 'Nom')}
                  <input name="last_name" value={props.values?.last_name ?? ''} maxlength={60} autocomplete="family-name" required />
                </label>
              </div>
              <label>
                {t('Email', 'Courriel')}
                <input type="email" name="email" value={props.values?.email ?? ''} maxlength={254} autocomplete="email" required />
              </label>
              <button type="submit">{t('Join', 'Rejoindre')}</button>
            </form>
            <p class="muted">
              {t('We email you a link to sign in. Already a promoter?', 'On t’envoie un lien de connexion par courriel. Déjà promoteur?')}{' '}
              <a href="/login">{t('Sign in', 'Se connecter')}</a>
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}

// Pay & rewards → Commissions: every event that is not over, with the promoters who have one of its codes
// and how each one is paid for it.
export function AdminCommissionsPage(props: {
  user: User;
  events: { id: number; title: string; start: Date | null; timezone: string | null; currency: string; promoters: User[] }[];
  rules: Map<string, EventRule>;
  ok?: string;
  error?: string;
}) {
  return (
    <Layout title="Commissions" user={props.user}>
      <h1>Commissions</h1>
      <p class="muted">
        Choose how each promoter is paid for each event: their usual percentage, another percentage, or a flat amount per
        ticket sold. Only events that are not over are listed. A change applies to all their sales for the event,
        earlier ones too, and promoters see it on their dashboard.
      </p>
      <p class="muted">
        This is the simple way to set pay. For VIP, guest list or bonus deals, use{' '}
        <a href="/admin/rules">Rules (advanced)</a>; a promoter&rsquo;s usual rate is on their page.
      </p>
      <Flash error={props.error} ok={props.ok} />
      {props.events.length === 0 && <p class="muted">No upcoming events with promoter codes.</p>}
      {props.events.map((e) => (
        <div class="card rate-card" id={`event-${e.id}`}>
          <h2 class="first">{e.title}</h2>
          <p class="muted">{formatDate(e.start, e.timezone)}</p>
          <div class="rate-rows">
            {e.promoters.map((p) => {
              const rule = props.rules.get(`${p.id}:${e.id}`);
              const usual = describeRule(usualRuleFor(p), e.currency);
              return (
                <form class="rate-row" method="post" action="/admin/commissions">
                  <input type="hidden" name="user_id" value={String(p.id)} />
                  <input type="hidden" name="event_id" value={String(e.id)} />
                  <a class="who" href={`/admin/promoters/${p.id}`}>
                    <Avatar user={p} size="small" />
                    <span>
                      {p.name}
                      <span class="muted rate-now">{rule ? describeRule(rule, e.currency) : `Usual rate, ${usual}`}</span>
                    </span>
                  </a>
                  <span class="rate-fields">
                    <select name="kind" aria-label={`How ${p.name} is paid for ${e.title}`}>
                      <option value="usual" selected={!rule}>
                        Usual rate ({usual})
                      </option>
                      <option value="percent" selected={rule?.kind === 'percent'}>
                        % of sales
                      </option>
                      <option value="flat" selected={rule?.kind === 'flat'}>
                        {e.currency} per ticket
                      </option>
                    </select>
                    <input
                      name="value"
                      inputmode="decimal"
                      aria-label="Percentage or amount per ticket"
                      placeholder="10 or 2.50"
                      value={rule ? (rule.kind === 'flat' ? (rule.value / 100).toFixed(2) : String(rule.value)) : ''}
                    />
                    <button class="secondary" type="submit">
                      Save
                    </button>
                  </span>
                </form>
              );
            })}
          </div>
        </div>
      ))}
    </Layout>
  );
}

// Events → Media drives: a public folder per event (photos, videos, flyers) for the promoters on it.
export function AdminMediaPage(props: {
  user: User;
  events: { id: number; title: string; start: Date | null; timezone: string | null; promoters: User[] }[];
  drives: Map<number, string>;
  ok?: string;
  error?: string;
}) {
  return (
    <Layout title="Media drives" user={props.user}>
      <h1>Media drives</h1>
      <p class="muted">
        Add a link to a shared folder (Google Drive, Dropbox…) with the photos, videos and flyers for an event. The
        promoters with a code on the event get a Media drive button on their dashboard and on the event page. Share
        the folder so anyone with the link can open it. Only drafts and events that are not over are listed.
      </p>
      <Flash error={props.error} ok={props.ok} />
      {props.events.length === 0 && <p class="muted">No upcoming events with promoter codes.</p>}
      {props.events.map((e) => {
        const url = props.drives.get(e.id);
        return (
          <div class="card rate-card" id={`event-${e.id}`}>
            <h2 class="first">{e.title}</h2>
            <p class="muted">
              {formatDate(e.start, e.timezone)} · {e.promoters.length} {e.promoters.length === 1 ? 'promoter' : 'promoters'}
              {url && (
                <>
                  {' · '}
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    Open the drive
                  </a>
                </>
              )}
            </p>
            <form class="media-form" method="post" action="/admin/media">
              <input type="hidden" name="event_id" value={String(e.id)} />
              <input
                type="url"
                name="url"
                value={url ?? ''}
                maxlength={2000}
                placeholder="https://drive.google.com/…"
                aria-label={`Media drive for ${e.title}`}
              />
              <button class="secondary" type="submit">
                Save
              </button>
            </form>
            {url && <p class="muted">Empty the link and save to remove it.</p>}
          </div>
        );
      })}
    </Layout>
  );
}

/** Admins write to one promoter, a team (its lead and members), or every promoter: in the app and on their phones. */
export function AdminNotifyPage(props: {
  user: User;
  promoters: User[];
  leads: { lead: User; members: number }[];
  sent: Announcement[];
  values: Record<string, string>;
  ok?: string;
  error?: string;
}) {
  const v = props.values;
  const to = v.to || 'everyone';
  return (
    <Layout title="Send a notification" user={props.user}>
      <h1>Send a notification</h1>
      <p class="muted">
        It shows up in their notifications, and on their phone when they turned phone notifications on.
      </p>
      <Flash ok={props.ok} error={props.error} />
      <form class="card stack-card" method="post" action="/admin/notifications">
        <fieldset class="audience">
          <legend>Send to</legend>
          <label class="check">
            <input type="radio" name="to" value="everyone" checked={to === 'everyone'} />
            <span>
              Every promoter <span class="muted">({props.promoters.length})</span>
            </span>
          </label>
          <label class="check">
            <input type="radio" name="to" value="team" checked={to === 'team'} disabled={props.leads.length === 0} />
            <span>A team</span>
            <select name="lead" aria-label="Which team" data-picks="team" disabled={props.leads.length === 0}>
              {props.leads.length === 0 && <option value="">No team yet</option>}
              {props.leads.map(({ lead, members }) => (
                <option value={String(lead.id)} selected={v.lead === String(lead.id)}>
                  {lead.name}’s team ({members + 1})
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="radio" name="to" value="one" checked={to === 'one'} />
            <span>One promoter</span>
            <select name="user" aria-label="Which promoter" data-picks="one">
              {props.promoters.map((p) => (
                <option value={String(p.id)} selected={v.user === String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <label>
          Title
          <input name="title" maxlength={ANNOUNCEMENT_TITLE_MAX} required value={v.title ?? ''} placeholder="Doors open at 9 p.m. on Saturday" />
        </label>
        <label>
          Message
          <textarea name="body" maxlength={ANNOUNCEMENT_BODY_MAX} required rows={3} placeholder="Come early: the first 50 get in free.">
            {v.body ?? ''}
          </textarea>
        </label>
        <label>
          Opens (optional: a page of this app, like /payouts)
          <input name="link" maxlength={200} value={v.link ?? ''} placeholder="/payouts" />
        </label>
        <button type="submit">Send</button>
      </form>
      <h2>Sent</h2>
      {props.sent.length === 0 ? (
        <p class="muted">Nothing sent yet.</p>
      ) : (
        <div class="notification-list">
          {props.sent.map((a) => (
            <div class="card notification">
              <strong>{a.title}</strong>
              <span>{a.body}</span>
              <span class="muted">
                To {a.audience} ({a.recipients === 1 ? '1 promoter' : `${a.recipients} promoters`}) · {timeLabel(a.created_at)}
                {a.sender ? ` · by ${a.sender}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function AdminBannersPage(props: {
  user: User;
  general: string;
  checkout: string;
  events: { id: number; title: string; start: Date | null; timezone: string | null; promoters: User[] }[];
  banners: Map<number, string>;
  ok?: string;
  error?: string;
}) {
  return (
    <Layout title="Banners" user={props.user}>
      <h1>Banners</h1>
      <p class="muted">
        Notices for promoters, in plain text, up to {BANNER_MAX_LENGTH} characters. Empty a banner and save to remove it.
      </p>
      <Flash error={props.error} ok={props.ok} />
      <div class="card rate-card" id="general">
        <h2 class="first">All promoters</h2>
        <p class="muted">Shown at the top of every promoter page, right under the menu.</p>
        {props.general && <Banner text={props.general} label="Current notice for all promoters" />}
        <form class="banner-form" method="post" action="/admin/banners/general">
          <textarea name="message" rows={3} maxlength={BANNER_MAX_LENGTH} aria-label="Banner for all promoters">
            {props.general}
          </textarea>
          <button class="secondary" type="submit">
            Save
          </button>
        </form>
      </div>
      <div class="card rate-card" id="checkout">
        <h2 class="first">Before a reward request</h2>
        <p class="muted">
          Shown when a promoter reviews their reward request: they must tick that they read it before they can send it.
          Say what they need to know, like “Tickets are under your name at the door: bring ID.”
        </p>
        {props.checkout && <Banner text={props.checkout} label="Current notice before a reward request" />}
        <form class="banner-form" method="post" action="/admin/banners/checkout">
          <textarea name="message" rows={3} maxlength={BANNER_MAX_LENGTH} aria-label="Notice before a reward request">
            {props.checkout}
          </textarea>
          <button class="secondary" type="submit">
            Save
          </button>
        </form>
      </div>
      <h2>Per event</h2>
      <p class="muted">
        Shown on the event's card and event page to the promoters with a code on it, until the event is over. Only
        drafts and events that are not over are listed.
      </p>
      {props.events.length === 0 && <p class="muted">No upcoming events with promoter codes.</p>}
      {props.events.map((e) => {
        const message = props.banners.get(e.id) ?? '';
        return (
          <div class="card rate-card" id={`event-${e.id}`}>
            <h2 class="first">{e.title}</h2>
            <p class="muted">
              {formatDate(e.start, e.timezone)} · {e.promoters.length} {e.promoters.length === 1 ? 'promoter' : 'promoters'}
            </p>
            {message && <Banner text={message} label={`Current notice for ${e.title}`} />}
            <form class="banner-form" method="post" action="/admin/banners/event">
              <input type="hidden" name="event_id" value={String(e.id)} />
              <textarea name="message" rows={2} maxlength={BANNER_MAX_LENGTH} aria-label={`Banner for ${e.title}`}>
                {message}
              </textarea>
              <button class="secondary" type="submit">
                Save
              </button>
            </form>
          </div>
        );
      })}
    </Layout>
  );
}

// Admins make team leads and put promoters on their teams.
export function AdminTeamsPage(props: { user: User; leads: { lead: User; members: User[] }[]; promoters: User[]; ok?: string; error?: string }) {
  const leadIds = new Set(props.leads.map((t) => t.lead.id));
  const candidates = props.promoters.filter((p) => !leadIds.has(p.id));
  const unassigned = candidates.filter((p) => !p.team_lead_id);
  return (
    <Layout title="Teams" user={props.user}>
      <h1>Teams</h1>
      <p class="muted">
        A team lead sees the sales of the promoters on their team, and nothing else: payouts and rewards stay with each
        promoter and the admins. Promoters are told when they join a team, and see their team's total tickets and sales
        under My team, but not who else is on the team or what they sold. A team lead's team commission is paid on
        their promoters' full-price sales from the day each joined, on top of the promoters' own commission, and goes to
        the team lead's balance.
      </p>
      <Flash error={props.error} ok={props.ok} />

      <div class="card">
        <h2 class="first">Make a team lead</h2>
        {candidates.length === 0 ? (
          <p class="muted">Every promoter is already a team lead.</p>
        ) : (
          <form class="inline-form" method="post" action="/admin/teams/lead">
            <PromoterSelect name="user_id" promoters={candidates} label="Choose a promoter" />
            <input type="hidden" name="lead" value="1" />
            <button type="submit">Make team lead</button>
          </form>
        )}
        <p class="muted">A promoter on a team leaves it when they become a team lead. Admins are on no team.</p>
      </div>

      {props.leads.length === 0 ? (
        <p class="muted">No team leads yet.</p>
      ) : (
        props.leads.map(({ lead, members }) => (
          <div class="card team-card">
            <div class="team-head">
              <a class="who" href={`/admin/promoters/${lead.id}`}>
                <Avatar user={lead} size="small" />
                <strong>{lead.name}</strong>
              </a>
              <a href={`/admin/teams/${lead.id}`}>Team sales →</a>
            </div>
            <TeamCommissionForm lead={lead} from="teams" />
            {members.length === 0 ? (
              <p class="muted">No promoters on this team yet.</p>
            ) : (
              <ul class="team-members">
                {members.map((m) => (
                  <li>
                    <a class="who" href={`/admin/promoters/${m.id}`}>
                      <Avatar user={m} size="small" />
                      <span>{m.name}</span>
                    </a>
                    <form method="post" action={`/admin/promoters/${m.id}/team`}>
                      <input type="hidden" name="team_lead_id" value="" />
                      <input type="hidden" name="from" value="teams" />
                      <button class="link" type="submit">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div class="team-actions">
              {candidates.some((p) => p.team_lead_id !== lead.id) && (
                <form class="inline-form" method="post" action="/admin/teams/add">
                  <input type="hidden" name="team_lead_id" value={String(lead.id)} />
                  <PromoterSelect name="user_id" promoters={candidates.filter((p) => p.team_lead_id !== lead.id)} label="Add a promoter" />
                  <button class="secondary" type="submit">
                    Add
                  </button>
                </form>
              )}
              <form method="post" action="/admin/teams/lead">
                <input type="hidden" name="user_id" value={String(lead.id)} />
                <input type="hidden" name="lead" value="0" />
                <button class="link danger-link" type="submit">
                  No longer team lead{members.length > 0 ? ` (their ${members.length === 1 ? 'promoter is' : `${members.length} promoters are`} left without a team)` : ''}
                </button>
              </form>
            </div>
          </div>
        ))
      )}

      {unassigned.length > 0 && props.leads.length > 0 && (
        <p class="muted">
          Not on a team: {unassigned.map((p) => p.name).join(', ')}.
        </p>
      )}
    </Layout>
  );
}

export function TwoFactorPage(props: { error?: string }) {
  return (
    <Layout title={t('Two-step verification', 'Vérification en deux étapes')}>
      <div class="login card">
        <h1 class="login-brand">
          <BrandMark brand={getBrand()} />
        </h1>
        <p>{t('Enter the 6-digit code from your authenticator app.', 'Entre le code à 6 chiffres de ton app d’authentification.')}</p>
        <Flash error={props.error} />
        <form class="stack" method="post" action="/login/2fa">
          <label>
            {t('Code', 'Code')}
            <input
              class="code-input"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength={11}
              required
              autofocus
            />
          </label>
          <button type="submit">{t('Continue', 'Continuer')}</button>
        </form>
        <p class="muted">
          {t(
            'No phone? Type one of your recovery codes instead (like abcde-12345). Each works once.',
            'Pas de téléphone? Tape plutôt un de tes codes de récupération (comme abcde-12345). Chacun fonctionne une seule fois.',
          )}
        </p>
        <p class="muted">
          <a href="/login">{t('Start over', 'Recommencer')}</a>
        </p>
      </div>
    </Layout>
  );
}

// "2 API keys, 1 connected app (Claude)" on an admin's view of a promoter.
function apiAccessSummary(tokens: ApiToken[]): string {
  const keys = tokens.filter((t) => !t.client_id).length;
  const apps = tokens.filter((t) => t.client_id);
  const parts = [
    keys ? `${keys} API ${keys === 1 ? 'key' : 'keys'}` : '',
    apps.length ? `${apps.length} connected ${apps.length === 1 ? 'app' : 'apps'} (${[...new Set(apps.map((a) => a.name))].join(', ')})` : '',
  ].filter(Boolean);
  return parts.join(', ') || 'None';
}

export function since(epoch: number | null): string {
  if (!epoch) return t('unknown', 'inconnu');
  const minutes = Math.round((Date.now() / 1000 - epoch) / 60);
  if (minutes < 5) return t('active now', 'actif maintenant');
  if (minutes < 60) return t(`${minutes} min ago`, `il y a ${minutes} min`);
  if (minutes < 48 * 60) return t(`${Math.round(minutes / 60)} h ago`, `il y a ${Math.round(minutes / 60)} h`);
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: config.timezone }).format(new Date(epoch * 1000));
}

export function SecurityPage(props: {
  user: User;
  sessions: DeviceSession[];
  currentSessionId: number;
  twoFactorOn: boolean;
  codesLeft: number;
  setup: { uri: string; svg: string } | null;
  setupSecret: string | null;
  recoveryCodes?: string[];
  ok?: string;
  error?: string;
}) {
  const others = props.sessions.filter((d) => d.rowid !== props.currentSessionId).length;
  const fr = lang() === 'fr';
  return (
    <Layout title={t('Security', 'Sécurité')} user={props.user}>
      <h1>{t('Security', 'Sécurité')}</h1>
      <Flash ok={props.ok} error={props.error} />

      {props.recoveryCodes && (
        <div class="card stack-card">
          <h2 class="first">{t('Your recovery codes', 'Tes codes de récupération')}</h2>
          <p>
            {t(
              'Save these somewhere safe (a password manager, or printed). If you lose your phone, each one signs you in once instead of a code from the app.',
              'Garde-les dans un endroit sûr (un gestionnaire de mots de passe, ou imprimés). Si tu perds ton téléphone, chacun te connecte une fois à la place d’un code de l’app.',
            )}{' '}
            <strong>{t('They are shown only now.', 'Ils ne sont affichés que maintenant.')}</strong>
          </p>
          <div class="recovery">
            {props.recoveryCodes.map((code) => (
              <span>{code}</span>
            ))}
          </div>
          <div class="link-field">
            <input readonly value={props.recoveryCodes.join(' ')} aria-label={t('Recovery codes', 'Codes de récupération')} />
            <button type="button" data-copy>
              {t('Copy all', 'Tout copier')}
            </button>
          </div>
        </div>
      )}

      <h2 id="two-step">{t('Two-step verification', 'Vérification en deux étapes')}</h2>
      <div class="card stack-card">
        {props.twoFactorOn ? (
          <>
            <p>
              <strong>{t('On.', 'Activée.')}</strong>{' '}
              {t(
                `Signing in asks for a code from your authenticator app. ${props.codesLeft} recovery codes left.`,
                `La connexion demande un code de ton app d’authentification. ${props.codesLeft < 2 ? `Il reste ${props.codesLeft} code de récupération.` : `Il reste ${props.codesLeft} codes de récupération.`}`,
              )}
            </p>
            <form class="stack" method="post" action="/account/security/2fa/new-codes">
              <label>
                {t('Code from the app, to make new recovery codes', 'Code de l’app, pour créer de nouveaux codes de récupération')}
                <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={11} required />
              </label>
              <button class="secondary" type="submit">
                {t('Make new recovery codes', 'Créer de nouveaux codes de récupération')}
              </button>
            </form>
            <form class="stack" method="post" action="/account/security/2fa/off">
              <label>
                {t('Code from the app, to turn it off', 'Code de l’app, pour la désactiver')}
                <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={11} required />
              </label>
              <button class="danger" type="submit">
                {t('Turn off two-step verification', 'Désactiver la vérification en deux étapes')}
              </button>
            </form>
          </>
        ) : props.setup && props.setupSecret ? (
          <div class="setup">
            <div class="qr" dangerouslySetInnerHTML={{ __html: props.setup.svg }} />
            <div class="setup-steps">
              <p>
                <strong>1.</strong>{' '}
                {t(
                  'Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and scan this code.',
                  'Ouvre une app d’authentification (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) et scanne ce code.',
                )}
              </p>
              <p class="muted">
                {fr ? (
                  <>
                    Sur ce téléphone? <a href={props.setup.uri}>Ouvrir dans mon app d’authentification</a>, ou tape cette clé :
                  </>
                ) : (
                  <>
                    On this phone? <a href={props.setup.uri}>Open in my authenticator app</a>, or type this key:
                  </>
                )}
              </p>
              <p class="secret">{props.setupSecret.replace(/(.{4})/g, '$1 ').trim()}</p>
              <form class="stack" method="post" action="/account/security/2fa/confirm">
                <label>
                  <strong>2.</strong> {t('Enter the 6-digit code it shows', 'Entre le code à 6 chiffres qu’elle affiche')}
                  <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={6} required autofocus />
                </label>
                <button type="submit">{t('Turn on', 'Activer')}</button>
              </form>
            </div>
          </div>
        ) : (
          <>
            <p>
              {t(
                'Protect your account and your payouts: after the email link or code, signing in also asks for a code from an authenticator app on your phone.',
                'Protège ton compte et tes paiements : après le lien ou le code reçu par courriel, la connexion demande aussi un code d’une app d’authentification sur ton téléphone.',
              )}
            </p>
            <form method="post" action="/account/security/2fa/start">
              <button type="submit">{t('Set up two-step verification', 'Configurer la vérification en deux étapes')}</button>
            </form>
          </>
        )}
      </div>

      <h2>{t('Signed-in devices', 'Appareils connectés')}</h2>
      <div class="device-list">
        {props.sessions.map((d) => (
          <div class="card device">
            <div>
              <strong>
                {d.device ?? t('Unknown device', 'Appareil inconnu')}
                {d.is_app ? (
                  <span class="badge edited"> {t('Installed app', 'App installée')}</span>
                ) : (
                  <span class="badge"> {t('Browser', 'Navigateur')}</span>
                )}
              </strong>
              <span class="muted">
                {d.rowid === props.currentSessionId ? t('This device · ', 'Cet appareil · ') : ''}
                {since(d.last_seen_at)} · {t('signed in', 'connecté')} {since(d.created_at)}
                {d.ip ? ` · ${d.ip}` : ''}
              </span>
            </div>
            {d.rowid !== props.currentSessionId && (
              <form method="post" action={`/account/security/devices/${d.rowid}/sign-out`}>
                <button class="secondary small" type="submit">
                  {t('Sign out', 'Déconnecter')}
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
      {others > 0 && (
        <form method="post" action="/account/security/devices/sign-out-others">
          <button class="link" type="submit">
            {t(`Sign out all other devices (${others})`, `Déconnecter tous les autres appareils (${others})`)}
          </button>
        </form>
      )}
    </Layout>
  );
}
