# Security

Tested on 2026-10-14 against the OWASP Top 10 (2025) with OWASP ZAP (spider + active scan, signed out, as a promoter and as an admin), Trivy (image and secrets), `bun audit`, and targeted manual tests. After the fixes below, ZAP reports no high or medium findings other than the CSRF-token heuristic explained under accepted risks.

## Controls by category

| OWASP 2025 | How it is handled |
| --- | --- |
| A01 Broken access control | Every page except sign-in and `/healthz` needs a session; admin pages re-check the admin flag on each request. A promoter's data is looked up from their session, never from a URL parameter. Database access uses a read-only role limited to the columns in `sql/readonly-role.sql` (no customer names, emails or addresses). |
| A02 Security misconfiguration | Strict CSP (`default-src 'none'`; scripts, styles, the manifest and the service worker only from the app itself; no inline code). `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS. Pages are sent with `Cache-Control: no-store`, and the service worker caches only static files, never pages. 32 KB request body limit. Container runs as a non-root user. |
| A03 Supply chain | Three runtime dependencies (hono, postgres, nodemailer), pinned by `bun.lock` and installed with `--frozen-lockfile`. The image runs `apk upgrade` at build time; Trivy reported 0 vulnerabilities after that. |
| A04 Cryptographic failures | Passwords hashed with Argon2id. Session and sign-in tokens are 256-bit random values, stored only as SHA-256 hashes. With `COOKIE_SECURE=true` the cookie is `__Host-` prefixed, Secure, HttpOnly, SameSite=Lax. |
| A05 Injection | All SQL goes through parameterized postgres.js / bun:sqlite queries. All HTML is escaped by JSX; email HTML escapes names. Tested with XSS and SQL payloads in names, codes and query strings. |
| A06 Insecure design | Sign-in links and their 6-digit codes are single use and expire (30 minutes, or 7 days for admin invites). The link page is submitted by script, so mail scanners cannot use it up. 5 wrong codes cancel all open links and codes for that account. A device waiting for a link it asked for is only signed in after someone signed in from that link explicitly approves it, within 10 minutes, once; the approval page names the device and time. Changing a promoter's email revokes their sessions and unused links. Payout requests are checked against the live balance inside a transaction (one open request per currency; double submits create one), need an admin to mark them paid, and are kept when a promoter is deleted. The last admin cannot be demoted or deleted. |
| A07 Authentication failures | The link request form gives the same answer, in the same time (padded to 300 ms), for known and unknown emails. At most 3 links per email every 15 minutes. Password sign-in locks for 15 minutes after 5 failures. Links are built from `APP_URL`, never from the Host header. |
| A08 Integrity failures | Every POST must carry an `Origin` header that matches `APP_URL`, or it is rejected (403). Destructive actions need an explicit confirmation field. |
| A09 Logging and alerting | JSON audit lines on stdout for sign-ins (password, link, code), failures, lockouts, link requests, invalid links and codes, payout requests and decisions, and every admin change (who, whom, from which IP). Admins are emailed on every payout request. In production, sign-in links and codes are never written to the log. |
| A10 Exceptional conditions | Errors return a generic message; details go to the log only. Queries time out after 10 seconds. The app refuses to start if the database is unreachable or the role lacks access. |

## Accepted risks

- **No anti-CSRF tokens in forms** (ZAP 10202, medium, low confidence). Instead, cross-site POSTs are blocked by the strict `Origin` check, which fails closed when the header is missing, plus SameSite=Lax cookies. Every current browser sends `Origin` on POST.
- **Token in the sign-in URL** (ZAP 10024, informational). This is inherent to emailed links. It is mitigated by single use, short expiry, `no-referrer`, and the confirm page.
- **Rate limits are in memory and per email.** They reset when the container restarts and do not limit by IP. For extra protection, add per-IP rate limiting on `/login` and `/login/link` at the reverse proxy.
- **Approving a waiting device can be socially engineered.** Someone who knows a promoter's email can request a link from their own phone; if the promoter opens it and answers yes, that phone is signed in. The page warns to answer yes only for a request they just made, and the link alone (without the yes) signs in nobody else.
- **Push subscriptions come from the browser.** The server only stores and sends to https endpoints on the browsers' push services (fcm.googleapis.com, *.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com), so a subscription cannot point the server at another address. Payloads are encrypted for the device (Web Push, aes128gcm) and signed with the app's VAPID key.
- **Event covers are fetched by the server** from `HIEVENTS_IMAGE_BASE_URL` only, for plain relative paths taken from Hi.Events (no `..`, no absolute URLs, no redirects), with a timeout, a 5 MB limit and image content types only.
- **Logos are uploaded by admins** and accepted only as PNG, JPEG or WebP, recognised by their content, up to 1 MB.
- **Two-step secrets are stored unencrypted** in the SQLite file (recovery codes only as hashes). Anyone with a copy of `/data` could generate codes, so protect and back up that volume like a password store.
- **The IP shown per device comes from `X-Forwarded-For`** when present. Behind your own proxy that is the real address; if the app is ever exposed without one, a client could make it show any value (it is informational only).
- **Promoter profiles hold personal data** (name, phone, city, Instagram, payout email) in the app's SQLite file. Protect and back up the `/data` volume accordingly.
- **The payout method's details are free text the promoter types.** Anyone signed in as a promoter could request a payout to a different account. Before paying, check that the "Pay to" details match what you know for that promoter, especially if they changed.
- **Lockout can be triggered by others.** Someone who knows the admin's email can lock password sign-in for 15 minutes. The admin can still sign in with an emailed link.

## Reporting

Report security problems privately to the maintainers rather than in a public issue.
