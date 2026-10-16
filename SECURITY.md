# Security

Last reviewed on 2026-10-14 against the OWASP Top 10 (2025). This review covered the code added since the first pass: two-step verification, devices and sessions, the waiting-device sign-in, hand adjustments, email templates and their preview, event covers, Instagram photos, promoter links and aliases, the leaderboard, the PWA and service worker, Web Push, onboarding and alert settings.

## What was tested

- **Code review** of every route in `src/index.tsx` and the middleware order, plus the auth, two-step, email, upload, cover, avatar, push and link modules.
- **OWASP ZAP** (`zaproxy/zap-stable`): a baseline scan, plus spider and active scans signed out, as a promoter and as an admin, against a local sandbox (`docker-compose.dev.yml`).
- **Trivy** (`aquasec/trivy` 0.67.2): the built image (Alpine 3.22.2 packages, `node_modules`, secrets) and the repository (`bun.lock`, Dockerfile, secrets). 0 vulnerabilities, 0 secrets, 0 misconfigurations.
- **`bun audit`**: no vulnerabilities.
- **Manual tests:**
  - XSS payloads in promoter names, codes, alias, first and last name, phone, city, Instagram handle, payout details, branding name, footer and sign-in message, every email template field, event link settings and adjustment reasons. All were shown as text, in pages and in emails.
  - Email headers: a newline in the subject cannot add headers.
  - IDOR on avatars, events, covers, admin pages, adjustment undo, session sign-out, device approval, and reward and payout settling.
  - CSRF: POSTs with no `Origin` or a foreign one, including bodyless and JSON requests (JSON was not Origin-checked: S-12).
  - SSRF through the push endpoint allowlist.
  - Path tricks (`/ADMIN`, `/%61dmin`, `//admin`).
  - Malformed bodies and cookies, oversized bodies.
  - The waiting-device approval: replays and approving another account's request.
  - Brute force of two-step codes.

CI runs a ZAP baseline with the overrides in `.zap/rules.tsv`. Each line says why an alert is ignored, or which header or cookie rule must keep passing (`FAIL`).

## Findings (2026-10-14)

| ID | OWASP 2025 | Severity | Finding | Status |
| --- | --- | --- | --- | --- |
| S-01 | A07 Authentication failures | Medium | Wrong two-step codes had no limit per account. Signed in, turning two-step off or making new recovery codes accepted unlimited guesses (200 wrong codes in 3 s, no lock, then the right code still worked). A known password gave a fresh 5-try sign-in ticket each time. Either way, 6-digit codes could be brute forced in minutes. | Fixed: 10 wrong codes per account in 15 minutes lock all code checks for that account (sign-in, turning it off, new recovery codes). |
| S-02 | A06 Insecure design | Low | The password lockout table took any posted email text (up to 32 KB) as a key and was never cleaned, so unauthenticated requests could grow memory without limit. | Fixed: only emails of 254 characters or fewer are counted, and expired entries are swept hourly. |
| S-03 | A10 Exceptional conditions | Low | A malformed multipart body returned 500 and logged a stack trace. | Fixed: 400, nothing logged. |
| S-04 | A02 Security misconfiguration | Low | No `Permissions-Policy` header. | Fixed: camera, microphone, geolocation, payment and USB are turned off. |
| S-05 | A05 Injection | Low | The event link format is free text, so a format such as `javascript:…` reached the Copy and Share buttons promoters use to share links with customers. The CSP blocked it inside the app. This is an admin-only setting. | Fixed: links that do not start with `http://` or `https://` are not shown. |
| S-06 | A05 Injection | Info | Flash messages were looked up with the raw query value, so `?ok=constructor` reached `Object.prototype` (an empty notice). | Fixed: only the app's own message keys are used. |
| S-07 | A01 Broken access control | Low | `/event-image/:id` serves the cover of any event (within `HIEVENTS_ACCOUNT_IDS`) to any signed-in user, not only events with their codes. | Accepted: covers are shown on the public Hi.Events event pages anyway. Checking ownership would cost a database query per image. |
| S-08 | A01 Broken access control | Info | Opening `/notifications` (a GET) marks notifications as read, so a link on another site could mark them read. | Accepted: no data is exposed or lost. |
| S-09 | A01 Broken access control | Info | Subscribing with a push endpoint already registered to another account moves it to the new account. | Accepted: endpoints are unguessable capability URLs that only the browser knows. Payloads stay encrypted for the original device's keys. |
| S-10 | A03 Supply chain | Info | Base images are pinned by tag, not digest. Trivy does not track the Bun runtime binary itself. | Accepted: `apk upgrade` at build time and Trivy scans cover the OS packages. Update the `oven/bun` tag with each Bun release. |
| S-11 | A02 Security misconfiguration | Info | ZAP: no anti-CSRF tokens (10202), no COEP header (90004), plain-http sandbox (10106), inline styles in the email preview (10055). | Accepted (see below and `.zap/rules.tsv`). |
| S-12 | A08 Integrity failures | Low | `hono/csrf` checks only form content types, so JSON POSTs (`/push/subscribe`, `/push/unsubscribe`) relied on the browser's CORS preflight alone. They were not checked against `Origin`. | Fixed: every non-GET request without a matching `Origin` (or `Sec-Fetch-Site: same-origin`) gets 403, whatever its content type. |
| S-13 | A02 Security misconfiguration | Low | The email preview's CSP had no `form-action` (it does not fall back to `default-src`). It also allowed images from any `https:` host. | Fixed: `form-action 'none'`, images only from the app and `data:`. Inline styles stay allowed there because email HTML needs them. That page is admin-only, sandboxed and script-free. |

