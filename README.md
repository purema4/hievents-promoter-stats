# Hi.Events promoter stats

A small standalone site where promoters sign in and see how many tickets were sold with their promo codes, the sales those codes brought in, and their commission, per event, live from the Hi.Events database. It never writes to Hi.Events.

- Promoter logins and code assignments are stored in this app's own SQLite file (`/data` volume).
- Hi.Events is read through a read-only Postgres role that can only see the columns listed in `sql/readonly-role.sql`. It cannot read customer names, emails or addresses.
- A code is matched case-insensitively across every event, so a promoter who reuses `DJMAX` for each show sees all of them automatically.
- Event dates come from `event_occurrences` (this Hi.Events fork's recurring-events table). An event with several dates shows its first one and the number of dates.
- Security controls and the OWASP test results are in [SECURITY.md](SECURITY.md).

## What is counted

| Shown as | Meaning |
| --- | --- |
| Tickets sold | Non-cancelled attendees on `COMPLETED` orders that used the code. Refunds that cancel tickets are excluded. |
| Awaiting payment | Tickets on orders waiting for an offline payment. |
| Orders | Completed orders that used the code. |
| Ticket sales at full price | Each item's price before the promo code's discount (`order_items.price_before_discount`, or `price` when no discount applied) × quantity, without taxes and fees. Partial refunds are taken off proportionally, the way Hi.Events adjusts its own stats. A $10 ticket bought with a 10% code counts as $10. |
| Paid by customers | The order total after promo codes and discounts (`total_before_additions`), minus refunds the same way. Shown on event pages for reference. |
| Commission | Full-price sales × the promoter's rate, or tickets sold × a flat amount per ticket. `COMMISSION_PERCENT` (default 10) applies unless an admin gives the promoter their own usual rate when adding or editing them: another percentage, or CAD per ticket. Sales entered by hand outside Hi.Events earn the usual rate too (the sales total × the percentage, or the tickets × the flat amount). On **Promoters → Commissions**, admins can also choose, per promoter and event, another percentage or a flat amount per ticket sold (tickets that are paid and not cancelled). |
| Tickets sold per day | Completed orders by the day they were placed, in `APP_TIMEZONE` (default `America/Toronto`). Periods longer than 120 days switch to weekly bars. |

Add-on products (non-ticket items) are not counted as tickets, but they are included in sales. Pending orders earn commission only once paid. A 100%-off code still earns commission on the full price; give comp tickets another way if that is not wanted.

## What promoters see

- **Dashboard:** commission earned, what is available to request, full-price sales and tickets, a tickets-per-day chart (7 / 30 / 90 days / all time), then their events split into upcoming and past.
- **Event page:** the same numbers for one event, its own chart, a breakdown per code when they have several, and previous / next links to move between events.
- **Payouts:** their balance (earned − paid − requested), a form to request a payout with how they want to be paid, and the history of requests. When money or rewards are waiting, the dashboard opens with the amount and big **Request my payout** / **Claim rewards** buttons, and the menu always has a **Request payout** button.

Admins see any promoter's dashboard exactly as they do from the promoter's page (**Open … dashboard**).

To see every page as a promoter does (payouts, their page, account, notifications, My team for a team lead), an admin clicks **View the app as …** on the promoter's page. It is read-only: a banner at the bottom of every page says whose account is shown, and nothing can be sent or saved in their name (payouts, rewards, profile, security, approving a device); trying shows a "Viewing only" page. Their notifications stay unread, a two-step setup they started is not shown, and admin pages are closed meanwhile. **Back to my account** in the banner ends it, and it ends by itself after an hour. Admins cannot be viewed as. Starting, stopping and every blocked change are in the audit log.

## Teams

An admin can make any promoter a **team lead** and put other promoters on their team, on **Teams** in the menu or in the **Team** section of a promoter's page. A team lead can have many promoters; a promoter has at most one team lead. Only admins make team leads and change teams.

- A team lead keeps their own dashboard, payouts and page, and gets **My team** in the menu: their team commission, the team's tickets and full-price sales (theirs included) for all time (or 7 / 30 / 90 days), a tickets-per-day chart, and everyone on the team ranked. Each promoter opens to their dashboard and event pages, as an admin sees them.
- They only see. They cannot request payouts or rewards for their promoters, change anything about them, or see any other promoter, payout details or admin page.
- Promoters get a notification when they join a team, naming the team lead who can now see their sales. A new team lead is told too.
- Promoters on a team get **My team** too: the whole team's tickets and full-price sales (their team lead's and their own included, each tagged), the chart and the ranking, for 7 / 30 / 90 days or all time. They see no one's commission, not the team commission, and no one else's dashboard.
- One level only: a team lead is on no one's team (a promoter who becomes one leaves their team), and admins are on no team. When a team lead steps down, is deleted or becomes an admin, their promoters are left without a team.
- **Team commission:** each team lead earns their own commission on their own sales, plus a team commission: a % (set per team lead by admins on **Teams** or their page; none until set) of the full-price sales of the promoters on their team, never of their own. It counts a promoter's sales from the day they join the team through the day they leave; a promoter who moves joins the new team the next day, so no sale counts twice and nothing already earned is taken back, even when a promoter leaves, is deleted or the team lead steps down. Changing the rate applies to all the team's sales so far, like promoters' own rates. Sales outside Hi.Events entered by an admin count too (their sales total), by the day they were entered; entries made before sales totals were kept are worked out once from their commission and the promoter's rate. Money added by hand (bonuses, corrections) does not count. It is part of the team lead's balance and requested like any payout.
- Team pages and totals include the team lead's own sales (tagged **Team lead**). Admins see every team on **Dashboard** (**Teams**: promoters, tickets, sales, commission and team commission for the period) and open each one with **Team sales →** on **Teams**. The dashboard's commission and owed totals include team commissions.

