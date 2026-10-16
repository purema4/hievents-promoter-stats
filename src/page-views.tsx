import type { Child } from 'hono/jsx';
import { avatarOf, initials } from './avatars';
import { brandVersion, getBrand } from './brand';
import { config } from './config';
import type { PageEvent } from './hievents';
import { eventLink, pageLink } from './links';
import type { User } from './local-db';
import { instagramHandle } from './promoter-page';
import { LinkField } from './promoter-views';
import { shareLink } from './short-links';
import { cssVersion, Flash, Layout } from './views';

// --- The public page, /p/<alias> -----------------------------------------------------------------

function dateParts(date: Date | null, timezone: string | null): { month: string; day: string; when: string } | null {
  if (!date) return null;
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: timezone ?? 'UTC' }).format(date);
    } catch {
      return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(date);
    }
  };
  return {
    month: format({ month: 'short' }).replace('.', ''),
    day: format({ day: 'numeric' }),
    when: `${format({ weekday: 'short', month: 'short', day: 'numeric' })} · ${format({ hour: 'numeric', minute: '2-digit' })}`,
  };
}

const shareIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4L12 2Zm-7 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9h-2v9H7v-9H5Z" />
  </svg>
);

const instagramIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12 3c-2.4 0-2.7 0-3.7.1-1 0-1.6.2-2.2.4a4.4 4.4 0 0 0-1.6 1 4.4 4.4 0 0 0-1 1.6c-.2.6-.4 1.3-.4 2.2C3 9.3 3 9.6 3 12s0 2.7.1 3.7c0 1 .2 1.6.4 2.2.2.6.5 1.1 1 1.6.5.5 1 .8 1.6 1 .6.2 1.3.4 2.2.4 1 .1 1.3.1 3.7.1s2.7 0 3.7-.1c1 0 1.6-.2 2.2-.4a4.6 4.6 0 0 0 2.6-2.6c.2-.6.4-1.3.4-2.2.1-1 .1-1.3.1-3.7s0-2.7-.1-3.7c0-1-.2-1.6-.4-2.2a4.4 4.4 0 0 0-1-1.6 4.4 4.4 0 0 0-1.6-1c-.6-.2-1.3-.4-2.2-.4C14.7 3 14.4 3 12 3Zm0 1.6c2.4 0 2.7 0 3.6.1.9 0 1.4.2 1.7.3.4.2.7.4 1 .7.3.3.5.6.7 1 .1.3.3.8.3 1.7.1.9.1 1.2.1 3.6s0 2.7-.1 3.6c0 .9-.2 1.4-.3 1.7a3 3 0 0 1-1.7 1.7c-.3.1-.8.3-1.7.3-.9.1-1.2.1-3.6.1s-2.7 0-3.6-.1c-.9 0-1.4-.2-1.7-.3-.4-.2-.7-.4-1-.7-.3-.3-.5-.6-.7-1-.1-.3-.3-.8-.3-1.7-.1-.9-.1-1.2-.1-3.6s0-2.7.1-3.6c0-.9.2-1.4.3-1.7.2-.4.4-.7.7-1 .3-.3.6-.5 1-.7.3-.1.8-.3 1.7-.3.9-.1 1.2-.1 3.6-.1Z"
    />
  </svg>
);

