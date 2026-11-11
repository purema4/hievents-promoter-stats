import { MiniChart, parseRange, recentTickets, SalesChart, type Range } from './chart';
import { config } from './config';
import type { CodeStats, DailySales, TicketEvent } from './hievents';
import type { User } from './local-db';
import { eventBonus, eventCommission, formatMoney, splitCommission, toCents, totalsByCurrency, type Rate, type Totals } from './money';
import { type Balance, type PayoutRequest } from './payouts';
import { describeReward, levelFor, type RewardRequest, type Rewards, type TicketReward } from './rewards';
import { describeTrack, rewardRules, trackOn } from './reward-rules';
import { describeAdjustment, type Adjustment } from './adjustments';
import { Avatar, Banner, Flash, formatDate, Layout, LevelBadge } from './views';
import { avatarOf } from './avatars';
import { eventLink } from './links';
import { linkClicks, shareLink } from './short-links';
import { lang, locale, plural, t } from './i18n';

export type EventSummary = {
  id: number;
  title: string;
  start: Date | null;
  end: Date | null;
  dates: number;
  timezone: string | null;
  hasCover: boolean;
  draft: boolean; // not on sale yet: no link or code to share
  currency: string;
  codes: string[];
  rows: CodeStats[];
  tickets: number;
  pending: number;
  orders: number;
  fullPrice: number;
  paid: number;
  commission: number;
  bonus: number; // cents, given by the event's rule on top of the commission
};

// The stats query returns one row per code and event; pages work per event.
export function summarizeEvents(rows: CodeStats[], rate: Rate | number): EventSummary[] {
  const events = new Map<number, EventSummary>();
  for (const r of rows) {
    const e = events.get(r.event_id) ?? {
      id: r.event_id,
      title: r.event_title,
      start: r.event_start,
      end: r.event_end,
      dates: r.event_dates,
      timezone: r.event_timezone,
      hasCover: r.has_cover,
      draft: r.draft,
      currency: r.currency,
      codes: [],
      rows: [],
      tickets: 0,
      pending: 0,
      orders: 0,
      fullPrice: 0,
      paid: 0,
      commission: 0,
      bonus: 0,
    };
    e.codes.push(r.code);
    e.rows.push(r);
    e.tickets += r.tickets_sold;
    e.pending += r.tickets_pending;
    e.orders += r.orders;
    e.fullPrice += toCents(r.full_price);
    e.paid += toCents(r.paid);
    events.set(r.event_id, e);
  }
  for (const e of events.values()) {
    e.commission = eventCommission(rate, e.id, e.rows);
    e.bonus = eventBonus(rate, e.id);
  }
  // Chronological, oldest first; pages re-sort as they need.
  return [...events.values()].sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
}

/** "1 free ticket", "2 VIP": a count of one reward type. */
export function rewardCount(r: TicketReward, n: number): string {
  return r.type.key === 'free_tickets'
    ? plural(n, ['free ticket', 'billet gratuit'], ['free tickets', 'billets gratuits'])
    : `${n} ${t(r.type.label_en, r.type.label_fr || r.type.label_en)}`;
}

/** What is ready to request on one event, like "2 VIP + 1 GA list"; '' when nothing is. */
function readyOn(rewards: Rewards, eventId: number): string {
  return rewards.tickets
    .filter((t) => t.event.id === eventId && t.available > 0)
    .map((t) => rewardCount(t, t.available))
    .join(' + ');
}

const isPast = (e: EventSummary) => !!e.end && e.end.getTime() < Date.now();

function eventDate(e: EventSummary): string {
  return `${formatDate(e.start, e.timezone)}${e.dates > 1 ? ` (${e.dates} dates)` : ''}`;
}

/** "2 more sales for the next one" / "Encore 2 ventes pour la prochaine". */
function forNext(n: number): string {
  const sales = plural(n, ['more sale', 'vente'], ['more sales', 'ventes']);
  return t(`${sales} for the next one`, `Encore ${sales} pour la prochaine`);
}

/** "Merch unlocks in 3 more tickets" / "Merch débloqué dans 3 billets". */
function unlocksIn(label: string, n: number): string {
  const tickets = plural(n, ['more ticket', 'billet'], ['more tickets', 'billets']);
  return t(`${label} unlocks in ${tickets}`, `${label} : encore ${tickets} pour le débloquer`);
}

function Footnote() {
  return (
    <p class="muted">
      {t(
        "Commission is set by the team for each event. Sales count at the full ticket price, before your promo code's discount, without taxes and fees, minus refunds. Tickets awaiting payment count once they are paid. Refunded and cancelled tickets are not counted.",
        'La commission est fixée par l’équipe pour chaque événement. Les ventes comptent au plein prix du billet, avant le rabais de ton code promo, sans taxes ni frais, moins les remboursements. Les billets en attente de paiement comptent une fois payés. Les billets remboursés ou annulés ne comptent pas.',
      )}
    </p>
  );
}