## Levels and rewards

Admins set them on **Levels & rewards**; changes apply to everyone at once, counted from all their sales so far (rewards already requested stay requested). **Back to the default levels and rewards** undoes the changes.

| Reward | What admins set | Default |
| --- | --- | --- |
| Levels | Any number of levels (up to 20), each with a name, the total tickets sold where it starts (the first starts at 0) and a badge color. | Rookie 0, Bronze 10, Silver 25, Gold 50, Platinum 100, Diamond 250. |
| Free tickets | Milestones counted per upcoming event (at N sales for that event, gives M free tickets), then optionally M more every N sales. | 1 at the first sale, then 1 more every `REWARD_TICKET_EVERY` (5) sales: 1 sold → 1, 6 → 2, 11 → 3. |
| Merch | Milestones counted on all tickets sold, each with an optional name (like Hoodie), then optionally more every N tickets. | 1 item every `MERCH_EVERY` (50) tickets sold. |

Leaving every milestone empty with "every" at 0 turns free tickets or merch off. Promoters see the rules in words, a progress bar to their next level and reward, and get a notification when they reach one.

Promoters request rewards on **Payouts & rewards** (with a guest-list name, or the merch item and size). Admins see them under **Requests**, then **Mark given** or **Decline** with a reason; the promoter is emailed. A declined reward can be requested again. Free tickets for past events are not offered.

## Event links

Every promoter has an **alias** (made from their name, changeable by them on Account and by admins on their page), used in their links as `aff=`. On **Event links**, admins set the Hi.Events public site address (its `FRONTEND_URL`, or `HIEVENTS_PUBLIC_URL`) and the format, by default `{event_url}?promo_code={code}&aff={alias}`, where `{event_url}` is `<site>/event/<id>/<slug>` like Hi.Events builds it. Promoters get **Copy** and **Share** buttons on event pages and upcoming event cards, and each promo code is a one-click copy button there too. The dashboard also has a **Your promo codes** card listing each code with the upcoming events it works on, for customers who type the code at checkout. For `aff=` to be tracked by Hi.Events, create an affiliate with the same code as the alias on the event.

### Promoter pages

Every promoter has a public page at `<APP_URL>/p/<alias>`, like a link-in-bio page: their name, photo and Instagram, then their upcoming events, each with a cover, the date and a **Get tickets** button that opens their link (promo code included). It shows no sales, commission or anything else from the dashboard. Anyone with the address can open it, without signing in.