function PublicLayout(props: { title: string; description: string; image?: string; url?: string; children: Child }) {
  const brand = getBrand();
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        {/* What shows when the link is pasted in a message or a post. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={brand.name} />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        {props.url && <meta property="og:url" content={props.url} />}
        {props.image && <meta property="og:image" content={props.image} />}
        <meta name="twitter:card" content={props.image ? 'summary_large_image' : 'summary'} />
        <link rel="stylesheet" href={`/app.css?v=${cssVersion}`} />
        <link rel="stylesheet" href={`/brand.css?v=${brandVersion()}`} />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-180.png" />
        <meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)" />
        <script src="/page.js" defer></script>
      </head>
      <body class="lp">{props.children}</body>
    </html>
  );
}

function PageFooter() {
  const brand = getBrand();
  return (
    <footer class="lp-footer">
      {brand.logoType && <img src={`/brand/logo?v=${brand.updatedAt}`} alt="" />}
      <span>{brand.name}</span>
    </footer>
  );
}

function PageEventCard(props: { owner: User; event: PageEvent; first: boolean }) {
  const e = props.event;
  const ref = { id: e.event_id, title: e.title };
  const link = shareLink(props.owner, ref, e.code);
  const date = dateParts(e.start, e.timezone);
  const more = e.dates > 1 ? ` · ${e.dates} dates` : '';
  const cover = (
    <span class={`lp-cover${e.has_cover ? '' : ' blank'}`}>
      {e.has_cover && <img src={`/p/${props.owner.alias}/cover/${e.event_id}`} alt="" loading={props.first ? undefined : 'lazy'} />}
      {date && (
        <span class="lp-date" aria-hidden="true">
          <span class="lp-month">{date.month}</span>
          <span class="lp-day">{date.day}</span>
        </span>
      )}
      {props.first && <span class="lp-next">Next up</span>}
    </span>
  );
  const body = (
    <span class="lp-body">
      <span class="lp-title">{e.title}</span>
      <span class="lp-when">{date ? `${date.when}${more}` : 'Date to be announced'}</span>
      {link ? (
        <span class="lp-cta">
          <span>Get tickets</span>
          <span class="lp-cta-code">
            Code {e.code} applied
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3 1.4-1.4Z" />
            </svg>
          </span>
        </span>
      ) : (
        <span class="lp-cta muted-cta">Use the code {e.code} at checkout</span>
      )}
    </span>
  );
  return link ? (
    <a class="lp-event" href={link} rel="noopener">
      {cover}
      {body}
    </a>
  ) : (
    <div class="lp-event">
      {cover}
      {body}
    </div>
  );
}

export function PromoterPublicPage(props: { owner: User; events: PageEvent[]; shareUrl: string }) {
  const { owner, events } = props;
  const avatar = avatarOf(owner);
  const instagram = instagramHandle(owner);
  const featured = events.find((e) => e.has_cover);
  const base = `/p/${owner.alias}`;
  const description = events.length
    ? `Tickets for ${events
        .slice(0, 3)
        .map((e) => e.title)
        .join(', ')}${events.length > 3 ? ` and ${events.length - 3} more` : ''}, with ${owner.name}'s code.`
    : `${owner.name}'s events.`;
  return (
    <PublicLayout
      title={`${owner.name} · Upcoming events`}
      description={description}
      url={pageLink(owner) ?? undefined}
      image={featured ? `${config.appUrl}${base}/cover/${featured.event_id}` : avatar ? `${config.appUrl}${base}/avatar?v=${avatar.version}` : undefined}
    >
      <div class={`lp-backdrop${featured ? '' : ' plain'}`} aria-hidden="true">
        {featured && <img src={`${base}/cover/${featured.event_id}`} alt="" />}
      </div>
      <div class="lp-wrap">
        <button type="button" class="lp-share" data-share-page={props.shareUrl} data-share-title={`${owner.name} · Upcoming events`} aria-label="Share this page">
          {shareIcon}
        </button>
        <div class="lp-head">
          {avatar ? (
            <img class="lp-avatar" src={`${base}/avatar?v=${avatar.version}`} alt="" />
          ) : (
            <span class="lp-avatar lp-initials" aria-hidden="true">
              {initials(owner.name)}
            </span>
          )}
          <h1 class="lp-name">{owner.name}</h1>
          <p class="lp-tagline">{events.length ? 'My upcoming events. Get your tickets with my code.' : 'Upcoming events'}</p>
          {instagram && (
            <a class="lp-pill" href={`https://www.instagram.com/${instagram}/`} rel="noopener">
              {instagramIcon}@{instagram}
            </a>
          )}
        </div>
        {events.length ? (
          <section class="lp-events" aria-label="Upcoming events">
            {events.map((e, i) => (
              <PageEventCard owner={owner} event={e} first={i === 0} />
            ))}
          </section>
        ) : (
          <p class="lp-empty">No upcoming events right now. Check back soon.</p>
        )}
        <button type="button" class="lp-share-wide" data-share-page={props.shareUrl} data-share-title={`${owner.name} · Upcoming events`}>
          {shareIcon}
          <span>Share this page</span>
        </button>
        <PageFooter />
      </div>
    </PublicLayout>
  );
}

export function PageMissing() {
  return (
    <PublicLayout title="Page not found" description="This page does not exist.">
      <div class="lp-backdrop plain" aria-hidden="true"></div>
      <div class="lp-wrap">
        <div class="lp-head lp-missing">
          <h1 class="lp-name">This page does not exist</h1>
          <p class="lp-tagline">The link may be old or mistyped. Ask the person who shared it for a new one.</p>
        </div>
        <PageFooter />
      </div>
    </PublicLayout>
  );
}

// --- The promoter's own view, /page --------------------------------------------------------------

export function MyPagePage(props: {
  user: User;
  events: PageEvent[];
  shortLink: string | null;
  clicks: number | null;
  kutt: boolean;
  ok?: string;
}) {
  const { user, events } = props;
  const full = pageLink(user);
  const hidden = !!user.page_hidden_at;
  const instagram = instagramHandle(user);
  const withoutLink = events.filter((e) => !eventLink({ id: e.event_id, title: e.title }, e.code, user.alias));
  return (
    <Layout title="My page" user={user}>
      <h1>My page</h1>
      <p class="muted">
        One link with all your upcoming events, your promo code already in each one. Put it in your Instagram bio, your
        stories or anywhere you share.
      </p>
      <Flash ok={props.ok} />
      {!full ? (
        <div class="card muted">Your page needs an alias. Set one on your Account page.</div>
      ) : hidden ? (
        <div class="card stack-card">
          <h2 class="first">Your page is hidden</h2>
          <p class="muted">Anyone opening your link sees "This page does not exist". Your event links still work.</p>
          <form method="post" action="/page/visibility">
            <input type="hidden" name="hidden" value="0" />
            <button type="submit">Show my page again</button>
          </form>
        </div>
      ) : (
        <>
          <div class="card stack-card my-page">
            <div class="my-page-links">
              <h2 class="first">Your links</h2>
              {props.shortLink && (
                <div class="page-link-row">
                  <span class="page-link-label">
                    Short link
                    {props.clicks !== null && <span class="muted"> · {props.clicks === 1 ? '1 click' : `${props.clicks} clicks`}</span>}
                  </span>
                  <LinkField link={props.shortLink} label="My page (short link)" />
                </div>
              )}
              <div class="page-link-row">
                <span class="page-link-label">{props.shortLink ? 'Full link' : 'Link'}</span>
                <LinkField link={full} label="My page" />
              </div>
              {props.kutt && !props.shortLink && <p class="muted">Your short link is on its way. Reload in a moment.</p>}
              <div class="form-actions">
                <a class="button" href={`/p/${user.alias}`} target="_blank" rel="noopener">
                  Open my page
                </a>
                <a class="button secondary" href="/page/qr.png" download={`${user.alias}-qr.png`}>
                  Download QR code
                </a>
              </div>
            </div>
            <figure class="my-page-qr">
              <img src="/page/qr.png" alt={`QR code for ${props.shortLink ?? full}`} width="180" height="180" />
              <figcaption class="muted">Scan to open your page. Print it or add it to a flyer.</figcaption>
            </figure>
          </div>

          <div class="card stack-card">
            <h2 class="first">What's on it</h2>
            <p class="muted">
              {[`Your name (${user.name})`, avatarOf(user) ? 'your photo' : 'your initials', instagram ? `your Instagram (@${instagram})` : ''].filter(Boolean).join(', ')}. Change them on{' '}
              <a href="/account">Account</a>. Your sales and commission are never shown.
            </p>
            {events.length ? (
              <ul class="page-event-list">
                {events.map((e) => (
                  <li>
                    <strong>{e.title}</strong> <span class="muted">with the code {e.code}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted">No upcoming events right now. They show up here as soon as one of your codes is on one.</p>
            )}
            {withoutLink.length > 0 && (
              <p class="muted">Event links are not set up yet, so your page tells people to use your code at checkout.</p>
            )}
            <p class="muted">Each event leaves your page once it is over.</p>
          </div>

          <form method="post" action="/page/visibility" class="hide-page">
            <input type="hidden" name="hidden" value="1" />
            <button type="submit" class="link">
              Hide my page
            </button>
          </form>
        </>
      )}
    </Layout>
  );
}
