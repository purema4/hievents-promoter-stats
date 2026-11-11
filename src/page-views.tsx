import type { Child } from 'hono/jsx';
import { avatarOf, initials } from './avatars';
import { brandVersion, getBrand } from './brand';
import { config } from './config';
import { iconUrl } from './icons';
import type { PageEvent } from './hievents';
import { eventLink, pageLink } from './links';
import type { User } from './local-db';
import { hiddenByTeam, instagramHandle } from './promoter-page';
import { LinkField } from './promoter-views';
import { shareLink } from './short-links';
import type { DirectoryItem, DirectorySettings } from './directory';
import { maxUploadBytes } from './images';
import { lang, locale, plural, t } from './i18n';
import { Avatar, cssVersion, Flash, Layout, PagesTabs } from './views';

// --- The public page, /p/<alias> -----------------------------------------------------------------

function dateParts(date: Date | null, timezone: string | null): { month: string; day: string; when: string } | null {
  if (!date) return null;
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale(), { ...options, timeZone: timezone ?? 'UTC' }).format(date);
    } catch {
      return new Intl.DateTimeFormat(locale(), { ...options, timeZone: 'UTC' }).format(date);
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

function PublicLayout(props: { title: string; description: string; image?: string; imageSize?: { width: number; height: number }; url?: string; stylesheet?: string; children: Child }) {
  const brand = getBrand();
  return (
    <html lang={lang()}>
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
        {props.imageSize && <meta property="og:image:width" content={String(props.imageSize.width)} />}
        {props.imageSize && <meta property="og:image:height" content={String(props.imageSize.height)} />}
        {props.image && <meta name="twitter:image" content={props.image} />}
        <meta name="twitter:card" content={props.image ? 'summary_large_image' : 'summary'} />
        <link rel="stylesheet" href={`/app.css?v=${cssVersion}`} />
        <link rel="stylesheet" href={`/brand.css?v=${brandVersion()}`} />
        {props.stylesheet && <link rel="stylesheet" href={props.stylesheet} />}
        <link rel="icon" href={iconUrl('icon.svg')} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={iconUrl('icon-180.png')} />
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
  const more = e.dates > 1 ? ` · ${plural(e.dates, ['date', 'date'], ['dates', 'dates'])}` : '';
  const cover = (
    <span class={`lp-cover${e.has_cover ? '' : ' blank'}`}>
      {e.has_cover && <img src={`/p/${props.owner.alias}/cover/${e.event_id}`} alt="" loading={props.first ? undefined : 'lazy'} />}
      {date && (
        <span class="lp-date" aria-hidden="true">
          <span class="lp-month">{date.month}</span>
          <span class="lp-day">{date.day}</span>
        </span>
      )}
      {props.first && <span class="lp-next">{t('Next up', 'Prochain')}</span>}
    </span>
  );
  const body = (
    <span class="lp-body">
      <span class="lp-title">{e.title}</span>
      <span class="lp-when">{date ? `${date.when}${more}` : t('Date to be announced', 'Date à venir')}</span>
      {link ? (
        <span class="lp-cta">
          <span>{t('Get tickets', 'Billets')}</span>
          <span class="lp-cta-code">
            {t(`Code ${e.code} applied`, `Code ${e.code} appliqué`)}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3 1.4-1.4Z" />
            </svg>
          </span>
        </span>
      ) : (
        <span class="lp-cta muted-cta">{t(`Use the code ${e.code} at checkout`, `Utilise le code ${e.code} au paiement`)}</span>
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
  const titles = events
    .slice(0, 3)
    .map((e) => e.title)
    .join(', ');
  const description = events.length
    ? t(
        `Tickets for ${titles}${events.length > 3 ? ` and ${events.length - 3} more` : ''}, with ${owner.name}'s code.`,
        `Billets pour ${titles}${events.length > 3 ? ` et ${events.length - 3} autres` : ''}, avec le code de ${owner.name}.`,
      )
    : t(`${owner.name}'s events.`, `Les événements de ${owner.name}.`);
  const pageTitle = `${owner.name} · ${t('Upcoming events', 'Événements à venir')}`;
  return (
    <PublicLayout
      title={pageTitle}
      description={description}
      url={pageLink(owner) ?? undefined}
      image={featured ? `${config.appUrl}${base}/cover/${featured.event_id}` : avatar ? `${config.appUrl}${base}/avatar?v=${avatar.version}` : undefined}
    >
      <div class={`lp-backdrop${featured ? '' : ' plain'}`} aria-hidden="true">
        {featured && <img src={`${base}/cover/${featured.event_id}`} alt="" />}
      </div>
      <div class="lp-wrap">
        <button type="button" class="lp-share" data-share-page={props.shareUrl} data-share-title={pageTitle} aria-label={t('Share this page', 'Partager cette page')}>
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
          <p class="lp-tagline">{events.length ? t('My upcoming events. Get your tickets with my code.', 'Mes événements à venir. Achète tes billets avec mon code.') : t('Upcoming events', 'Événements à venir')}</p>
          {instagram && (
            <a class="lp-pill" href={`https://www.instagram.com/${instagram}/`} rel="noopener">
              {instagramIcon}@{instagram}
            </a>
          )}
        </div>
        {events.length ? (
          <section class="lp-events" aria-label={t('Upcoming events', 'Événements à venir')}>
            {events.map((e, i) => (
              <PageEventCard owner={owner} event={e} first={i === 0} />
            ))}
          </section>
        ) : (
          <p class="lp-empty">{t('No upcoming events right now. Check back soon.', 'Aucun événement à venir pour l’instant. Reviens bientôt.')}</p>
        )}
        <button type="button" class="lp-share-wide" data-share-page={props.shareUrl} data-share-title={pageTitle}>
          {shareIcon}
          <span>{t('Share this page', 'Partager cette page')}</span>
        </button>
        <PageFooter />
      </div>
    </PublicLayout>
  );
}

// --- Every page, /p ---------------------------------------------------------------------------------

/** A link as people type it: outkzt.link/dj-max. */
const bareLink = (link: string) => link.replace(/^(https?:\/\/|mailto:|tel:)/, '').replace(/\/$/, '');

const arrowIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" d="M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3 1.4-1.4Z" />
  </svg>
);

export const linkIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="currentColor" d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0Zm-2.1 6.4a4.5 4.5 0 0 1-3.2-7.7l2.1-2.1a1 1 0 1 1 1.4 1.4l-2.1 2.1a2.5 2.5 0 0 0 3.5 3.5l2.1-2.1a1 1 0 1 1 1.4 1.4l-2.1 2.1a4.5 4.5 0 0 1-3.1 1.4Zm7.4-5.5a1 1 0 0 1-.7-1.7l2.1-2.1a2.5 2.5 0 0 0-3.5-3.5l-2.1 2.1a1 1 0 0 1-1.4-1.4l2.1-2.1a4.5 4.5 0 0 1 6.3 6.3l-2.1 2.1a1 1 0 0 1-.7.3Z" />
  </svg>
);

export type DirectoryEntry = { kind: 'promoter'; user: User; link: string } | { kind: 'link'; title: string; url: string } | { kind: 'heading'; title: string };

/** "Ana, Ben, Cy and 4 more", for the link preview. */
function namesLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} ${t('and', 'et')} ${names.at(-1)}`;
  return `${names.slice(0, 3).join(', ')} ${t(`and ${names.length - 3} more`, `et ${names.length - 3} autres`)}`;
}

export function PromoterDirectoryPage(props: { title: string; tagline: string; stylesheet: string; image: string; entries: DirectoryEntry[] }) {
  const brand = getBrand();
  const names = props.entries.flatMap((e) => (e.kind === 'promoter' ? [e.user.name] : []));
  const description = [props.tagline, names.length ? `${names.length === 1 ? t('Promoter', 'Promoteur') : t('Promoters', 'Promoteurs')}${t(':', ' :')} ${namesLine(names)}.` : ''].filter(Boolean).join(' ');
  return (
    <PublicLayout
      title={`${brand.name} · ${props.title}`}
      description={description || t(`Every ${brand.name} promoter's page, with their upcoming events and codes.`, `La page de chaque promoteur ${brand.name}, avec ses événements à venir et ses codes.`)}
      url={`${config.appUrl}/p`}
      image={props.image}
      imageSize={{ width: 1200, height: 630 }}
      stylesheet={props.stylesheet}
    >
      <div class="lp-dir">
        <div class="lp-backdrop plain" aria-hidden="true"></div>
        <div class="lp-wrap">
          <div class="lp-head">
            <h1 class="lp-name">{props.title}</h1>
            {props.tagline && <p class="lp-tagline">{props.tagline}</p>}
          </div>
          {props.entries.length ? (
            <ul class="lp-people">
              {props.entries.map((entry) => {
                if (entry.kind === 'heading') return <li class="lp-section">{entry.title}</li>;
                if (entry.kind === 'link') {
                  return (
                    <li>
                      <a class="lp-person" href={entry.url} rel="noopener">
                        <span class="lp-person-avatar lp-link-icon">{linkIcon}</span>
                        <span class="lp-person-text">
                          <span class="lp-person-name">{entry.title}</span>
                          <span class="lp-person-link">{bareLink(entry.url)}</span>
                        </span>
                        {arrowIcon}
                      </a>
                    </li>
                  );
                }
                const avatar = avatarOf(entry.user);
                return (
                  <li>
                    <a class="lp-person" href={entry.link} rel="noopener">
                      {avatar ? (
                        <img class="lp-person-avatar" src={`/p/${entry.user.alias}/avatar?v=${avatar.version}`} alt="" loading="lazy" />
                      ) : (
                        <span class="lp-person-avatar lp-initials" aria-hidden="true">
                          {initials(entry.user.name)}
                        </span>
                      )}
                      <span class="lp-person-text">
                        <span class="lp-person-name">{entry.user.name}</span>
                        <span class="lp-person-link">{bareLink(entry.link)}</span>
                      </span>
                      {arrowIcon}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="lp-empty">{t('Nothing here right now. Check back soon.', 'Rien ici pour l’instant. Reviens bientôt.')}</p>
          )}
          <PageFooter />
        </div>
      </div>
    </PublicLayout>
  );
}

export function PageMissing() {
  return (
    <PublicLayout title={t('Page not found', 'Page introuvable')} description={t('This page does not exist.', 'Cette page n’existe pas.')}>
      <div class="lp-backdrop plain" aria-hidden="true"></div>
      <div class="lp-wrap">
        <div class="lp-head lp-missing">
          <h1 class="lp-name">{t('This page does not exist', 'Cette page n’existe pas')}</h1>
          <p class="lp-tagline">{t('The link may be old or mistyped. Ask the person who shared it for a new one.', 'Le lien est peut-être vieux ou mal écrit. Demande-en un nouveau à la personne qui te l’a partagé.')}</p>
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
    <Layout title={t('My page', 'Ma page')} user={user}>
      <h1>{t('My page', 'Ma page')}</h1>
      <p class="muted">
        {t(
          'One link with all your upcoming events, your promo code already in each one. Put it in your Instagram bio, your stories or anywhere you share.',
          'Un seul lien avec tous tes événements à venir, ton code promo déjà dans chacun. Mets-le dans ta bio Instagram, tes stories ou partout où tu partages.',
        )}
      </p>
      <Flash ok={props.ok} />
      {!full ? (
        <div class="card muted">{t('Your page needs an alias. Set one on your Account page.', 'Ta page a besoin d’un alias. Choisis-en un sur ta page Compte.')}</div>
      ) : hidden ? (
        <div class="card stack-card">
          <h2 class="first">{t('Your page is hidden', 'Ta page est cachée')}</h2>
          <p class="muted">
            {hiddenByTeam(user) ? t('The team hid it. Ask them if you would like it back. ', 'L’équipe l’a cachée. Demande-leur si tu veux la ravoir. ') : ''}
            {t(
              'Anyone opening your link sees "This page does not exist". Your event links still work.',
              'Quiconque ouvre ton lien voit « Cette page n’existe pas ». Tes liens d’événements fonctionnent encore.',
            )}
          </p>
          {!hiddenByTeam(user) && (
            <form method="post" action="/page/visibility">
              <input type="hidden" name="hidden" value="0" />
              <button type="submit">{t('Show my page again', 'Réafficher ma page')}</button>
            </form>
          )}
        </div>
      ) : (
        <>
          <div class="card stack-card my-page">
            <div class="my-page-links">
              <h2 class="first">{t('Your links', 'Tes liens')}</h2>
              {props.shortLink && (
                <div class="page-link-row">
                  <span class="page-link-label">
                    {t('Short link', 'Lien court')}
                    {props.clicks !== null && <span class="muted"> · {plural(props.clicks, ['click', 'clic'], ['clicks', 'clics'])}</span>}
                  </span>
                  <LinkField link={props.shortLink} label={t('My page (short link)', 'Ma page (lien court)')} />
                </div>
              )}
              <div class="page-link-row">
                <span class="page-link-label">{props.shortLink ? t('Full link', 'Lien complet') : t('Link', 'Lien')}</span>
                <LinkField link={full} label={t('My page', 'Ma page')} />
              </div>
              {props.kutt && !props.shortLink && <p class="muted">{t('Your short link is on its way. Reload in a moment.', 'Ton lien court s’en vient. Recharge dans un instant.')}</p>}
              <div class="form-actions">
                <a class="button" href={`/p/${user.alias}`} target="_blank" rel="noopener">
                  {t('Open my page', 'Ouvrir ma page')}
                </a>
                <a class="button secondary" href="/page/qr.png" download={`${user.alias}-qr.png`}>
                  {t('Download QR code', 'Télécharger le code QR')}
                </a>
              </div>
            </div>
            <figure class="my-page-qr">
              <img src="/page/qr.png" alt={t(`QR code for ${props.shortLink ?? full}`, `Code QR pour ${props.shortLink ?? full}`)} width="180" height="180" />
              <figcaption class="muted">{t('Scan to open your page. Print it or add it to a flyer.', 'Scanne-le pour ouvrir ta page. Imprime-le ou ajoute-le à un flyer.')}</figcaption>
            </figure>
          </div>

          <div class="card stack-card">
            <h2 class="first">{t("What's on it", 'Ce qu’on y voit')}</h2>
            <p class="muted">
              {[
                t(`Your name (${user.name})`, `Ton nom (${user.name})`),
                avatarOf(user) ? t('your photo', 'ta photo') : t('your initials', 'tes initiales'),
                instagram ? t(`your Instagram (@${instagram})`, `ton Instagram (@${instagram})`) : '',
              ]
                .filter(Boolean)
                .join(', ')}
              . {t('Change them on', 'Modifie-les dans')} <a href="/account">{t('Account', 'Compte')}</a>.{' '}
              {t('Your sales and commission are never shown.', 'Tes ventes et ta commission ne sont jamais affichées.')}
            </p>
            {events.length ? (
              <ul class="page-event-list">
                {events.map((e) => (
                  <li>
                    <strong>{e.title}</strong> <span class="muted">{t(`with the code ${e.code}`, `avec le code ${e.code}`)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted">
                {t(
                  'No upcoming events right now. They show up here as soon as one of your codes is on one.',
                  'Aucun événement à venir pour l’instant. Ils apparaissent ici dès qu’un de tes codes est sur un événement.',
                )}
              </p>
            )}
            {withoutLink.length > 0 && (
              <p class="muted">
                {t(
                  'Event links are not set up yet, so your page tells people to use your code at checkout.',
                  'Les liens d’événements ne sont pas encore configurés : ta page dit donc aux gens d’utiliser ton code au paiement.',
                )}
              </p>
            )}
            <p class="muted">{t('Each event leaves your page once it is over.', 'Chaque événement disparaît de ta page une fois terminé.')}</p>
          </div>

          <form method="post" action="/page/visibility" class="hide-page">
            <input type="hidden" name="hidden" value="1" />
            <button type="submit" class="link">
              {t('Hide my page', 'Cacher ma page')}
            </button>
          </form>
        </>
      )}
    </Layout>
  );
}

// --- The index page's editor, Promoter pages → Index page ------------------------------------------

function ItemEditor(props: { item: DirectoryItem }) {
  const item = props.item;
  if (item.kind === 'promoter') return null;
  return (
    <details class="dir-edit">
      <summary>Edit</summary>
      <form method="post" action={`/admin/pages/index/${item.id}`} class="dir-edit-form">
        <label>
          {item.kind === 'link' ? 'Text' : 'Section title'}
          <input name="title" value={item.title} maxlength={80} required />
        </label>
        {item.kind === 'link' && (
          <label>
            Link
            <input name="url" value={item.url} maxlength={2000} required />
          </label>
        )}
        <div class="form-actions">
          <button type="submit">Save</button>
        </div>
      </form>
      <form method="post" action={`/admin/pages/index/${item.id}/remove`}>
        <button type="submit" class="link danger-link">
          Remove {item.kind === 'link' ? 'this link' : 'this section title'}
        </button>
      </form>
    </details>
  );
}

function ItemRow(props: { item: DirectoryItem; link: string | null }) {
  const item = props.item;
  const pageHidden = item.kind === 'promoter' && !!item.user.page_hidden_at;
  const name = item.kind === 'promoter' ? item.user.name : item.title;
  return (
    <li class={`dir-row${item.hidden || pageHidden ? ' off' : ''}${item.kind === 'heading' ? ' heading' : ''}`} data-id={item.id}>
      <button type="button" class="dir-handle" data-drag-handle aria-label={`Move ${name}: drag, or use the up and down arrow keys`}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM18 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-1.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM18 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
        </svg>
      </button>
      <div class="dir-main">
        {item.kind === 'promoter' ? (
          <span class="who">
            <Avatar user={item.user} size="small" />
            <span>
              <strong>{item.user.name}</strong>
              {props.link && <span class="muted dir-sub">{bareLink(props.link)}</span>}
            </span>
          </span>
        ) : item.kind === 'link' ? (
          <span class="who">
            <span class="dir-link-icon">{linkIcon}</span>
            <span>
              <strong>{item.title}</strong>
              <span class="muted dir-sub">{bareLink(item.url)}</span>
            </span>
          </span>
        ) : (
          <span class="dir-heading">{item.title}</span>
        )}
        <span class="dir-tags">
          {item.kind === 'heading' && <span class="badge">Section title</span>}
          {item.hidden && <span class="badge">Not on the page</span>}
          {pageHidden && <span class="badge">{hiddenByTeam(item.user) ? 'Page hidden by an admin' : 'Page hidden by the promoter'}</span>}
        </span>
        <ItemEditor item={item} />
      </div>
      <form method="post" action={`/admin/pages/index/${item.id}/visibility`} class="dir-toggle">
        <input type="hidden" name="hidden" value={item.hidden ? '0' : '1'} />
        <button type="submit" class={item.hidden ? 'secondary' : 'link'}>
          {item.hidden ? 'Show' : 'Hide'}
        </button>
      </form>
    </li>
  );
}

export function DirectoryEditorPage(props: {
  user: User;
  settings: DirectorySettings;
  items: DirectoryItem[];
  links: Map<number, string>;
  version: string;
  ok?: string;
  error?: string;
}) {
  const s = props.settings;
  const shown = props.items.filter((i) => !i.hidden && (i.kind !== 'promoter' || !i.user.page_hidden_at)).length;
  return (
    <Layout title="Index page" user={props.user}>
      <h1>Promoter pages</h1>
      <PagesTabs current="index" />
      <p class="muted">
        One page listing your promoters, with your own links and section titles in between, like a link-in-bio page for the
        whole team. Anyone with the address can open it.
      </p>
      <Flash ok={props.ok} error={props.error} />
      <div class="card dir-address">
        <LinkField link={`${config.appUrl}/p`} label="Index page" />
        <a class="button secondary" href={`/p?v=${props.version}`} target="_blank" rel="noopener">
          Open the page
        </a>
      </div>

      <h2>On the page</h2>
      <p class="muted">
        Drag the rows by their handle to change the order; it is saved right away. {shown === 1 ? '1 row shows' : `${shown} rows show`} on the page.
        Promoters can only be hidden, not removed: they are on the list as long as they have a page.
      </p>
      {props.items.length ? (
        <>
          <ul class="dir-list" data-sortable="/admin/pages/index/order">
            {props.items.map((item) => (
              <ItemRow item={item} link={item.kind === 'promoter' ? (props.links.get(item.user.id) ?? null) : null} />
            ))}
          </ul>
          <p class="muted dir-status" data-sort-status aria-live="polite"></p>
        </>
      ) : (
        <div class="card muted">No promoters with a page yet.</div>
      )}

      <div class="two-col dir-add">
        <form class="card stack-card" method="post" action="/admin/pages/index/add">
          <h2 class="first">Add a link</h2>
          <input type="hidden" name="kind" value="link" />
          <label>
            Text
            <input name="title" maxlength={80} placeholder="Our Instagram" required />
          </label>
          <label>
            Link
            <input name="url" maxlength={2000} placeholder="instagram.com/…" required />
          </label>
          <div class="form-actions">
            <button type="submit">Add the link</button>
          </div>
        </form>
        <form class="card stack-card" method="post" action="/admin/pages/index/add">
          <h2 class="first">Add a section title</h2>
          <input type="hidden" name="kind" value="heading" />
          <label>
            Title
            <input name="title" maxlength={80} placeholder="Montréal" required />
          </label>
          <p class="muted">Drag the promoters under it. A section title with nothing shown under it is left off the page.</p>
          <div class="form-actions">
            <button type="submit">Add the title</button>
          </div>
        </form>
      </div>

      <h2>Look</h2>
      <form class="account-form" method="post" action="/admin/pages/index" enctype="multipart/form-data">
        <div class="two-col">
          <div class="card stack-card">
            <h2 class="first">Text</h2>
            <label>
              Title
              <input name="title" value={s.title} maxlength={60} required />
            </label>
            <label>
              Under the title (leave empty for none)
              <textarea name="tagline" maxlength={200}>
                {s.tagline}
              </textarea>
            </label>
            <fieldset class="dir-fieldset">
              <legend>When a promoter gets a page</legend>
              <label class="check">
                <input type="radio" name="new_promoters" value="show" checked={s.newPromoters === 'show'} /> Add them to the end of the list
              </label>
              <label class="check">
                <input type="radio" name="new_promoters" value="hide" checked={s.newPromoters === 'hide'} /> Add them hidden, to show when you choose
              </label>
            </fieldset>
          </div>
          <div class="card stack-card">
            <h2 class="first">Background</h2>
            <fieldset class="dir-fieldset" aria-label="Background">
              <label class="check">
                <input type="radio" name="background" value="brand" checked={s.background === 'brand'} /> The brand colour, fading out
              </label>
              <label class="check">
                <input type="radio" name="background" value="color" checked={s.background === 'color'} /> One colour
              </label>
              <label class="check">
                <input type="radio" name="background" value="gradient" checked={s.background === 'gradient'} /> A gradient between two colours
              </label>
              <label class="check">
                <input type="radio" name="background" value="image" checked={s.background === 'image'} disabled={!s.imageKey} /> A photo
                {!s.imageKey && <span class="muted"> (upload one below)</span>}
              </label>
            </fieldset>
            <div class="swatch-row">
              <label>
                Colour (top of the gradient)
                <input type="color" name="color" value={s.color} />
              </label>
              <label>
                Bottom of the gradient
                <input type="color" name="color2" value={s.color2} />
              </label>
            </div>
            <label>
              Photo (PNG, JPEG or WebP, up to {Math.round(maxUploadBytes / 1024 / 1024)} MB; darkened so the text reads on it)
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp" />
            </label>
            {s.imageKey && (
              <>
                <img class="dir-image-preview" src={`/directory/background?v=${s.updatedAt}`} alt="Current background photo" />
                <label class="check">
                  <input type="checkbox" name="remove_image" value="1" /> Remove the photo
                </label>
              </>
            )}
            <p class="muted">A new photo becomes the background as soon as it is saved.</p>
          </div>
        </div>
        <button type="submit">Save the look</button>
      </form>
    </Layout>
  );
}