- Promoters find it on **My page** (in the menu) and in a **Your page** card on the dashboard: the link to copy or share, a QR code to download (it leads to the short link when there is one, so scans are counted too) and a button to hide the page. A hidden page answers "This page does not exist".
- Admins see every promoter's page links (full and Kutt, with clicks) on **Promoter pages** in the menu, can download them as a CSV, and can hide or show a page. A page an admin hid stays hidden until an admin shows it again. Each promoter's admin page shows their links too.
- An event shows while it has one of the promoter's codes and leaves the page once it is over. Draft events are left out when the read-only role can read `events.status`; on a database set up before this, run `GRANT SELECT (status) ON events TO promoter_stats;` once (otherwise every event with a code shows, drafts included).
- With Kutt, each page also gets a short link on the alias, like `outkzt.link/dj-max`, and the event buttons on it use the promoter's short links. Admins can give a page's short link another address on **Promoter pages** (**Change the Kutt link**): it is renamed in Kutt and keeps its clicks, the old address stops working, and the new one is kept when the link is updated or made again (another domain, or deleted in Kutt).
- Pasted in a message or a post, the link shows the next event's cover and the promoter's name. Pages are marked `noindex` for search engines.

### Short links (Kutt)

With `KUTT_URL` and `KUTT_API_KEY` set, promoters share short links from a [Kutt](https://github.com/thedevs-network/kutt) site instead of the long ones, like `outkzt.link/halloween-blood-rave-djmax` (the event's first words and the alias, with `-2`, `-3`… when that is taken). Use the API key of a Kutt account made just for this app: the key can change and delete every link of its account.

- A short link is made the first time a page shows the promoter's link for an event (one per promo code), then saved and reused. Past events get none until someone opens their page.
- When the long link changes (the link format, an alias or an event title), the same short link is pointed at the new address, so links already shared keep working. A short link deleted in Kutt is made again.
- **Event links** has a domain picker: Kutt's own domain or any domain added to the app's Kutt account (Kutt → Settings → Domains). After a change, promoters get new short links on the new domain from their next visit (the same readable address when it is free there). The links they already shared keep working but are no longer updated, and click counts start again on the new links. Switching back brings the old links and their counts back.
- Event pages show the clicks on each link, read from Kutt at most every `KUTT_CLICKS_MINUTES` (10 by default).
- Pages wait at most 2.5 seconds for Kutt. While it is slow, down or refusing the key, promoters see the long links, Kutt is left alone for 5 minutes, and **Event links** shows the last error.

## Invite links

On **Promoters → Invite links**, admins make links to share (a group chat, a flyer QR, a DM): whoever opens one enters their first and last name and email, and gets the usual welcome email with a sign-in link, so the address is theirs before they can sign in. They then go through the welcome steps like any new promoter. Admins are notified of every sign-up, to give them their promo codes; the promoter's admin page says which link they joined with.

- A link has a name (only for you), can put new promoters straight on a team, works for 1, 7 or 30 days or without an end date, and can be limited to a number of sign-ups. It can be turned off and on again; a full or expired link stops working.
- **Team leads** make their own links from **My team → Invite promoters to your team**: their links always put new promoters on their team, and they are notified when someone joins. They see and manage only their own links; admins see every link and who made it. A team lead's links stop working if they stop being a team lead.
- An email that already has an account gets a normal sign-in link instead, and the page looks the same either way, so it does not tell who has an account. That does not use up the link.
- At most 20 sign-ups an hour per link, so a link that leaks cannot be used to send lots of email.

## Commission per event

**Promoters → Commissions** lists every event that is not over (drafts included) with the promoters who have one of its codes. For each promoter and event, choose **Usual rate** (their own %), **% of sales** (another percentage) or **per ticket** (a flat amount for each ticket sold). Like the usual rate, a change applies to all their sales for that event, earlier ones too, and stays when the event is over. Promoters see the commission amounts, never a rate, since it can differ per event; a flat amount replaces the percentage on that event, it is not added to it. Their balance, payouts, charts and the admin dashboard all use it. A team lead's team commission stays a percentage of their promoters' sales.

**Promoters → Media drives** lists the drafts and events that are not over with promoter codes, soonest first (like Commissions). Paste a link to a public folder (Google Drive, Dropbox…, `https://` only) with the event's photos, videos and flyers: the promoters with a code on the event get a **Media drive** button on their dashboard's event card and on the event page. Save an empty link to remove it.

## Changes by hand

For events outside Hi.Events, bonuses and corrections, an admin can change any promoter's numbers on their page (**Adjust by hand**):

| Change | Effect |
| --- | --- |
| Money (+ or −) | Added to their balance, so it can be requested as a payout. |
| Sales outside Hi.Events | Tickets that count for their levels, merch and ranking, and the sales total: the promoter gets their usual commission % on it, added to their balance, and it counts for their team lead's team commission. Undoing the sale also takes back its commission. Leave the total empty for tickets only. |
| Free tickets (+ or −) | For one of their upcoming events, on top of what their sales earned. |
| Merch (+ or −) | Items they can request, on top of what their sales unlocked. |

Each change needs a reason, shows on the promoter's **Payouts & rewards** page under "From the team" and in their totals ("incl. +$40 from the team", "incl. 20 outside Hi.Events"), can notify them, and can be undone from the admin's list. Hand-entered sales also count on the admin dashboard and its chart, on the day they were entered.

## Admin dashboard

Admins land on **Dashboard**, even an admin with promo codes of their own (their sales are on their promoter page under **All promoters**): tickets, full-price sales and commission through promoter codes for 7 / 30 / 90 days or all time, what is still owed, a tickets-per-day chart, and the best promoters ranked by tickets, sales or commission with their level and last sale. Below that, **Promoter activity** lists every promoter with when they were last active and last signed in, whether they installed the app and whether two-step verification is on, most recently active first.

## Menu

The app keeps a standard width (1280 px, centred) even on very wide screens. Pages are grouped in a sidebar: always visible on a computer, a slide-in panel behind the ☰ button on a phone (it also works without scripts). The avatar at the top right opens Notifications, Account, Security and Sign out.

## Security for promoters

**Account → Security** has:

- **Two-step verification:** scan a QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), confirm a code, and save the 10 recovery codes shown once. Every later sign-in (link, code, password, or a device approved from another one) then asks for a code from the app or a recovery code. Codes work once; 5 wrong codes end the attempt. Admins can reset it for someone who lost their phone and codes.
- **Signed-in devices:** each device with its browser, whether it is the installed app, last activity and sign-in time, with sign out per device or for all others. A sign-in from a new kind of device sends a notification.