ZAP results before the fixes:
- Baseline: 7 warnings, 0 failures.
- Full scans, signed out: medium 2 (10202, 10106), informational 5.
- Full scans, as a promoter: medium 2, low 1 (private IP on the person's own device list), informational 3.
- Full scans, as an admin: medium 5, of which three are the email preview's CSP (10055), plus low 2 (also 10096, cache-busting timestamps) and informational 3.

No XSS, SQL injection, path traversal, open redirect or server error was found by the active scans.

After the fixes, the baseline with `.zap/rules.tsv` gives 0 failures and 0 warnings (61 rules pass, 6 alerts ignored with reasons). The preview CSP now defines `form-action` and has no wildcard. Only its accepted `style-src 'unsafe-inline'` remains.

Verified as safe, with no change needed:
- Every `/admin/*` route re-checks the admin flag.
- Avatars, events, sessions, adjustment undo and device approvals are scoped to their owner.
- The QR code is the only `dangerouslySetInnerHTML`. It holds no user text.
- Email HTML escapes every placeholder value in a single pass.
- The email preview allows no scripts, can only be framed by the app, and is shown in a sandboxed iframe.
- No redirect takes a URL from the request.
- Push endpoints are limited to the browsers' push services.
- Covers are fetched only from `HIEVENTS_IMAGE_BASE_URL`, with no redirects.
- Kutt is called only at `KUTT_URL`, with no redirects, and its short links are checked before they are shown.
- Instagram photos are fetched only from Instagram's own hosts.
- Uploads are recognised by their content, are size-limited and are served with `nosniff`.
- The service worker caches only static files and the offline notice.

## Controls by category

| OWASP 2025 | How it is handled |
| --- | --- |
| A01 Broken access control | Every page except sign-in, `/healthz` and promoters' public pages (`/p/<alias>`) needs a session. A public page shows only the promoter's name, photo, Instagram handle and upcoming events with their links, never sales; its covers are limited to the events it lists, and the promoter can hide it; admin pages re-check the admin flag on each request. A promoter's data is looked up from their session, never from a URL parameter, except a team lead's view of their own promoters (`/team/<id>`), which is checked on each request against the promoter's team and the viewer still being a team lead; team leads can only read, and every team change is admin-only. Admins can view the app as a promoter (not as another admin): the admin's own session points at the promoter for at most an hour, re-checked on every request (still an admin, promoter not an admin); every non-GET request but stopping and signing out is refused while it lasts, including approving a device sign-in, so it cannot be turned into access to the promoter's account; a pending two-step secret is never shown; start, stop and blocked changes are audited. Database access uses a read-only role limited to the columns in `sql/readonly-role.sql` (no customer names, emails or addresses). |
| A02 Security misconfiguration | Strict CSP (`default-src 'none'`; the email preview alone allows inline styles and is framed only by the app; scripts, styles, the manifest and the service worker only from the app itself; no inline code). `X-Frame-Options: DENY`, `nosniff`, a `Permissions-Policy` turning off unused features, `Referrer-Policy: no-referrer`, HSTS. Pages are sent with `Cache-Control: no-store`, and the service worker caches only static files, never pages. 32 KB request body limit. Container runs as a non-root user. |
| A03 Supply chain | Five runtime dependencies (hono, postgres, nodemailer, qrcode, web-push), pinned by `bun.lock` and installed with `--frozen-lockfile`. The image runs `apk upgrade` at build time; Trivy and `bun audit` reported 0 vulnerabilities on 2026-10-14. |
| A04 Cryptographic failures | Passwords hashed with Argon2id. Session and sign-in tokens are 256-bit random values, stored only as SHA-256 hashes. With `COOKIE_SECURE=true` the cookie is `__Host-` prefixed, Secure, HttpOnly, SameSite=Lax. |
| A05 Injection | All SQL goes through parameterized postgres.js / bun:sqlite queries. All HTML is escaped by JSX; email HTML escapes names. Tested with XSS and SQL payloads in every user-controlled field (see above) and in query strings. Email subjects cannot carry extra headers. |
| A06 Insecure design | Sign-in links and their 6-digit codes are single use and expire (30 minutes, or 7 days for admin invites). The link page is submitted by script, so mail scanners cannot use it up. 5 wrong codes cancel all open links and codes for that account. A device waiting for a link it asked for is only signed in after someone signed in from that link explicitly approves it, within 10 minutes, once; the approval page names the device and time. Changing a promoter's email revokes their sessions and unused links. Payout requests are checked against the live balance inside a transaction (one open request per currency; double submits create one), need an admin to mark them paid, and are kept when a promoter is deleted. The last admin cannot be demoted or deleted. |
| A07 Authentication failures | The link request form gives the same answer, in the same time (padded to 300 ms), for known and unknown emails. At most 3 links per email every 15 minutes. Password sign-in locks for 15 minutes after 5 failures. Two-step codes lock for 15 minutes after 10 wrong codes per account, wherever they are asked for. Links are built from `APP_URL`, never from the Host header. |
| A08 Integrity failures | Every POST, form or JSON, must carry an `Origin` header that matches `APP_URL` (or `Sec-Fetch-Site: same-origin`), or it is rejected (403). This is `hono/csrf` for forms plus an explicit check for every other content type. Destructive actions need an explicit confirmation field. |
| A09 Logging and alerting | JSON audit lines on stdout for sign-ins (password, link, code), failures, lockouts, link requests, invalid links and codes, payout requests and decisions, and every admin change (who, whom, from which IP). Admins are emailed on every payout request. In production, sign-in links and codes are never written to the log. |
| A10 Exceptional conditions | Errors return a generic message; details go to the log only. Malformed request bodies get a 400. Queries time out after 10 seconds. The app refuses to start if the database is unreachable or the role lacks access. |

## Accepted risks

- **No anti-CSRF tokens in forms** (ZAP 10202, medium, low confidence). Ignored in `.zap/rules.tsv`. Instead, cross-site POSTs of any content type are blocked by the strict `Origin` check, which fails closed when the header is missing, plus SameSite=Lax cookies. Every current browser sends `Origin` on POST.
- **Token in the sign-in URL** (ZAP 10024, informational). This is inherent to emailed links. It is mitigated by single use, short expiry, `no-referrer`, and the confirm page.
- **Rate limits are in memory and per email.** They reset when the container restarts and do not limit by IP. For extra protection, add per-IP rate limiting on `/login` and `/login/link` at the reverse proxy.
- **Approving a waiting device can be socially engineered.** Someone who knows a promoter's email can request a link from their own phone; if the promoter opens it and answers yes, that phone is signed in. The page warns to answer yes only for a request they just made, and the link alone (without the yes) signs in nobody else.
- **Push subscriptions come from the browser.** The server only stores and sends to https endpoints on the browsers' push services (fcm.googleapis.com, *.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com), so a subscription cannot point the server at another address. Payloads are encrypted for the device (Web Push, aes128gcm) and signed with the app's VAPID key.
- **Event covers are fetched by the server** from `HIEVENTS_IMAGE_BASE_URL` only, for plain relative paths taken from Hi.Events (no `..`, no absolute URLs, no redirects), with a timeout and a 5 MB limit. Only PNG, JPEG, GIF, WebP and AVIF files are passed on, recognised by their first bytes (Hi.Events' own nginx labels PNG and WebP as text).
- **Short links go through Kutt** when `KUTT_URL` and `KUTT_API_KEY` are set. The key comes only from the environment, is sent only in the `X-API-KEY` header to `KUTT_URL`, and never reaches a page or the log; redirects from Kutt are not followed, so the key cannot be carried elsewhere. Kutt's answers are read up to 1 MB with a 5-second timeout, and a short link is shown only if it is a plain http(s) address (no other schemes, no user name or password in it); otherwise promoters get the long link. Only links the app builds (http(s), from the admin's site address) are sent to Kutt, with addresses of letters, digits and `-`. The short link domain is picked by admins only, and only from the domains Kutt lists for the account (not banned, plain host names); Kutt's account answer also contains the API key, which is read for nothing else and never stored or shown. Use a Kutt account kept for this app: its key can change and delete that account's links. When a promoter is deleted, their short links stay in Kutt and keep leading to their old link; delete them in Kutt if needed.
- **Logos are uploaded by admins** and accepted only as PNG, JPEG or WebP, recognised by their content, up to 1 MB.
- **Two-step secrets are stored unencrypted** in the SQLite file (recovery codes only as hashes). Anyone with a copy of `/data` could generate codes, so protect and back up that volume like a password store.
- **The IP shown per device comes from the first `X-Forwarded-For` address** when present. Behind a proxy that replaces the header (Caddy's default), that is the real address. A proxy that appends to it (nginx with `$proxy_add_x_forwarded_for`) leaves the first address up to the client, and so does running without a proxy. It is informational only: the audit log records the connection's address and the raw header separately.
- **Promoter profiles hold personal data** (name, phone, city, Instagram, payout email) in the app's SQLite file. Protect and back up the `/data` volume accordingly.
- **The payout method's details are free text the promoter types.** Anyone signed in as a promoter could request a payout to a different account. Before paying, check that the "Pay to" details match what you know for that promoter, especially if they changed.
- **Lockout can be triggered by others.** Someone who knows the admin's email can lock password sign-in for 15 minutes. The admin can still sign in with an emailed link. Likewise, someone who already has the first step (the password or a session) can lock two-step codes for that account for 15 minutes.
- **Event covers, read state and push endpoints** (S-07 to S-09 above) are accepted as described in the findings table.
- **No Cross-Origin-Embedder-Policy** (ZAP 90004). The app loads nothing from other origins and uses no cross-origin-isolated APIs. COOP and CORP are set.

## Reporting

Report security problems privately to the maintainers rather than in a public issue.