function SummaryCards(props: {
  totals: Totals[];
  balances: Balance[];
  outsideSold: number;
  payoutsHref?: string;
}) {
  // One set of cards per currency; a promoter can also have only hand-entered sales and money.
  const currencies = [...new Set([...props.totals.map((t) => t.currency), ...props.balances.map((b) => b.currency)])];
  return (
    <div class="grid">
      {currencies.map((cur) => {
        const b = props.balances.find((x) => x.currency === cur);
        return (
          <div class="card stat highlight">
            <div class="value">{formatMoney(b?.earned ?? 0, cur)}</div>
            <div class="label">
              {t('Commission earned', 'Commission gagnée')}
              {b && b.added !== 0 && <> · {t('incl.', 'dont')} {b.added > 0 ? '+' : '−'}{formatMoney(Math.abs(b.added), cur)} {t('from the team', 'de l’équipe')}</>}
              {b && b.fromTeam !== 0 && <> · {t('incl.', 'dont')} {formatMoney(b.fromTeam, cur)} {t('team commission', 'de commission d’équipe')}</>}
              {b && b.bonus !== 0 && <> · {t('incl.', 'dont')} {formatMoney(b.bonus, cur)} {t('bonus', 'de bonus')}</>}
            </div>
          </div>
        );
      })}
      {props.balances.map((b) => (
        <div class="card stat">
          <div class="value">{formatMoney(b.available, b.currency)}</div>
          <div class="label">
            {t('Available to request', 'Disponible à demander')}
            {props.payoutsHref && b.available > 0 && (
              <>
                {' · '}
                <a href={props.payoutsHref}>{t('Request payout', 'Demander un paiement')}</a>
              </>
            )}
          </div>
        </div>
      ))}
      {props.totals.map((x) => (
        <div class="card stat">
          <div class="value">{formatMoney(x.fullPrice, x.currency)}</div>
          <div class="label">{t('Ticket sales at full price', 'Ventes de billets au plein prix')}</div>
        </div>
      ))}
      <div class="card stat">
        <div class="value">{props.totals.reduce((sum, t) => sum + t.tickets, 0) + props.outsideSold}</div>
        <div class="label">
          {t('Tickets sold', 'Billets vendus')}, {plural(props.totals.reduce((sum, x) => sum + x.orders, 0), ['order', 'commande'], ['orders', 'commandes'])}
          {props.outsideSold !== 0 && <> · {t(`incl. ${props.outsideSold} outside the ticketing site`, `dont ${props.outsideSold} hors billetterie`)}</>}
          {props.totals.some((x) => x.pending > 0) && (
            <span class="pending"> · {t(`${props.totals.reduce((sum, x) => sum + x.pending, 0)} awaiting payment`, `${props.totals.reduce((sum, x) => sum + x.pending, 0)} en attente de paiement`)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const lowerFirst = (text: string) => text[0]!.toLowerCase() + text.slice(1);

/** The promoter's money and rewards waiting to be requested, with big buttons to do it. */
// Until they have a profile photo (uploaded, or from their Instagram).
function PhotoCallout(props: { promoter: User }) {
  if (avatarOf(props.promoter)) return null;
  return (
    <div class="card reward-card photo-callout">
      <Avatar user={props.promoter} />
      <div>
        <strong>{t('Add your profile photo', 'Ajoute ta photo de profil')}</strong>
        <div class="muted">
          {t(
            'It shows on your public page and to the team. Upload one, or add your Instagram to use its photo.',
            'Elle paraît sur ta page publique et l’équipe la voit. Téléverse-en une, ou ajoute ton Instagram pour utiliser sa photo.',
          )}
        </div>
      </div>
      <a class="button" href="/account">
        {t('Add my photo', 'Ajouter ma photo')}
      </a>
    </div>
  );
}

// Until they have a city: it puts them on the team's map (only the team sees it).
function CityCallout(props: { promoter: User }) {
  if (props.promoter.city?.trim()) return null;
  return (
    <div class="card reward-card city-callout">
      <div>
        <strong>{t('Add your city', 'Ajoute ta ville')}</strong>
        <div class="muted">{t('So the team knows where you promote. Only the team sees it.', 'Pour que l’équipe sache où tu fais ta promo. Seule l’équipe la voit.')}</div>
      </div>
      <a class="button" href="/account#city">
        {t('Add my city', 'Ajouter ma ville')}
      </a>
    </div>
  );
}

function PayoutCallout(props: { balances: Balance[]; rewards: Rewards }) {
  const ready = props.balances.filter((b) => b.available > 0);
  const waiting = props.balances.filter((b) => b.pending > 0);
  const rewardsReady = props.rewards.tickets.reduce((sum, t) => sum + t.available, 0) + props.rewards.merch.available;
  if (ready.length === 0 && waiting.length === 0 && rewardsReady === 0) return null;
  return (
    <div class={`card payout-callout${ready.length ? ' ready' : ''}`}>
      <div class="payout-callout-text">
        {ready.length > 0 ? (
          <>
            <div class="payout-callout-label">{t('Ready to request', 'Prêt à demander')}</div>
            <div class="payout-callout-amount">{ready.map((b) => formatMoney(b.available, b.currency)).join(' + ')}</div>
          </>
        ) : waiting.length === 0 ? (
          <div class="payout-callout-label">
            {t(`${plural(rewardsReady, ['reward', ''], ['rewards', ''])} ready to request`, `${plural(rewardsReady, ['', 'récompense prête'], ['', 'récompenses prêtes'])} à demander`)}
          </div>
        ) : null}
        {waiting.length > 0 && (
          <div class={ready.length ? 'muted' : 'payout-callout-label'}>
            {waiting.map((b) => formatMoney(b.pending, b.currency)).join(' + ')} {t('requested, waiting for approval', 'demandé, en attente d’approbation')}
          </div>
        )}
      </div>
      <div class="payout-callout-actions">
        {/* One way to ask for anything: checkout, with the payout and every reward ready. */}
        {(ready.length > 0 || rewardsReady > 0) && (
          <a class="button big" href="/rewards/checkout">
            {ready.length > 0 && rewardsReady > 0
              ? t(
                  `Request my payout and ${plural(rewardsReady, ['reward', ''], ['rewards', ''])}`,
                  `Demander mon paiement et ${plural(rewardsReady, ['', 'récompense'], ['', 'récompenses'])}`,
                )
              : ready.length > 0
                ? t('Request my payout', 'Demander mon paiement')
                : t(`Request ${plural(rewardsReady, ['reward', ''], ['rewards', ''])}`, `Demander ${plural(rewardsReady, ['', 'récompense'], ['', 'récompenses'])}`)}
          </a>
        )}
        {ready.length === 0 && rewardsReady === 0 && (
          <a class="button secondary" href="/payouts">
            {t('See my payouts', 'Voir mes paiements')}
          </a>
        )}
      </div>
    </div>
  );
}

function Progress(props: { percent: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(props.percent)));
  return (
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={props.label}>
      <div class={`progress-fill w-${pct}`} />
    </div>
  );
}

function LevelCard(props: { rewards: Rewards; rewardsHref?: string; deal?: { name: string; words: string }[] }) {
  const { totalSold, merch } = props.rewards;
  const rules = rewardRules();
  const { level, next, progress } = levelFor(totalSold);
  const freeTickets = props.rewards.tickets.reduce((sum, t) => sum + t.available, 0);
  // Named by what is actually ready: other types with none available don't change the words.
  const onlyPlain = props.rewards.tickets.every((t) => t.available === 0 || t.type.key === 'free_tickets');
  return (
    <div class="card level-card">
      <div class="level-head">
        <LevelBadge level={level} />
        <span class="muted">
          {t(
            `${plural(totalSold, ['ticket', ''], ['tickets', ''])} sold in total`,
            `${plural(totalSold, ['', 'billet vendu'], ['', 'billets vendus'])} en tout`,
          )}
        </span>
      </div>
      <Progress
        percent={progress}
        label={next ? t(`Progress to ${next.name}`, `Progression vers ${next.name}`) : t('Top level reached', 'Niveau maximum atteint')}
      />
      <p class="muted level-next">
        {next
          ? t(`${next.at - totalSold} more to reach ${next.name}`, `Encore ${next.at - totalSold} pour atteindre ${next.name}`)
          : t(`Top level: ${level.name}. Legendary.`, `Niveau maximum : ${level.name}. Légendaire.`)}
      </p>
      <ul class="unlocks">
        {freeTickets > 0 ? (
          <li class="ready">
            {t(
              `${plural(freeTickets, [onlyPlain ? 'free ticket' : 'event reward', ''], [onlyPlain ? 'free tickets' : 'event rewards', ''])} ready to request`,
              `${plural(freeTickets, ['', onlyPlain ? 'billet gratuit prêt' : 'récompense d’événement prête'], ['', onlyPlain ? 'billets gratuits prêts' : 'récompenses d’événement prêtes'])} à demander`,
            )}
          </li>
        ) : (
          // Nothing ready: what each event gives, as their rule says (not a copy of it that could drift).
          (props.deal ?? [])
            .filter((d) => d.name !== 'commission' && d.name !== 'bonus')
            .map((d) => <li>{t(`On each event, ${lowerFirst(d.words)}`, `Pour chaque événement, ${lowerFirst(d.words)}`)}</li>)
        )}
        {(trackOn(rules.merch) || merch.available > 0) && (
          <li class={merch.available > 0 ? 'ready' : ''}>
            {merch.available > 0
              ? t(`${merch.readyLabel || 'Merch'} unlocked: request it now`, `${merch.readyLabel || 'Merch'} débloqué : demande-le maintenant`)
              : merch.nextIn !== null
                ? unlocksIn(merch.nextLabel || 'Merch', merch.nextIn)
                : t('All merch unlocked', 'Tout le merch est débloqué')}
          </li>
        )}
      </ul>
      {props.rewardsHref && (freeTickets > 0 || merch.available > 0) && (
        <a href={props.rewardsHref}>{t('Request your rewards →', 'Demander tes récompenses →')}</a>
      )}
    </div>
  );
}

export function LinkField(props: { link: string; label: string }) {
  return (
    <div class="link-field">
      <input readonly value={props.link} aria-label={props.label} />
      <button type="button" data-copy>
        {t('Copy link', 'Copier le lien')}
      </button>
      <button type="button" class="secondary" data-share data-share-title={props.label} hidden>
        {t('Share', 'Partager')}
      </button>
    </div>
  );
}

/** On the dashboard: the link to the promoter's public page, ready to copy or share. */
function PageCard(props: { link: string }) {
  return (
    <div class="card page-card">
      <div>
        <h2 class="first">{t('Your page', 'Ta page')}</h2>
        <p class="muted">
          {t(
            'All your upcoming events in one link, with your code in each. Made for your Instagram bio.',
            'Tous tes événements à venir dans un seul lien, avec ton code dans chacun. Parfait pour ta bio Instagram.',
          )}
        </p>
      </div>
      <LinkField link={props.link} label={t('My page', 'Ma page')} />
      <a href="/page">{t('Open it, get the QR code →', 'L’ouvrir, obtenir le code QR →')}</a>
    </div>
  );
}

/** A promo code as a button that copies it. */
export function CodeCopy(props: { code: string }) {
  return (
    <button type="button" class="secondary small code-copy" data-copy-text={props.code} title={t('Copy the promo code', 'Copier le code promo')}>
      <span class="code-value">{props.code}</span>
      <span class="code-action">{t('Copy', 'Copier')}</span>
    </button>
  );
}

/** Each of the promoter's codes, ready to copy, with the upcoming events it works on. */
function CodesCard(props: { codes: string[]; rows: CodeStats[]; upcoming: EventSummary[] }) {
  // Shown as Hi.Events spells the code; codes are kept lowercase here.
  const spelled = new Map(props.rows.map((r) => [r.code.toLowerCase(), r.code]));
  const eventsFor = (code: string) => props.upcoming.filter((e) => e.codes.some((c) => c.toLowerCase() === code));
  return (
    <div class="card codes-card">
      <h2 class="first">{props.codes.length > 1 ? t('Your promo codes', 'Tes codes promo') : t('Your promo code', 'Ton code promo')}</h2>
      <p class="muted">
        {t(
          'Customers enter it at checkout and the sale counts for you. Your links already include it.',
          'Les clients l’entrent au paiement et la vente compte pour toi. Tes liens l’incluent déjà.',
        )}
      </p>
      <div class="code-list">
        {props.codes.map((code) => {
          const events = eventsFor(code);
          return (
            <div class="code-item">
              <CodeCopy code={spelled.get(code) ?? code} />
              <span class="muted">
                {!spelled.has(code)
                  ? t('Not in the ticketing system yet', 'Pas encore dans la billetterie')
                  : events.length
                    ? events.map((e) => e.title).join(', ')
                    : t('No upcoming events', 'Aucun événement à venir')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The event's media drive (photos, videos, flyers), set by admins on Events → Media drives.
function MediaButton(props: { url: string }) {
  return (
    <a class="button secondary small" href={props.url} target="_blank" rel="noopener noreferrer">
      {t('Photos & flyers', 'Photos et affiches')}
    </a>
  );
}

function EventCard(props: {
  event: EventSummary;
  href: string;
  ready?: string; // rewards ready to request on this event, like "2 VIP + 1 GA list"
  link?: string | null;
  copyCodes?: boolean;
  media?: string;
  banner?: string;
  daily?: DailySales[]; // this event's sales; past events do without the recent ones
}) {
  const e = props.event;
  // Nothing sold yet: no chart of empty days, so these cards stay short.
  const daily = e.tickets > 0 || e.pending > 0 ? props.daily : undefined;
  return (
    <div class="card event-card">
      {props.banner && <Banner text={props.banner} label={t(`Notice for ${e.title}`, `Avis pour ${e.title}`)} />}
      <a class="event-card-main" href={props.href}>
        <span class="event-main">
          {e.hasCover && <img class="cover-thumb" src={`/event-image/${e.id}`} alt="" loading="lazy" />}
          <span class="event">
            <strong>{e.title}</strong>
            <span class="muted">{eventDate(e)}</span>
            <span>
              {!props.copyCodes && !e.draft && e.codes.map((c) => <span class="code">{c}</span>)}
              {e.draft && <span class="chip warn">{t('Not on sale yet', 'Pas encore en vente')}</span>}
              {!!props.ready && <span class="chip">{t(`${props.ready} ready`, `${props.ready} à demander`)}</span>}
            </span>
          </span>
        </span>
        <span class="event-stats">
          <span class="primary">
            <span class="big">{e.tickets}</span>
            <span class="muted">
              {(lang() === 'fr' ? e.tickets < 2 : e.tickets === 1) ? t('ticket sold', 'billet vendu') : t('tickets sold', 'billets vendus')}
              {e.pending > 0 && <span class="pending"> +{e.pending} {t('pending', 'en attente')}</span>}
            </span>
          </span>
          <span>
            <span class="big">{formatMoney(e.commission, e.currency)}</span>
            <span class="muted">commission{e.bonus > 0 && ` + ${formatMoney(e.bonus, e.currency)} ${t('bonus', 'de bonus')}`}</span>
          </span>
          {daily && (
            <span>
              <span class="big">{recentTickets(daily, '7')}</span>
              <span class="muted">{t('last 7 days', '7 derniers jours')}</span>
            </span>
          )}
        </span>
        {daily && <MiniChart daily={daily} />}
      </a>
      {(props.link || props.copyCodes || props.media) && (
        <div class="card-actions">
          {props.link && (
            <button type="button" class="secondary small" data-copy-text={props.link}>
              {t('Copy my link', 'Copier mon lien')}
            </button>
          )}
          {props.copyCodes && e.codes.map((code) => <CodeCopy code={code} />)}
          {props.link && (
            <button type="button" class="secondary small" data-share data-share-url={props.link} data-share-title={e.title} hidden>
              {t('Share', 'Partager')}
            </button>
          )}
          {props.media && <MediaButton url={props.media} />}
        </div>
      )}
    </div>
  );
}

export function DashboardPage(props: {
  viewer: User;
  promoter: User;
  basePath: string; // '' for the promoter, '/admin/promoters/:id/view' when an admin looks, '/team/:id' for their team lead
  codes: string[];
  rows: CodeStats[];
  daily: DailySales[];
  balances: Balance[];
  rewards: Rewards;
  percent: Rate | number;
  media: Map<number, string>;
  banners: Map<number, string>;
  pageLink?: string | null; // the promoter's public page (short link when there is one); none when hidden
  deal?: { name: string; words: string }[]; // their usual rule in words, for the level card
}) {
  const events = summarizeEvents(props.rows, props.percent);
  const upcoming = events.filter((e) => !isPast(e));
  const past = events.filter(isPast).reverse();
  const totals = totalsByCurrency(props.rows, props.percent);
  const self = props.basePath === '';
  const eventHref = (e: EventSummary) => `${props.basePath}/events/${e.id}`;


  return (
    <Layout title={t('My sales', 'Mes ventes')} user={props.viewer} promoterView>
      {!self &&
        (props.basePath.startsWith('/team/') ? (
          <p class="muted">
            <a href="/team">{t('My team', 'Mon équipe')}</a> / {props.promoter.name}
          </p>
        ) : (
          <p class="muted">
            <a href="/admin">Promoters</a> / <a href={`/admin/promoters/${props.promoter.id}`}>{props.promoter.name}</a> /
            Their dashboard
          </p>
        ))}
      <div class="who">
        <Avatar user={props.promoter} />
        <h1>{self ? t(`Hi ${props.promoter.name}`, `Salut ${props.promoter.name}`) : t(`${props.promoter.name}'s dashboard`, `Tableau de bord de ${props.promoter.name}`)}</h1>
      </div>
      <p class="muted">
        {t('Live from the ticketing system. Updated at', 'En direct de la billetterie. Mis à jour à')}{' '}
        {new Intl.DateTimeFormat(locale(), { timeStyle: 'short', timeZone: config.timezone }).format(new Date())}
      </p>

      {props.codes.length === 0 && props.balances.length === 0 && props.rewards.outsideSold === 0 ? (
        <>
          {self && <PhotoCallout promoter={props.promoter} />}
          {self && <CityCallout promoter={props.promoter} />}
          <div class="card empty-state">
            <strong>{t('No promo code yet', 'Pas encore de code promo')}</strong>
            <p class="muted">
              {t(
                'The team gives each promoter their own code. As soon as yours is added, your sales, commission and rewards show up here.',
                'L’équipe donne à chaque promoteur son propre code. Dès que le tien est ajouté, tes ventes, ta commission et tes récompenses s’affichent ici.',
              )}
            </p>
          </div>
        </>
      ) : (
        <>
          {/* What they can ask for comes first: no scrolling past every event to find it. */}
          {self && <PayoutCallout balances={props.balances} rewards={props.rewards} />}
          <h2>{t('Upcoming events', 'Événements à venir')}</h2>
          {upcoming.length === 0 ? (
            <p class="muted">{t('No upcoming events with your codes.', 'Aucun événement à venir avec tes codes.')}</p>
          ) : (
            <div class="event-grid">
              {upcoming.map((e) => (
                <EventCard
                  event={e}
                  href={eventHref(e)}
                  ready={readyOn(props.rewards, e.id)}
                  link={e.draft ? null : shareLink(props.promoter, { id: e.id, title: e.title }, e.codes[0]!)}
                  copyCodes={!e.draft}
                  media={props.media.get(e.id)}
                  banner={props.banners.get(e.id)}
                  daily={props.daily.filter((d) => d.event_id === e.id)}
                />
              ))}
            </div>
          )}

          <h2>{t('My totals', 'Mes totaux')}</h2>
          {self && <PhotoCallout promoter={props.promoter} />}
          {self && <CityCallout promoter={props.promoter} />}
          <SummaryCards
            totals={totals}
            balances={props.balances}
            outsideSold={props.rewards.outsideSold}
            payoutsHref={self ? '/rewards/checkout' : undefined}
          />
          <LevelCard rewards={props.rewards} rewardsHref={self ? '/rewards/checkout' : undefined} deal={props.deal} />
          {self && props.pageLink && <PageCard link={props.pageLink} />}
          {props.codes.length > 0 && <CodesCard codes={props.codes} rows={props.rows} upcoming={upcoming.filter((e) => !e.draft)} />}

          {past.length > 0 && (
            <>
              <h2>{t('Past events', 'Événements passés')}</h2>
              <div class="event-grid">
                {past.map((e) => (
                  <EventCard event={e} href={eventHref(e)} media={props.media.get(e.id)} />
                ))}
              </div>
            </>
          )}

          <Footnote />
        </>
      )}
    </Layout>
  );
}

/**
 * At the top of an event page: what they can ask for right now (this event's rewards, their payout) and
 * one button that goes straight to checkout with all of it.
 */
function RequestAllCard(props: { eventId: number; rewards: Rewards['tickets']; payout?: { amountCents: number; currency: string } }) {
  const ready = props.rewards.filter((r) => r.available > 0);
  if (ready.length === 0 && !props.payout) return null;
  const parts = [
    ...(props.payout ? [t(`your payout of ${formatMoney(props.payout.amountCents, props.payout.currency)}`, `ton paiement de ${formatMoney(props.payout.amountCents, props.payout.currency)}`)] : []),
    ...ready.map((r) => rewardCount(r, r.available)),
  ];
  return (
    <div class="card payout-callout ready request-all">
      <div class="payout-callout-text">
        <div class="payout-callout-label">{t('Ready to request', 'Prêt à demander')}</div>
        <div>{parts.join(' · ')}</div>
      </div>
      <div class="payout-callout-actions">
        <a class="button big" href={`/rewards/checkout?event=${props.eventId}`}>
          {t('Request →', 'Demander →')}
        </a>
      </div>
    </div>
  );
}

export function EventPage(props: {
  viewer: User;
  promoter: User;
  basePath: string;
  rows: CodeStats[];
  eventId: number;
  daily: DailySales[];
  rewards: Rewards;
  percent: Rate | number;
  media: string | null;
  banner: string | null;
  range: Range;
  /** Their deal on this event in words, and what it gave them: never the rule itself. */
  deal?: { lang: 'en' | 'fr'; lines: string[]; result: string };
  /** Their payout, when there is one to ask for (their own view only). */
  payout?: { amountCents: number; currency: string };
}) {
  const events = summarizeEvents(props.rows, props.percent);
  const index = events.findIndex((e) => e.id === props.eventId);
  const rewardsHere = props.rewards.tickets.filter((t) => t.event.id === props.eventId);
  const self = props.basePath === '';
  const e = events[index];
  const previous = events[index - 1];
  const next = events[index + 1];
  const href = (id: number) => `${props.basePath}/events/${id}`;
  // Sales stop when the event is over, so a past event's chart ends on its last date.
  // The event's commission spread over its codes, adding up to it exactly.
  const byCode = splitCommission(props.percent, e.rows.map((r) => ({ event_id: r.event_id, full_price: r.full_price, tickets: r.tickets_sold })));
  const end = isPast(e) && e.end ? new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone ?? 'UTC' }).format(e.end) : undefined;

  return (
    <Layout title={e.title} user={props.viewer} promoterView>
      <nav class="crumbs muted">
        <a href={props.basePath || '/'}>{t('All events', 'Tous les événements')}</a>
        <span class="prev-next">
          {previous ? <a href={href(previous.id)}>← {previous.title}</a> : <span />}
          {next ? <a href={href(next.id)}>{next.title} →</a> : <span />}
        </span>
      </nav>
      {e.hasCover && <img class="cover-hero" src={`/event-image/${e.id}`} alt="" />}
      <h1>{e.title}</h1>
      <p class="muted">
        {eventDate(e)}
        {isPast(e) ? t(' · Past event', ' · Événement passé') : ''}
      </p>
      {props.banner && !isPast(e) && <Banner text={props.banner} label={t(`Notice for ${e.title}`, `Avis pour ${e.title}`)} />}
      {self && <RequestAllCard eventId={e.id} rewards={rewardsHere} payout={props.payout} />}

      <div class="grid">
        <div class="card stat highlight">
          <div class="value">{formatMoney(e.commission, e.currency)}</div>
          <div class="label">Commission</div>
        </div>
        {e.bonus > 0 && (
          <div class="card stat highlight">
            <div class="value">{formatMoney(e.bonus, e.currency)}</div>
            <div class="label">{t('Bonus', 'Bonus')}</div>
          </div>
        )}
        <div class="card stat">
          <div class="value">{e.tickets}</div>
          <div class="label">
            {t('Tickets sold', 'Billets vendus')}, {plural(e.orders, ['order', 'commande'], ['orders', 'commandes'])}
            {e.pending > 0 && <span class="pending"> · {t(`${e.pending} awaiting payment`, `${e.pending} en attente de paiement`)}</span>}
          </div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(e.fullPrice, e.currency)}</div>
          <div class="label">{t('Ticket sales at full price', 'Ventes de billets au plein prix')}</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(e.paid, e.currency)}</div>
          <div class="label">{t('Paid by customers after discounts', 'Payé par les clients après rabais')}</div>
        </div>
      </div>

      {props.deal && props.deal.lines.length > 0 && (
        <div class="card deal-card" lang={props.deal.lang}>
          <h2 class="first">{props.deal.lang === 'fr' ? 'Ton entente pour cet événement' : 'Your deal on this event'}</h2>
          <ul>
            {props.deal.lines.map((line) => (
              <li>{line}</li>
            ))}
          </ul>
          <p>
            <strong>{props.deal.result}</strong>
          </p>
        </div>
      )}

      <div class="card links-card">
        <h2 class="first">{e.codes.length > 1 ? t('Your links and codes', 'Tes liens et codes') : t('Your link and code', 'Ton lien et ton code')}</h2>
        {e.draft ? (
          <p class="muted">
            {t(
              'This event is not on sale yet. Your link and code will show here once tickets are on sale.',
              'Cet événement n’est pas encore en vente. Ton lien et ton code vont apparaître ici dès que les billets seront en vente.',
            )}
          </p>
        ) : eventLink({ id: e.id, title: e.title }, e.codes[0]!, props.promoter.alias) ? (
          <>
            <p class="muted">{t('Share it: the promo code is applied automatically and the sale counts for you.', 'Partage-le : le code promo s’applique tout seul et la vente compte pour toi.')}</p>
            {e.codes.map((code) => {
              const clicks = linkClicks(props.promoter, { id: e.id, title: e.title }, code);
              return (
                <div class="link-row">
                  <div class="link-code">
                    <span class="muted">{t('Promo code', 'Code promo')}</span>
                    <CodeCopy code={code} />
                  </div>
                  <LinkField link={shareLink(props.promoter, { id: e.id, title: e.title }, code)!} label={`${e.title} (${code})`} />
                  {clicks !== null && (
                    <span class="muted link-clicks">
                      {t(`${plural(clicks, ['click', ''], ['clicks', ''])} on this link`, `${plural(clicks, ['', 'clic'], ['', 'clics'])} sur ce lien`)}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <p class="muted">
              {t(
                'Links will show here once the team sets up the ticketing site address. Until then, share your code:',
                'Les liens vont apparaître ici quand l’équipe aura configuré l’adresse de la billetterie. D’ici là, partage ton code :',
              )}
            </p>
            <div class="code-list">
              {e.codes.map((c) => (
                <CodeCopy code={c} />
              ))}
            </div>
          </>
        )}
      </div>

      {props.media && (
        <div class="card reward-card media-card">
          <div>
            <strong>{t('Photos and flyers', 'Photos et affiches')}</strong>
            <div class="muted">{t('Photos, videos and flyers for this event, ready to post.', 'Photos, vidéos et affiches de cet événement, prêtes à publier.')}</div>
          </div>
          <a class="button" href={props.media} target="_blank" rel="noopener noreferrer">
            {t('Open →', 'Ouvrir →')}
          </a>
        </div>
      )}

      {rewardsHere.map((reward) => (
        <div class="card reward-card">
          <div>
            <strong>
              {reward.available > 0
                ? t(`${rewardCount(reward, reward.available)} ready for this event`, `${rewardCount(reward, reward.available)} à demander pour cet événement`)
                : t(
                    `${reward.type.key === 'free_tickets' ? 'Free tickets' : reward.type.label_en} for this event`,
                    `${reward.type.key === 'free_tickets' ? 'Billets gratuits' : typeName(reward.type)} pour cet événement`,
                  )}
            </strong>
            <div class="muted">
              {t(`${rewardCount(reward, reward.earned)} earned`, `Gagné : ${rewardCount(reward, reward.earned)}`)}
              {reward.used > 0 ? t(`, ${reward.used} requested`, `, ${reward.used} demandé${reward.used > 1 ? 's' : ''}`) : ''}
              {reward.nextIn !== null ? ` · ${forNext(reward.nextIn)}` : ''}
              {reward.available > 0
                ? t(
                    ' · Use them on this event, or save them for a later one before it is over.',
                    ' · Utilise-les pour cet événement, ou garde-les pour un prochain avant qu’il soit passé.',
                  )
                : ''}
            </div>
            {reward.nextIn !== null && (
              <Progress percent={reward.progress} label={t(`Progress to the next: ${reward.type.label_en}`, `Progression vers le prochain : ${typeName(reward.type)}`)} />
            )}
          </div>
          {/* Straight to the cart with one of them in it. */}
          {self && reward.available > 0 && <a href={`/payouts?add=${props.eventId}.${reward.type.key}#rewards`}>{t('Request →', 'Demander →')}</a>}
        </div>
      ))}

      <SalesChart
        title={t('Tickets sold per day', 'Billets vendus par jour')}
        daily={props.daily}
        percent={props.percent}
        range={props.range}
        basePath={href(e.id)}
        currency={e.currency}
        end={end}
      />

      {e.rows.length > 1 && (
        <>
          <h2>{t('By promo code', 'Par code promo')}</h2>
          <div class="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Code', 'Code')}</th>
                  <th class="num">{t('Tickets', 'Billets')}</th>
                  <th class="num">{t('Full price', 'Plein prix')}</th>
                  <th class="num">{t('Commission', 'Commission')}</th>
                </tr>
              </thead>
              <tbody>
                {e.rows.map((r, i) => (
                  <tr>
                    <td>
                      <span class="code">{r.code}</span>
                    </td>
                    <td class="num">{r.tickets_sold}</td>
                    <td class="num">{formatMoney(toCents(r.full_price), r.currency)}</td>
                    <td class="num">{formatMoney(byCode[i]!, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Footnote />
    </Layout>
  );
}

function statusLabel(p: PayoutRequest): string {
  return p.status === 'paid' ? t('Paid', 'Payé') : p.status === 'rejected' ? t('Declined', 'Refusé') : t('Requested', 'Demandé');
}

export function PayoutHistory(props: { payouts: PayoutRequest[] }) {
  if (props.payouts.length === 0) return <p class="muted">{t('No payout requests yet.', 'Aucune demande de paiement pour l’instant.')}</p>;
  return (
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('Requested', 'Demandé le')}</th>
            <th class="num">{t('Amount', 'Montant')}</th>
            <th>{t('Status', 'Statut')}</th>
            <th>{t('Notes', 'Notes')}</th>
          </tr>
        </thead>
        <tbody>
          {props.payouts.map((p) => (
            <tr>
              <td>{p.created_at.slice(0, 10)}</td>
              <td class="num">{formatMoney(p.amount_cents, p.currency)}</td>
              <td>
                <span class={`status ${p.status}`}>{statusLabel(p)}</span>
                {p.processed_at && <div class="muted">{p.processed_at.slice(0, 10)}</div>}
              </td>
              <td>
                {p.admin_note && <div>{p.admin_note}</div>}
                {p.note && (
                  <div class="muted">
                    {t('You wrote:', 'Tu as écrit :')} {p.note}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RewardHistory(props: { requests: RewardRequest[] }) {
  if (props.requests.length === 0) return <p class="muted">{t('No reward requests yet.', 'Aucune demande de récompense pour l’instant.')}</p>;
  return (
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('Requested', 'Demandé le')}</th>
            <th>{t('Reward', 'Récompense')}</th>
            <th>{t('Status', 'Statut')}</th>
            <th>{t('Notes', 'Notes')}</th>
          </tr>
        </thead>
        <tbody>
          {props.requests.map((r) => (
            <tr>
              <td>{r.created_at.slice(0, 10)}</td>
              <td>
                {describeReward(r)}
                {r.details && <div class="muted">{r.details}</div>}
              </td>
              <td>
                <span class={`status ${r.status === 'fulfilled' ? 'paid' : r.status}`}>
                  {r.status === 'fulfilled' ? t('Given', 'Remis') : r.status === 'rejected' ? t('Declined', 'Refusé') : t('Requested', 'Demandé')}
                </span>
              </td>
              <td>{r.admin_note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The name of a reward type, like "VIP ticket", and what it is, in a sentence the team wrote. */
const typeName = (x: { key: string; label_en: string; label_fr?: string }) => t(x.label_en, x.label_fr || x.label_en) || x.key;
const typeWhat = (x: { description_en?: string | null; description_fr?: string | null }) =>
  t(x.description_en ?? '', x.description_fr || x.description_en || '');

/**
 * One reward in an event's table: what it is on the left, how many are available, and "+" on the right.
 * The fields the cart sets (how many, guest list names, this event or the bank) live here, so the form
 * works without scripts too: then "How many" is a box instead of "+". Tickets are sent to the promoter;
 * only a guest list reward asks for names.
 */
function ShopRow(props: {
  field: string;
  name: string;
  what: string;
  where: string; // the event, "your bank", or '' for merch
  kind: 'event' | 'bank' | 'merch';
  available: number;
  note?: string; // like "2 more sales for the next one"
  guestList?: boolean;
  children?: unknown;
}) {
  const ready = props.available > 0;
  return (
    <tr
      class={ready ? undefined : 'locked'}
      data-shop-item
      data-name={props.where ? `${props.name} · ${props.where}` : props.name}
      data-type={props.name}
      data-where={props.where}
      data-kind={props.kind}
      data-guest-list={props.guestList ? '' : undefined}
    >
      <td>
        <div class="shop-type">{props.name}</div>
        {props.what && <div class="shop-what">{props.what}</div>}
        {props.note && <div class="muted">{props.note}</div>}
      </td>
      <td class="shop-avail">
        <span class="big">{props.available}</span>{' '}
        <span class="muted">{t('available', props.available > 1 ? 'disponibles' : 'disponible')}</span>
        {/* "· 2 in your cart", set by app.js. */}
        <span class="muted in-cart" data-in-cart data-label={t('in your cart', 'dans ton panier')} hidden></span>
      </td>
      <td class="shop-add">
        {ready ? (
          <>
            <select name={`qty.${props.field}`} data-qty class="qty-fallback" aria-label={t(`How many: ${props.name}`, `Combien : ${props.name}`)}>
              {Array.from({ length: props.available + 1 }, (_, n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
            <button type="button" class="plus" data-add hidden aria-label={t(`Add one ${props.name}${props.where ? ` for ${props.where}` : ''}`, `Ajouter : ${props.name}${props.where ? ` pour ${props.where}` : ''}`)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            </svg>
            </button>
            {/* Once one is in the cart, "+" becomes a pill: − on the left, how many, + on the right. */}
            <div class="stepper" data-stepper hidden>
              <button type="button" data-minus aria-label={t(`One less ${props.name}`, `Un de moins : ${props.name}`)}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="currentColor" d="M5 11h14v2H5z" />
                </svg>
              </button>
              <span class="stepper-n" data-count aria-live="polite">
                0
              </span>
              <button type="button" data-plus aria-label={t(`One more ${props.name}`, `Un de plus : ${props.name}`)}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
                </svg>
              </button>
            </div>
            {props.guestList && (
              <input name={`guests.${props.field}`} value="" maxlength={200} placeholder={t('Names on the guest list', 'Noms sur la liste d’invités')} aria-label={t(`Names on the guest list: ${props.name}`, `Noms sur la liste d’invités : ${props.name}`)} data-guests-field />
            )}
            {props.children as never}
          </>
        ) : (
          <button type="button" class="plus" disabled aria-label={t(`None available: ${props.name}`, `Aucun disponible : ${props.name}`)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Payouts & rewards: a shop, by event. Each event lists its rewards (free tickets, VIP, GA list…) with
 * how many are available and "+" to add one to the cart; the bank and merch come the same way. The cart
 * holds the rest: how many, the names for a guest list, and this event or the bank.
 */
function RewardsShop(props: { rewards: Rewards; ticketEvents: TicketEvent[]; promoter: string; ok?: string }) {
  const { tickets, merch, bank } = props.rewards;
  const rules = rewardRules();
  const showMerch = trackOn(rules.merch) || merch.earned > 0;
  if (tickets.length === 0 && bank.length === 0 && !showMerch) return null;
  // Events in date order, each with its rewards.
  const events = new Map<number, { event: TicketReward['event']; rows: TicketReward[] }>();
  // An event not on sale yet only shows once it has something to ask for.
  const shown = tickets.filter((t) => !t.event.draft || tickets.some((o) => o.event.id === t.event.id && o.available > 0));
  for (const t of shown) events.set(t.event.id, { event: t.event, rows: [...(events.get(t.event.id)?.rows ?? []), t] });
  const byDate = [...events.values()].sort((a, b) => (a.event.start?.getTime() ?? Infinity) - (b.event.start?.getTime() ?? Infinity));
  return (
    <section id="rewards">
      <h2>{t('Rewards shop', 'Boutique de récompenses')}</h2>
      <Flash ok={props.ok} />
      <p class="muted">
        {t(
          'What your sales earned, event by event. Press + to add one to your cart, then review and send it: the team confirms each item. Rewards for an event are lost once it is over: ask for them before then, or save them for a later event.',
          'Ce que tes ventes t’ont rapporté, événement par événement. Appuie sur + pour en ajouter une à ton panier, puis vérifie et envoie : l’équipe confirme chaque item. Les récompenses d’un événement sont perdues une fois qu’il est passé : demande-les avant, ou garde-les pour un prochain événement.',
        )}
      </p>
      <form class="shop" method="post" action="/rewards/order" data-shop data-promoter={props.promoter}>
        <div class="shop-events">
          {bank.length > 0 && (
            <div class="card shop-event-card bank-card">
              <h3 class="first">{t('Saved for later', 'Mis de côté')}</h3>
              <p class="muted">{t('Kept until you use them, on any upcoming event. Their type stays.', 'Gardées jusqu’à ce que tu les utilises, pour n’importe quel événement à venir. Leur type reste le même.')}</p>
              <table class="shop-table">
                <tbody>
                  {bank.map((b) => (
                    <ShopRow
                      field={`bank.${b.type.key}`}
                      name={typeName(b.type)}
                      what={typeWhat(b.type)}
                      where={t('saved for later', 'mis de côté')}
                      kind="bank"
                      guestList={!!b.type.guest_list}
                      available={props.ticketEvents.length > 0 ? b.balance : 0}
                      note={
                        b.pending > 0
                          ? t(`${b.pending} more waiting for approval`, `Encore ${b.pending} en attente d’approbation`)
                          : props.ticketEvents.length === 0
                            ? t('No upcoming event to use them for yet', 'Aucun événement à venir où les utiliser pour l’instant')
                            : undefined
                      }
                    >
                      <select name={`event.bank.${b.type.key}`} data-event-field hidden aria-label={t('For which event', 'Pour quel événement')}>
                        {props.ticketEvents.map((e) => (
                          <option value={String(e.id)}>{e.title}</option>
                        ))}
                      </select>
                    </ShopRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {byDate.map(({ event, rows }) => (
            <div class={`card shop-event-card${event.hasCover ? ' with-cover' : ''}`}>
              <div class="shop-event-head">
                {/* The event's colours: its cover, blurred, behind the header. */}
                {event.hasCover && <img class="shop-event-backdrop" src={`/event-image/${event.id}`} alt="" loading="lazy" />}
                {event.hasCover && <img class="cover-thumb" src={`/event-image/${event.id}`} alt="" loading="lazy" />}
                <div>
                  <h3 class="first">{event.title}</h3>
                  <p class="muted">{eventDate(event)}</p>
                </div>
              </div>
              <table class="shop-table">
                <tbody>
                  {rows.map((r) => (
                    <ShopRow
                      field={`${r.event.id}.${r.type.key}`}
                      name={typeName(r.type)}
                      what={typeWhat(r.type)}
                      where={r.event.title}
                      kind="event"
                      guestList={!!r.type.guest_list}
                      available={r.available}
                      note={
                        r.available === 0 && r.used > 0
                          ? t(`All ${r.used} requested`, r.used > 1 ? `Les ${r.used} sont demandés` : 'Déjà demandé')
                          : r.nextIn !== null
                            ? forNext(r.nextIn)
                            : undefined
                      }
                    >
                      <input type="hidden" name={`for.${r.event.id}.${r.type.key}`} value="" data-use-field />
                    </ShopRow>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {showMerch && (
            <div class="card shop-event-card">
              <h3 class="first">{t('Merch', 'Merch')}</h3>
              <p class="muted">{describeTrack(rules.merch, 'merch')}</p>
              <table class="shop-table">
                <tbody>
                  <ShopRow
                    field="merch"
                    name={merch.readyLabel || 'Merch'}
                    what=""
                    where=""
                    kind="merch"
                    available={merch.available}
                    note={
                      merch.available === 0
                        ? merch.nextIn !== null
                          ? unlocksIn(merch.nextLabel || 'Merch', merch.nextIn)
                          : t('All merch unlocked', 'Tout le merch est débloqué')
                        : undefined
                    }
                  >
                    <input type="hidden" name="merch.details" value={merch.readyLabel ? `${merch.readyLabel}, ` : ''} data-merch-field />
                  </ShopRow>
                </tbody>
              </table>
            </div>
          )}
        </div>
        <button type="button" class="cart-jump" data-cart-jump hidden>
          {t('View cart', 'Voir le panier')}
        </button>
        <div class="cart-backdrop" data-cart-backdrop hidden></div>
        <div class="card cart" id="cart" data-cart role="region" aria-label={t('Your cart', 'Ton panier')}>
          <div class="cart-head">
            <h3>{t('Your cart', 'Ton panier')}</h3>
            <button type="button" class="cart-close" data-cart-close aria-label={t('Close the cart', 'Fermer le panier')}>
              ×
            </button>
          </div>
          <div class="cart-lines" data-cart-lines>
            <p class="muted">{t('Press + next to a reward to add it here.', 'Appuie sur + à côté d’une récompense pour l’ajouter ici.')}</p>
          </div>
          <button type="submit" formaction="/rewards/checkout" data-cart-send>
            {t('Review my request →', 'Vérifier ma demande →')}
          </button>
          <p class="muted">{t('Nothing is sent yet: you check everything on the next screen.', 'Rien n’est envoyé pour l’instant : tu vérifies tout à l’écran suivant.')}</p>
        </div>
      </form>
    </section>
  );
}

export function PayoutsPage(props: {
  user: User;
  balances: Balance[];
  payouts: PayoutRequest[];
  rewards: Rewards;
  ticketEvents: TicketEvent[];
  rewardRequests: RewardRequest[];
  adjustments: Adjustment[];
  error?: string;
  ok?: string;
  rewardOk?: string; // shown in the rewards shop, where a reward request lands
}) {
  return (
    <Layout title={t('Payouts & rewards', 'Paiements et récompenses')} user={props.user}>
      <h1>{t('Payouts & rewards', 'Paiements et récompenses')}</h1>
      <p class="muted">{t('Request your commission and rewards, and follow what the team has sent you.', 'Demande ta commission et tes récompenses, et suis ce que l’équipe t’a envoyé.')}</p>
      <Flash error={props.error} ok={props.ok} />

      {props.balances.length === 0 && <div class="card muted">{t('No commission earned yet.', 'Aucune commission gagnée pour l’instant.')}</div>}
      {props.balances.map((b) => {
        const open = props.payouts.some((p) => p.status === 'pending' && p.currency === b.currency);
        return (
          <div class="two-col payout-block">
            <div class="card">
              <h2 class="first">
                {t('Balance', 'Solde')}
                {props.balances.length > 1 ? ` (${b.currency})` : ''}
              </h2>
              <table class="balance">
                <tbody>
                  <tr>
                    <td>{t('Commission from sales', 'Commission sur les ventes')}</td>
                    <td class="num">{formatMoney(b.fromSales, b.currency)}</td>
                  </tr>
                  {b.fromTeam !== 0 && (
                    <tr>
                      <td>{t("Team commission, on your team's sales", 'Commission d’équipe, sur les ventes de ton équipe')}</td>
                      <td class="num">+{formatMoney(b.fromTeam, b.currency)}</td>
                    </tr>
                  )}
                  {b.added !== 0 && (
                    <tr>
                      <td>{b.added > 0 ? t('Added by the team', 'Ajouté par l’équipe') : t('Removed by the team', 'Retiré par l’équipe')}</td>
                      <td class="num">
                        {b.added > 0 ? '+' : '−'}
                        {formatMoney(Math.abs(b.added), b.currency)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>{t('Already paid to you', 'Déjà payé')}</td>
                    <td class="num">{b.paidOut > 0 ? '−' : ''}{formatMoney(b.paidOut, b.currency)}</td>
                  </tr>
                  <tr>
                    <td>{t('Requested, not paid yet', 'Demandé, pas encore payé')}</td>
                    <td class="num">{b.pending > 0 ? '−' : ''}{formatMoney(b.pending, b.currency)}</td>
                  </tr>
                  <tr class="total">
                    <td>{t('Available to request', 'Disponible à demander')}</td>
                    <td class="num">{formatMoney(b.available, b.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card payout-request" id={b === props.balances[0] ? 'request' : undefined}>
              <h2 class="first">{t('Request a payout', 'Demander un paiement')}</h2>
              {open ? (
                <p class="muted">
                  {t(
                    'Your payout request is waiting for approval. You can ask again once it is approved or declined.',
                    'Ta demande de paiement est en attente d’approbation. Tu pourras redemander une fois qu’elle sera approuvée ou refusée.',
                  )}
                </p>
              ) : b.available <= 0 ? (
                <p class="muted">{t('Nothing to request right now.', 'Rien à demander pour l’instant.')}</p>
              ) : (
                <div class="stack">
                  <p>
                    {t(`${formatMoney(b.available, b.currency)} available.`, `${formatMoney(b.available, b.currency)} de disponible.`)}{' '}
                    <span class="muted">{t('Ask for it with your rewards, in one request.', 'Demande-le avec tes récompenses, dans une seule demande.')}</span>
                  </p>
                  <a class="button" href="/rewards/checkout">
                    {t('Request my payout →', 'Demander mon paiement →')}
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <RewardsShop rewards={props.rewards} ticketEvents={props.ticketEvents} promoter={props.user.name} ok={props.rewardOk} />

      {props.adjustments.length > 0 && (
        <>
          <h2>{t('From the team', 'De l’équipe')}</h2>
          <div class="card table-wrap">
            <table>
              <tbody>
                {props.adjustments.map((a) => (
                  <tr>
                    <td>{a.created_at.slice(0, 10)}</td>
                    <td>
                      <strong>{describeAdjustment(a, formatMoney)}</strong>
                    </td>
                    <td>
                      {a.label}
                      {a.kind === 'free_tickets' && a.event_id && (
                        <div class="muted">{props.rewards.tickets.find((t) => t.event.id === a.event_id)?.event.title ?? ''}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>{t('Payout history', 'Historique des paiements')}</h2>
      <PayoutHistory payouts={props.payouts} />
      <h2>{t('Reward history', 'Historique des récompenses')}</h2>
      <RewardHistory requests={props.rewardRequests} />
    </Layout>
  );
}

export { parseRange, RewardHistory };

/** One line of a cart, in plain words, for checkout. */
export type CartLine = {
  field?: string; // the cart key ("1.vip_tickets", "bank.free_tickets", "merch"): its count is qty.<field>
  max?: number; // how many can be asked for
  quantity: number;
  type?: { key: string; label_en: string; label_fr?: string; description_en?: string | null; description_fr?: string | null };
  event?: { title: string; start?: Date | null; timezone?: string | null; dates?: number };
  toBank?: boolean;
  fromBank?: boolean;
  who?: string;
  merch?: string;
};

/** The payout part of checkout: what can be asked, and the fields as typed or as last time. */
export type PayoutForm = { currency: string; available: number; cashAvailable: number; method: string; amount: string; details: string; note: string };

/**
 * Checkout, the one place where anything is asked for: the payout (ticked when there is money to ask
 * for) and every reward with how many, each spelled out (the kind, the event, who it is for), the team's
 * notice, then Send. Nothing is sent before.
 */
export function CheckoutPage(props: {
  user: User;
  lines: CartLine[];
  fields: [string, string][]; // the cart's other choices (which event, guest names…), carried as is
  notice: string;
  error?: string;
  payout?: PayoutForm;
  includePayout: boolean;
  waiting?: string; // a payout already waiting for the team, like "$40.00"
  left?: boolean; // some rewards are picked in the shop (guest list names, merch, saved rewards)
}) {
  const p = props.payout;
  const nothing = !p && props.lines.length === 0;
  return (
    <Layout title={t('Your request', 'Ta demande')} user={props.user}>
      <p class="muted">
        <a href="/payouts">{t('Payouts & rewards', 'Paiements et récompenses')}</a> / {t('Your request', 'Ta demande')}
      </p>
      <h1>{t('Your request', 'Ta demande')}</h1>
      <p class="muted">
        {t(
          'Your payout and your rewards, all in one request. Change what you need, then send: nothing goes out before.',
          'Ton paiement et tes récompenses, dans une seule demande. Change ce qu’il faut, puis envoie : rien ne part avant.',
        )}
      </p>
      <Flash error={props.error} />
      {nothing ? (
        <div class="card muted">
          {props.waiting
            ? t(`Your payout of ${props.waiting} is waiting for approval, and no reward is ready to ask for.`, `Ton paiement de ${props.waiting} est en attente d’approbation, et aucune récompense n’est prête à demander.`)
            : t('Nothing to ask for right now.', 'Rien à demander pour l’instant.')}{' '}
          <a href="/payouts#rewards">{t('See the rewards shop →', 'Voir la boutique de récompenses →')}</a>
        </div>
      ) : (
        <form class="checkout-confirm" method="post" action="/rewards/order">
          {props.fields.map(([name, value]) => (
            <input type="hidden" name={name} value={value} />
          ))}

          <h2>{t('Money', 'Argent')}</h2>
          {p ? (
            <div class="card checkout-payout" data-payout-form>
              <input type="hidden" name="currency" value={p.currency} />
              <label class="check checkout-include">
                <input type="checkbox" name="payout" value="1" checked={props.includePayout} />
                <span>
                  <strong>{t('Request my payout', 'Demander mon paiement')}</strong>{' '}
                  <span class="muted">{t(`up to ${formatMoney(p.available, p.currency)}`, `jusqu’à ${formatMoney(p.available, p.currency)}`)}</span>
                </span>
              </label>
              <div class="payout-fields">
                <label>
                  {t('Amount', 'Montant')} ({p.currency})
                  <input
                    name="amount"
                    inputmode="decimal"
                    value={p.amount}
                    data-available={(p.available / 100).toFixed(2)}
                    data-cash-available={(p.cashAvailable / 100).toFixed(2)}
                  />
                </label>
                <label>
                  {t('How should we pay you?', 'Comment veux-tu être payé?')}
                  <select name="method" data-cash-method={config.cashMethod}>
                    {config.payoutMethods.map((m) => (
                      <option value={m} selected={m === p.method}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                {config.cashOffered && (
                  <p class="muted">
                    {p.cashAvailable > 0
                      ? t(
                          `Cash is paid in steps of ${formatMoney(config.cashStepCents, p.currency)}: up to ${formatMoney(p.cashAvailable, p.currency)} in cash.`,
                          `L’argent comptant est payé par tranches de ${formatMoney(config.cashStepCents, p.currency)} : jusqu’à ${formatMoney(p.cashAvailable, p.currency)} en argent comptant.`,
                        )
                      : t(
                          `Cash needs at least ${formatMoney(config.cashStepCents, p.currency)} available.`,
                          `Pour l’argent comptant, il faut au moins ${formatMoney(config.cashStepCents, p.currency)} de disponible.`,
                        )}
                  </p>
                )}
                <label>
                  {t(
                    `Send to (your e-Transfer email${config.cashOffered ? '; not needed for cash' : ''})`,
                    `Envoyer à (ton courriel pour le virement Interac${config.cashOffered ? '; pas nécessaire pour l’argent comptant' : ''})`,
                  )}
                  <input name="details" value={p.details} maxlength={200} />
                </label>
                <label>
                  {t('Note for the team (optional)', 'Note pour l’équipe (facultatif)')}
                  <textarea name="note" maxlength={500}>
                    {p.note}
                  </textarea>
                </label>
              </div>
            </div>
          ) : (
            <p class="muted">
              {props.waiting
                ? t(`Your payout of ${props.waiting} is waiting for approval. You can ask again once it is approved or declined.`, `Ton paiement de ${props.waiting} est en attente d’approbation. Tu pourras redemander une fois qu’il sera approuvé ou refusé.`)
                : t('No money to ask for right now.', 'Pas d’argent à demander pour l’instant.')}
            </p>
          )}

          <h2>{t('Rewards', 'Récompenses')}</h2>
          {props.lines.length === 0 && <p class="muted">{t('No reward ready to ask for.', 'Aucune récompense prête à demander.')}</p>}
          <div class="checkout-lines">
            {props.lines.map((l) => (
              <div class="card checkout-line">
                {l.field && l.max ? (
                  // The shop's − n + pill, drawn by app.js over this list (which works without scripts).
                  <div class="checkout-qty" data-checkout-qty>
                    <select
                      name={`qty.${l.field}`}
                      aria-label={t(`How many: ${l.merch !== undefined ? 'Merch' : l.type ? typeName(l.type) : ''}`, `Combien : ${l.merch !== undefined ? 'Merch' : l.type ? typeName(l.type) : ''}`)}
                    >
                      {Array.from({ length: l.max + 1 }, (_, n) => (
                        <option value={String(n)} selected={n === l.quantity}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div class="checkout-qty">{l.quantity} ×</div>
                )}
                <div class="checkout-body">
                  <div class="checkout-type">{l.merch !== undefined ? t('Merch', 'Merch') : l.type ? typeName(l.type) : ''}</div>
                  {l.type && typeWhat(l.type) && <p class="shop-what">{typeWhat(l.type)}</p>}
                  <dl class="checkout-facts">
                    {l.merch !== undefined ? (
                      <>
                        <dt>{t('What', 'Quoi')}</dt>
                        <dd>{l.merch || '—'}</dd>
                      </>
                    ) : l.toBank ? (
                      <>
                        <dt>{t('Goes to', 'Va dans')}</dt>
                        <dd>
                          <strong>{t('Saved for later', 'Mis de côté')}</strong>
                          {t(
                            `, from ${l.event?.title}. The team confirms it; then they wait for any later event, still ${l.type?.label_en}.`,
                            `, de ${l.event?.title}. L’équipe confirme; ensuite, ils t’attendent pour n’importe quel prochain événement, toujours en ${l.type ? typeName(l.type) : ''}.`,
                          )}
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt>{t('Event', 'Événement')}</dt>
                        <dd>
                          <strong>{l.event?.title}</strong>
                          {l.event?.start ? ` · ${formatDate(l.event.start, l.event.timezone ?? null)}` : ''}
                          {l.fromBank ? t(' · saved earlier', ' · mis de côté avant') : ''}
                        </dd>
                        <dt>{t('For', 'Pour')}</dt>
                        <dd class="who-strong">{l.who}</dd>
                      </>
                    )}
                  </dl>
                </div>
              </div>
            ))}
          </div>
          <p class="muted">
            {props.left
              ? t('Guest list spots, merch and saved rewards are picked in the shop: ', 'Les places sur la liste d’invités, le merch et les récompenses mises de côté se choisissent dans la boutique : ')
              : ''}
            <a href="/payouts#rewards">{t('add rewards from the shop →', 'ajouter des récompenses dans la boutique →')}</a>
          </p>

          {props.notice && props.lines.length > 0 && (
            <>
              <Banner text={props.notice} label={t('A note from the team', 'Une note de l’équipe')} />
              <label class="check">
                <input type="checkbox" name="ack" value="1" data-ack /> {t('I have read the note above', 'J’ai lu la note ci-dessus')}
              </label>
            </>
          )}
          <div class="checkout-actions">
            <button type="submit">{t('Send my request', 'Envoyer ma demande')}</button>
            <a href="/payouts">{t('Cancel', 'Annuler')}</a>
          </div>
        </form>
      )}
    </Layout>
  );
}