## First sign-in

A promoter's first visit opens four welcome steps instead of the dashboard: how it works (their codes, how commission is counted, rewards and levels), their profile (name, phone, city, Instagram, payout method and email), their profile photo (their Instagram one is fetched for a few seconds after the profile step and shown there; they can upload another, or skip), then installing the app and turning on notifications. They can skip; either way it is shown once. Admins never see it.

## Emails

All emails share one branded layout (logo or name, accent colour, footer, a button, the sign-in code where relevant, and a plain-text version). On **Emails**, admins edit each email's subject, heading, text and button label with `{{placeholders}}`, see a live preview, send themselves a test, reset to the default wording, and set a reply-to address. Text typed into a template or by a promoter is always shown as text, never as HTML.

Sending reuses one connection to the mail server, gives up on an unreachable server after 10 seconds, and retries background emails (sign-in links, notices) up to 3 times; an admin waiting on a page (invite, test) gets one attempt and the result. Every email is logged on the Emails page with its result for 60 days. The sender name is the brand name, with the address from `MAIL_FROM`.

## Profile photos

A promoter's photo is the one they upload on Account, or else the one from their Instagram: the server reads their public profile once, keeps a copy and refreshes it weekly. Instagram has no API for this and can refuse such requests; then initials are shown. Promoters can only see their own photo; admins see everyone's.

Admins can also set or remove a promoter's photo on the promoter's page (**Photo**); the promoter is notified and can replace it with their own.

Every image (profile photos, the logo, Instagram photos) is checked and cleaned before it is stored (`src/images.ts`): PNG, JPEG or WebP recognised by their content, at most 2 MB for photos and 1 MB for the logo, at most 6000 pixels on a side and 25 megapixels, with metadata removed (EXIF including GPS position, XMP, comments, text chunks; a photo's rotation is kept) and anything after the end of the image dropped. Each person can upload at most 20 images an hour. Instagram photos are downloaded without following redirects and the download stops past 2 MB.

Adding one is a welcome step. Until a promoter has a photo, their dashboard shows **Add your profile photo** (linking to Account), and **All promoters** flags them with **No photo** for admins.

## Promo codes

**Promoters → Promo codes** lists the promo codes in Hi.Events with their event, orders and who each is assigned to, 25 per page. Search by code, event or promoter name, and filter by upcoming, past or all events and by assigned or not (upcoming events by default, soonest first). **All promoters** links to it, with the number of codes on upcoming events assigned to nobody.

## Notifications

A bell in the header shows unread notifications; the **Notifications** page lists them and marks them read.

| Event | Promoter | Admins |
| --- | --- | --- |
| Payout requested | | ✓ |
| Payout sent or declined | ✓ | |
| Reward requested | | ✓ |
| Reward given or declined | ✓ | |
| New level, merch unlocked | ✓ | ✓ |
| Free ticket earned for an event | ✓ | |
| Made a team lead, or joined a team | ✓ | |

**Admin alerts** (a payout or reward requested, a promoter reaching a level or unlocking merch, a new sign-in on their own account) can each be set per admin on the Notifications page: email, app notification (the bell and phone push), both, or off. Defaults: email and app for requests, app only for the rest. The extra emails (promoter milestone, new sign-in) are editable on the Emails page like the others.

Milestones come from live Hi.Events sales: every `MILESTONE_CHECK_MINUTES` (default 5), and whenever a promoter opens their dashboard, each promoter's numbers are compared with the last ones seen. The first check of a promoter only records where they stand, so nothing is announced about the past. Payout and reward events are also emailed.

**Phone notifications:** on the Notifications page, **Turn on** asks the browser for permission and registers the device for Web Push; **Send a test** pushes a test notification to every device of that person and says how many accepted it. On iPhone this works only in the app added to the Home Screen (iOS 16.4 or later); on Android and desktop Chrome it works in the browser too. The push keys are generated on first start and kept in the database. Pushes are only ever sent to the browsers' own push services (Google, Apple, Mozilla, Microsoft).

## Account

Promoters fill in their first and last name, phone, city, Instagram and preferred payout method and email (used to prefill payout requests), and choose a theme: same as the device, light or dark. Admins see these on the promoter's page. Payout methods offered are set with `PAYOUT_METHODS` (default `Interac e-Transfer`; set `Interac e-Transfer,Cash` to offer cash too). Cash, when offered, is paid in whole steps of `CASH_STEP` dollars (default 50): $50, $100 and so on, so cash needs at least $50 available.

## Branding

Admins set it on **Branding**: the name (header, browser tab, installed app, email subjects), the accent colour (buttons, links, charts; a lighter shade for dark mode is computed automatically, and the page warns when a colour is hard to read), a logo (PNG, JPEG or WebP up to 1 MB; SVG is refused because it can carry scripts), the welcome message on the sign-in page and a footer. Promoters cannot change it. It is stored in the app's own database and logo file under `/data`.

## Event covers

Set `HIEVENTS_IMAGE_BASE_URL` to where Hi.Events serves uploads: its `APP_CDN_URL`, or its storage URL if it has none. Covers then appear on event cards and pages. The server fetches each cover and passes it on (cached for an hour), so covers load on a phone through ngrok even when the storage is only reachable from the server, and pages never load anything from another site.

## Payouts

1. A promoter requests an amount up to their available balance and says how to pay them (for example, Interac e-Transfer to their email). One open request per currency at a time.
2. Every admin gets an email. **Payouts** in the admin menu shows waiting requests with a counter.
3. Pay them the usual way, then **Mark paid** (with an optional reference) or **Decline** (with a reason). The promoter is emailed either way; a declined amount becomes available again.

Balances are computed live: a refund after a payout lowers the balance and nets out of the next request. Changing a promoter's rate changes their earned total, including past sales. Payout records stay when a promoter is deleted.

## Adding promoters and signing in

1. As admin, open **Promoters**, enter the promoter's name, email and promo codes, and optionally their commission: the default, another percentage, or CAD per ticket. Leave **Email them a sign-in link now** ticked.
2. They get an email with a **Sign in** button (valid `INVITE_LINK_DAYS`, default 7). One click signs them in for `SESSION_DAYS` (default 30).
3. After that, they go to the site, enter their email, and get a fresh link (valid `LOGIN_LINK_MINUTES`, default 30). Promoters never have a password.

**The installed app signs in by itself.** On a phone, a link tapped in Mail opens the browser, not the installed app (always on iPhone, where the two never share a sign-in). So the page that asked for the link keeps checking with the server. When the link is opened somewhere else, that browser is signed in and asks *"Also sign in the device that asked?"*, showing which device and when. After a yes, the waiting app signs in within a few seconds. Opened in the same browser that asked, it just signs in, with no question. The yes step stops someone from requesting a link for a promoter's email and getting signed in when the promoter taps it.

Each email also has a 6-digit code as a fallback ("Or type the 6-digit code"). Link and code are one: using either spends both, and 5 wrong codes cancel them.

Links work once. Mail scanners such as Outlook Safe Links open links before the promoter does, so the link page continues by itself with a small script, which scanners do not run; the token is only spent in a real browser. The sign-in form answers the same way for unknown emails and sends at most 3 links per address every 15 minutes.

## Install as an app

The site is a PWA and promoters are nudged to install it: a banner on every page offers **Install** where the browser supports it (Android, desktop Chrome and Edge) and shows the Share → **Add to Home Screen** steps on iPhone. It is hidden inside the installed app; the first time a promoter opens the installed app (or taps **I already installed it**) this is saved on their account, so the banner never shows for them again on any device. **Not now** hides it for 14 days on that device. The Account page has install steps for every device, and invite emails tell promoters to install it on their phone. The app opens on the dashboard. Pages are always loaded live and never stored on the device; without a connection the app shows an offline notice instead of old numbers.

The admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` can also use **Sign in with a password**, as a way in if email stops working.

Every sign-in, failed attempt and admin change is logged as a JSON line; read them with `docker compose logs promoter-stats`.

## Setup

1. On the Hi.Events database, edit the password in `sql/readonly-role.sql` and run it as the database owner:
   ```sh
   psql "$ADMIN_DATABASE_URL" -f sql/readonly-role.sql
   ```
2. `cp .env.example .env` and fill it in, including the SMTP settings (the account Hi.Events sends email with works). If your Hi.Events instance hosts events for other organizers, set `HIEVENTS_ACCOUNT_IDS` so promoters only see your events.
3. Start it:
   ```sh
   docker compose up -d --build
   ```
4. Put it behind your HTTPS reverse proxy at the `APP_URL` you configured, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, and add promoters on the Promoters page.

The container must be able to reach the database host. If Hi.Events runs in Docker on the same server, either expose Postgres to the host, or attach this service to the Hi.Events compose network:

```yaml
services:
  promoter-stats:
    networks: [default, hievents]
networks:
  hievents:
    external: true
    name: <hi.events network name from `docker network ls`>
```

## Try it locally

```sh
docker compose -f docker-compose.dev.yml up --build
```

This starts a fake Hi.Events database with sample data (`dev/seed.sql`) and a fake inbox. Open http://localhost:3000, choose **Sign in with a password**, use `admin@example.com` / `dev-password-123`, then create a promoter with the codes `DJMAX` and `LUNA`. The invite email shows up at http://localhost:8027.

Without Docker: `bun install`, export the variables from `.env.example`, then `bun run dev`.

### Against the Hi.Events dev stack

With `~/hi.events/docker/development` running, run `sql/readonly-role.sql` once in its `backend` database. Put that role's password in `.env` (`HIEVENTS_DATABASE_URL=postgres://promoter_stats:…@pgsql:5432/backend`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `COOKIE_SECURE=false`), then:

```sh
docker compose -f docker-compose.yml -f docker-compose.hievents-dev.yml up -d --build
```

Sign-in emails land in the dev stack's Mailpit at http://localhost:8025.

### On your phone, through ngrok

```sh
./dev-ngrok.sh up -d --build    # start (stop the Hi.Events dev tunnel first: the free plan allows one)
./dev-ngrok.sh down             # stop
```

This uses `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` and `NGROK_URL` from `~/hi.events/docker/development/.env` (another file with `HIEVENTS_DEV_ENV=…`), so the app is at your reserved ngrok address. It sets `APP_URL` to it and turns on secure cookies. While the tunnel runs, use the ngrok address on the laptop too, since forms only accept that origin. ngrok's free plan shows its own warning page once per browser before the app.

**Testing sign-in entirely on the phone:** in this mode the app's emails go to an inbox at `<ngrok address>/mailpit/` (user `phone`, password `PHONE_INBOX_PASSWORD` from `.env`), also open on the laptop at http://localhost:8028/mailpit/. They no longer go to the Hi.Events Mailpit on port 8025. On the phone: ask for a link on the app, open the inbox in another tab, tap the link. Signed in. For the installed app (Add to Home Screen), tapping the link opens Safari, which asks to also sign in the app: answer yes and switch back.

The app is public while the tunnel runs: use a strong `ADMIN_PASSWORD`, never the sample one.

## Backups

All promoter accounts are in the `promoter-data` volume (`promoters.sqlite`). Back it up, and do not remove it with `docker volume prune`.

## CI/CD

The code lives in the private repository `purema4/hievents-promoter-stats`. GitHub Actions runs two workflows on every push to `main`, on every pull request, and on demand from **Actions → Run workflow**. A newer commit on the same branch or pull request cancels the run it replaces. Each job gets only the permissions it needs, and third-party actions are pinned to full commit SHAs.

**`ci.yml`**

| Job | What it does |
| --- | --- |
| Typecheck and tests | Runs `bun install --frozen-lockfile` and `bun run typecheck`, starts Postgres, Mailpit and the CDN from `docker-compose.dev.yml` + `docker-compose.test.yml`, then runs `bun test` with `CI=true`. With `CI=true`, integration tests fail when the stack is missing instead of skipping. A failed run prints the container logs, and the job always removes the stack. |
| Dependency audit | `bun audit` fails the job if any dependency has a known vulnerability. |
| Secret scan | gitleaks scans the whole git history. |
| DAST (ZAP baseline) | Starts the full sandbox with `docker compose -f docker-compose.dev.yml up -d --build --wait`, waits for `/healthz`, then runs the OWASP ZAP baseline scan on http://localhost:3000 with the rule overrides in `.zap/rules.tsv`. The report is attached to the run as the `zap-baseline-report` artifact. A rule set to `FAIL` in that file fails the job. `WARN` alerts only go in the report. |
| Build, scan and publish image | Starts once the four jobs above pass. Builds the Docker image with Buildx, caching layers in GitHub Actions, and scans it with Trivy. Any HIGH or CRITICAL vulnerability that has a fix available fails the job. On a push to `main`, and only then, it pushes that same scanned image to GHCR. |

**`codeql.yml`** runs CodeQL on the TypeScript code for pushes and pull requests to `main`, and every Monday. **Dependabot** reads `.github/dependabot.yml` and opens weekly pull requests for Bun packages, GitHub Actions and the Docker base image.

### The image

Every commit on `main` that passes CI is published twice:

- `ghcr.io/purema4/hievents-promoter-stats:<full commit sha>`, which never changes. Use it to pin a version or roll back.
- `ghcr.io/purema4/hievents-promoter-stats:latest`

The package is private, like the repository. To pull it on a server, create a classic personal access token with only the `read:packages` scope, then:

```sh
echo "$TOKEN" | docker login ghcr.io -u purema4 --password-stdin
docker pull ghcr.io/purema4/hievents-promoter-stats:latest
```

Run it with a `.env` made from `.env.example`. Fill in `APP_URL`, `HIEVENTS_DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, the `SMTP_*` settings and `MAIL_FROM`. The other settings have defaults. Keep `/data` on a volume:

```sh
docker run -d --name promoter-stats --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 -v promoter-data:/data \
  ghcr.io/purema4/hievents-promoter-stats:latest
```

With Compose, replace `build: .` in `docker-compose.yml` with `image: ghcr.io/purema4/hievents-promoter-stats:latest` and run `docker compose pull && docker compose up -d`. To go back to an earlier version, use its `:<sha>` tag instead of `:latest`.

### Settings to make by hand

- **Branch protection.** Under Settings → Rules → Rulesets, protect `main`, require a pull request, and require these checks: *Typecheck and tests*, *Dependency audit*, *Secret scan*, *DAST (ZAP baseline)*, *Build, scan and publish image* and *Analyze (javascript-typescript)*. A check only shows up in that list after it has run once.
- **GitHub Advanced Security.** Code scanning and secret scanning on a private repository need GitHub Code Security and Secret Protection. GitHub sells those to organizations, so a private repository on a personal account does not get them. Until it does, CodeQL saves its results as the `codeql-sarif` artifact and fails the job on any finding. Once code scanning is available, or if the repository goes public, add the repository variable `CODE_SCANNING_UPLOAD=true` under Settings → Secrets and variables → Actions → Variables, and results go to the Security tab instead. Dependabot alerts work on private repositories without Advanced Security. Turn them on under Settings → Code security.
- **Package access.** The first push to `main` creates the `hievents-promoter-stats` package on your GitHub profile, linked to this repository. Keep it private. Other people can be given access from the package settings.
- **Deployment.** There is no deploy job yet. Once the target server is chosen, add one to `ci.yml` that runs after the image job, with `needs: build`, on pushes to `main` only.
