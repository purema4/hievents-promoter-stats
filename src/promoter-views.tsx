import { MiniChart, parseRange, recentTickets, SalesChart, type Range } from './chart';
import { config } from './config';
import type { CodeStats, DailySales, TicketEvent } from './hievents';
import type { User } from './local-db';
import { eventBonus, eventCommission, formatMoney, splitCommission, toCents, totalsByCurrency, type Rate, type Totals } from './money';
import { cashAvailable, type Balance, type PayoutRequest } from './payouts';
import { describeReward, levelFor, type RewardRequest, type Rewards, type TicketReward } from './rewards';
import { describeTrack, rewardRules, trackOn } from './reward-rules';
import { describeAdjustment, type Adjustment } from './adjustments';
import { Avatar, Banner, Flash, formatDate, Layout, LevelBadge } from './views';
import { avatarOf } from './avatars';
import { eventLink } from './links';
import { linkClicks, shareLink } from './short-links';

export type EventSummary = {
  id: number;
  title: string;
  start: Date | null;
  end: Date | null;
  dates: number;
  timezone: string | null;
  hasCover: boolean;
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
export function rewardCount(t: TicketReward, n: number): string {
  return t.type.key === 'free_tickets' ? plural(n, 'free ticket') : `${n} ${t.type.label_en}`;
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

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Footnote() {
  return (
    <p class="muted">
      Commission is set by the team for each event. Sales count at the full ticket price, before your promo code's
      discount, without taxes and fees, minus refunds. Tickets awaiting payment count once they are paid. Refunded and
      cancelled tickets are not counted.
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
              Commission earned
              {b && b.added !== 0 && <> · incl. {b.added > 0 ? '+' : '−'}{formatMoney(Math.abs(b.added), cur)} from the team</>}
              {b && b.fromTeam !== 0 && <> · incl. {formatMoney(b.fromTeam, cur)} team commission</>}
              {b && b.bonus !== 0 && <> · incl. {formatMoney(b.bonus, cur)} bonus</>}
            </div>
          </div>
        );
      })}
      {props.balances.map((b) => (
        <div class="card stat">
          <div class="value">{formatMoney(b.available, b.currency)}</div>
          <div class="label">
            Available to request
            {props.payoutsHref && b.available > 0 && (
              <>
                {' · '}
                <a href={props.payoutsHref}>Request payout</a>
              </>
            )}
          </div>
        </div>
      ))}
      {props.totals.map((t) => (
        <div class="card stat">
          <div class="value">{formatMoney(t.fullPrice, t.currency)}</div>
          <div class="label">Ticket sales at full price</div>
        </div>
      ))}
      <div class="card stat">
        <div class="value">{props.totals.reduce((sum, t) => sum + t.tickets, 0) + props.outsideSold}</div>
        <div class="label">
          Tickets sold, {plural(props.totals.reduce((sum, t) => sum + t.orders, 0), 'order')}
          {props.outsideSold !== 0 && <> · incl. {props.outsideSold} outside Hi.Events</>}
          {props.totals.some((t) => t.pending > 0) && (
            <span class="pending"> · {props.totals.reduce((sum, t) => sum + t.pending, 0)} awaiting payment</span>
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
        <strong>Add your profile photo</strong>
        <div class="muted">It shows on your public page and to the team. Upload one, or add your Instagram to use its photo.</div>
      </div>
      <a class="button" href="/account">
        Add my photo
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
        <strong>Add your city</strong>
        <div class="muted">So the team knows where you promote. Only the team sees it.</div>
      </div>
      <a class="button" href="/account#city">
        Add my city
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
            <div class="payout-callout-label">Ready to request</div>
            <div class="payout-callout-amount">{ready.map((b) => formatMoney(b.available, b.currency)).join(' + ')}</div>
          </>
        ) : waiting.length === 0 ? (
          <div class="payout-callout-label">{plural(rewardsReady, 'reward')} ready to request</div>
        ) : null}
        {waiting.length > 0 && (
          <div class={ready.length ? 'muted' : 'payout-callout-label'}>
            {waiting.map((b) => formatMoney(b.pending, b.currency)).join(' + ')} requested, waiting for the team
          </div>
        )}
      </div>
      <div class="payout-callout-actions">
        {ready.length > 0 && (
          <a class="button big" href="/payouts#request">
            Request my payout
          </a>
        )}
        {rewardsReady > 0 && (
          <a class={`button big${ready.length ? ' secondary' : ''}`} href="/payouts#rewards">
            Claim {plural(rewardsReady, 'reward')}
          </a>
        )}
        {ready.length === 0 && rewardsReady === 0 && (
          <a class="button secondary" href="/payouts">
            See my payouts
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

function LevelCard(props: { rewards: Rewards; rewardsHref?: string }) {
  const { totalSold, merch } = props.rewards;
  const rules = rewardRules();
  const { level, next, progress } = levelFor(totalSold);
  const freeTickets = props.rewards.tickets.reduce((sum, t) => sum + t.available, 0);
  const onlyPlain = props.rewards.tickets.every((t) => t.type.key === 'free_tickets');
  return (
    <div class="card level-card">
      <div class="level-head">
        <LevelBadge level={level} />
        <span class="muted">{plural(totalSold, 'ticket')} sold in total</span>
      </div>
      <Progress percent={progress} label={next ? `Progress to ${next.name}` : 'Top level reached'} />
      <p class="muted level-next">{next ? `${next.at - totalSold} more to reach ${next.name}` : `Top level: ${level.name}. Legendary.`}</p>
      <ul class="unlocks">
        {(trackOn(rules.tickets) || freeTickets > 0) && (
          <li class={freeTickets > 0 ? 'ready' : ''}>
            {freeTickets > 0 ? `${plural(freeTickets, onlyPlain ? 'free ticket' : 'reward')} ready to request` : `Free tickets for each event: ${lowerFirst(describeTrack(rules.tickets, 'ticket'))}`}
          </li>
        )}
        {(trackOn(rules.merch) || merch.available > 0) && (
          <li class={merch.available > 0 ? 'ready' : ''}>
            {merch.available > 0
              ? `${merch.readyLabel || 'Merch'} unlocked: request it now`
              : merch.nextIn !== null
                ? `${merch.nextLabel || 'Merch'} unlocks in ${plural(merch.nextIn, 'more ticket')}`
                : 'All merch unlocked'}
          </li>
        )}
      </ul>
      {props.rewardsHref && (freeTickets > 0 || merch.available > 0) && (
        <a href={props.rewardsHref}>Request your rewards →</a>
      )}
    </div>
  );
}

export function LinkField(props: { link: string; label: string }) {
  return (
    <div class="link-field">
      <input readonly value={props.link} aria-label={props.label} />
      <button type="button" data-copy>
        Copy link
      </button>
      <button type="button" class="secondary" data-share data-share-title={props.label} hidden>
        Share
      </button>
    </div>
  );
}

/** On the dashboard: the link to the promoter's public page, ready to copy or share. */
function PageCard(props: { link: string }) {
  return (
    <div class="card page-card">
      <div>
        <h2 class="first">Your page</h2>
        <p class="muted">All your upcoming events in one link, with your code in each. Made for your Instagram bio.</p>
      </div>
      <LinkField link={props.link} label="My page" />
      <a href="/page">Open it, get the QR code →</a>
    </div>
  );
}

/** A promo code as a button that copies it. */
export function CodeCopy(props: { code: string }) {
  return (
    <button type="button" class="secondary small code-copy" data-copy-text={props.code} title="Copy the promo code">
      <span class="code-value">{props.code}</span>
      <span class="code-action">Copy</span>
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
      <h2 class="first">{props.codes.length > 1 ? 'Your promo codes' : 'Your promo code'}</h2>
      <p class="muted">Customers enter it at checkout and the sale counts for you. Your links already include it.</p>
      <div class="code-list">
        {props.codes.map((code) => {
          const events = eventsFor(code);
          return (
            <div class="code-item">
              <CodeCopy code={spelled.get(code) ?? code} />
              <span class="muted">
                {!spelled.has(code)
                  ? 'Not in the ticketing system yet'
                  : events.length
                    ? events.map((e) => e.title).join(', ')
                    : 'No upcoming events'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The event's media drive (photos, videos, flyers), set by admins on Promoters → Media drives.
function MediaButton(props: { url: string }) {
  return (
    <a class="button secondary small" href={props.url} target="_blank" rel="noopener noreferrer">
      Media drive
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
  return (
    <div class="card event-card">
      {props.banner && <Banner text={props.banner} label={`Notice for ${e.title}`} />}
      <a class="event-card-main" href={props.href}>
        <span class="event-main">
          {e.hasCover && <img class="cover-thumb" src={`/event-image/${e.id}`} alt="" loading="lazy" />}
          <span class="event">
            <strong>{e.title}</strong>
            <span class="muted">{eventDate(e)}</span>
            <span>
              {!props.copyCodes && e.codes.map((c) => <span class="code">{c}</span>)}
              {!!props.ready && <span class="chip">{props.ready} ready</span>}
            </span>
          </span>
        </span>
        <span class="event-stats">
          <span class="primary">
            <span class="big">{e.tickets}</span>
            <span class="muted">
              {e.tickets === 1 ? 'ticket sold' : 'tickets sold'}
              {e.pending > 0 && <span class="pending"> +{e.pending} pending</span>}
            </span>
          </span>
          <span>
            <span class="big">{formatMoney(e.commission, e.currency)}</span>
            <span class="muted">commission{e.bonus > 0 && ` + ${formatMoney(e.bonus, e.currency)} bonus`}</span>
          </span>
          {props.daily && (
            <span>
              <span class="big">{recentTickets(props.daily, '7')}</span>
              <span class="muted">last 7 days</span>
            </span>
          )}
        </span>
        {props.daily && <MiniChart daily={props.daily} />}
      </a>
      {(props.link || props.copyCodes || props.media) && (
        <div class="card-actions">
          {props.link && (
            <button type="button" class="secondary small" data-copy-text={props.link}>
              Copy my link
            </button>
          )}
          {props.copyCodes && e.codes.map((code) => <CodeCopy code={code} />)}
          {props.link && (
            <button type="button" class="secondary small" data-share data-share-url={props.link} data-share-title={e.title} hidden>
              Share
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
}) {
  const events = summarizeEvents(props.rows, props.percent);
  const upcoming = events.filter((e) => !isPast(e));
  const past = events.filter(isPast).reverse();
  const totals = totalsByCurrency(props.rows, props.percent);
  const self = props.basePath === '';
  const eventHref = (e: EventSummary) => `${props.basePath}/events/${e.id}`;


  return (
    <Layout title="My sales" user={props.viewer} promoterView>
      {!self &&
        (props.basePath.startsWith('/team/') ? (
          <p class="muted">
            <a href="/team">My team</a> / {props.promoter.name}
          </p>
        ) : (
          <p class="muted">
            <a href="/admin">Promoters</a> / <a href={`/admin/promoters/${props.promoter.id}`}>{props.promoter.name}</a> /
            Their dashboard
          </p>
        ))}
      <div class="who">
        <Avatar user={props.promoter} />
        <h1>{self ? `Hi ${props.promoter.name}` : `${props.promoter.name}'s dashboard`}</h1>
      </div>
      <p class="muted">Live from the ticketing system.</p>

      {props.codes.length === 0 && props.balances.length === 0 && props.rewards.outsideSold === 0 ? (
        <>
          {self && <PhotoCallout promoter={props.promoter} />}
          {self && <CityCallout promoter={props.promoter} />}
          <div class="card muted">No promo codes are assigned to this account yet.</div>
        </>
      ) : (
        <>
          <h2>Upcoming events</h2>
          {upcoming.length === 0 ? (
            <p class="muted">No upcoming events with your codes.</p>
          ) : (
            <div class="event-grid">
              {upcoming.map((e) => (
                <EventCard
                  event={e}
                  href={eventHref(e)}
                  ready={readyOn(props.rewards, e.id)}
                  link={shareLink(props.promoter, { id: e.id, title: e.title }, e.codes[0]!)}
                  copyCodes
                  media={props.media.get(e.id)}
                  banner={props.banners.get(e.id)}
                  daily={props.daily.filter((d) => d.event_id === e.id)}
                />
              ))}
            </div>
          )}

          <h2>My totals</h2>
          {self && <PhotoCallout promoter={props.promoter} />}
          {self && <CityCallout promoter={props.promoter} />}
          {self && <PayoutCallout balances={props.balances} rewards={props.rewards} />}
          <SummaryCards
            totals={totals}
            balances={props.balances}
            outsideSold={props.rewards.outsideSold}
            payoutsHref={self ? '/payouts' : undefined}
          />
          <LevelCard rewards={props.rewards} rewardsHref={self ? '/payouts#rewards' : undefined} />
          {self && props.pageLink && <PageCard link={props.pageLink} />}
          {props.codes.length > 0 && <CodesCard codes={props.codes} rows={props.rows} upcoming={upcoming} />}

          {past.length > 0 && (
            <>
              <h2>Past events</h2>
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
        <a href={props.basePath || '/'}>All events</a>
        <span class="prev-next">
          {previous ? <a href={href(previous.id)}>← {previous.title}</a> : <span />}
          {next ? <a href={href(next.id)}>{next.title} →</a> : <span />}
        </span>
      </nav>
      {e.hasCover && <img class="cover-hero" src={`/event-image/${e.id}`} alt="" />}
      <h1>{e.title}</h1>
      <p class="muted">
        {eventDate(e)}
        {isPast(e) ? ' · Past event' : ''}
      </p>
      {props.banner && !isPast(e) && <Banner text={props.banner} label={`Notice for ${e.title}`} />}

      <div class="grid">
        <div class="card stat highlight">
          <div class="value">{formatMoney(e.commission, e.currency)}</div>
          <div class="label">Commission</div>
        </div>
        {e.bonus > 0 && (
          <div class="card stat highlight">
            <div class="value">{formatMoney(e.bonus, e.currency)}</div>
            <div class="label">Bonus</div>
          </div>
        )}
        <div class="card stat">
          <div class="value">{e.tickets}</div>
          <div class="label">
            Tickets sold, {plural(e.orders, 'order')}
            {e.pending > 0 && <span class="pending"> · {e.pending} awaiting payment</span>}
          </div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(e.fullPrice, e.currency)}</div>
          <div class="label">Ticket sales at full price</div>
        </div>
        <div class="card stat">
          <div class="value">{formatMoney(e.paid, e.currency)}</div>
          <div class="label">Paid by customers after discounts</div>
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
        <h2 class="first">{e.codes.length > 1 ? 'Your links and codes' : 'Your link and code'}</h2>
        {eventLink({ id: e.id, title: e.title }, e.codes[0]!, props.promoter.alias) ? (
          <>
            <p class="muted">Share it: the promo code is applied automatically and the sale counts for you.</p>
            {e.codes.map((code) => {
              const clicks = linkClicks(props.promoter, { id: e.id, title: e.title }, code);
              return (
                <div class="link-row">
                  <div class="link-code">
                    <span class="muted">Promo code</span>
                    <CodeCopy code={code} />
                  </div>
                  <LinkField link={shareLink(props.promoter, { id: e.id, title: e.title }, code)!} label={`${e.title} (${code})`} />
                  {clicks !== null && <span class="muted link-clicks">{plural(clicks, 'click')} on this link</span>}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <p class="muted">Links will show here once the team sets up the ticketing site address. Until then, share your code:</p>
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
            <strong>Media drive</strong>
            <div class="muted">Photos, videos and flyers for this event, ready to post.</div>
          </div>
          <a class="button" href={props.media} target="_blank" rel="noopener noreferrer">
            Open →
          </a>
        </div>
      )}

      {rewardsHere.map((reward) => (
        <div class="card reward-card">
          <div>
            <strong>
              {reward.available > 0
                ? `${rewardCount(reward, reward.available)} ready for this event`
                : `${reward.type.key === 'free_tickets' ? 'Free tickets' : reward.type.label_en} for this event`}
            </strong>
            <div class="muted">
              {rewardCount(reward, reward.earned)} earned{reward.used > 0 ? `, ${reward.used} requested` : ''}
              {reward.nextIn !== null ? ` · ${plural(reward.nextIn, 'more sale')} for the next one` : ''}
              {reward.available > 0 ? ' · Use them here or put them in your bank before this one is over.' : ''}
            </div>
            {reward.nextIn !== null && <Progress percent={reward.progress} label={`Progress to the next: ${reward.type.label_en}`} />}
          </div>
          {self && reward.available > 0 && <a href="/payouts#rewards">Request →</a>}
        </div>
      ))}

      <SalesChart
        title="Tickets sold per day"
        daily={props.daily}
        percent={props.percent}
        range={props.range}
        basePath={href(e.id)}
        currency={e.currency}
        end={end}
      />

      {e.rows.length > 1 && (
        <>
          <h2>By promo code</h2>
          <div class="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th class="num">Tickets</th>
                  <th class="num">Full price</th>
                  <th class="num">Commission</th>
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
  return p.status === 'paid' ? 'Paid' : p.status === 'rejected' ? 'Declined' : 'Requested';
}

export function PayoutHistory(props: { payouts: PayoutRequest[] }) {
  if (props.payouts.length === 0) return <p class="muted">No payout requests yet.</p>;
  return (
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Requested</th>
            <th class="num">Amount</th>
            <th>Status</th>
            <th>Notes</th>
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
                {p.note && <div class="muted">You wrote: {p.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RewardHistory(props: { requests: RewardRequest[] }) {
  if (props.requests.length === 0) return <p class="muted">No reward requests yet.</p>;
  return (
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Requested</th>
            <th>Reward</th>
            <th>Status</th>
            <th>Notes</th>
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
                  {r.status === 'fulfilled' ? 'Given' : r.status === 'rejected' ? 'Declined' : 'Requested'}
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

/** One reward in the shop: what it is, how many are ready, and how many to add to the cart. */
function ShopItem(props: { t: TicketReward; ticketEvents: TicketEvent[] }) {
  const { t } = props;
  const key = `${t.event.id}.${t.type.key}`;
  const name = t.type.key === 'free_tickets' ? 'Free tickets' : t.type.label_en;
  const ready = t.available > 0;
  return (
    <div class={`card shop-item${ready ? '' : ' locked'}`} data-shop-item data-name={`${name} · ${t.event.title}`}>
      <div class="shop-item-head">
        <span class="chip">{name}</span>
        <span class="shop-count">
          <span class="big">{t.available}</span> <span class="muted">ready</span>
        </span>
      </div>
      <div>
        <strong>{t.event.title}</strong>
        <div class="muted">{eventDate(t.event)}</div>
      </div>
      {ready ? (
        <>
          <label>
            How many
            <select name={`qty.${key}`} data-qty>
              {Array.from({ length: t.available + 1 }, (_, n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name={`me.${key}`} value="1" checked /> One of them is for me
          </label>
          <label>
            Guest names <span class="muted">(optional, for the extras)</span>
            <input name={`guests.${key}`} maxlength={100} placeholder="Ana, Ben" />
          </label>
          <label>
            Use them for
            <select name={`for.${key}`}>
              <option value="">{t.event.title}</option>
              <option value="bank">My bank, for a later event</option>
            </select>
          </label>
          <button type="button" class="secondary small" data-add hidden>
            Add to cart
          </button>
        </>
      ) : (
        <p class="muted">{t.used > 0 ? `All ${t.used} requested.` : 'None ready yet.'}</p>
      )}
      {t.nextIn !== null && (
        <>
          <Progress percent={t.progress} label={`Progress to the next: ${name}`} />
          <p class="muted">{plural(t.nextIn, 'more sale')} for the next one</p>
        </>
      )}
    </div>
  );
}

/**
 * Payouts & rewards: a shop. Every reward that can be requested is a card (free tickets, VIP, GA list…
 * per event, and merch); the promoter adds them to a cart and sends it in one request. Without scripts
 * the "How many" boxes are the cart.
 */
/** Rewards in the bank: their type stays; they are asked for an upcoming event of the promoter's choice. */
function BankItem(props: { b: Rewards['bank'][number]; ticketEvents: TicketEvent[] }) {
  const { b } = props;
  const key = `bank.${b.type.key}`;
  const name = b.type.key === 'free_tickets' ? 'Free tickets' : b.type.label_en;
  const ready = b.balance > 0 && props.ticketEvents.length > 0;
  return (
    <div class={`card shop-item bank-item${ready ? '' : ' locked'}`} data-shop-item data-name={`${name} · from my bank`}>
      <div class="shop-item-head">
        <span class="chip">{name}</span>
        <span class="shop-count">
          <span class="big">{b.balance}</span> <span class="muted">in the bank</span>
        </span>
      </div>
      <div>
        <strong>Your bank</strong>
        <div class="muted">
          Kept until you use them, on any upcoming event.
          {b.pending > 0 && ` ${b.pending} more waiting for the team to bank.`}
        </div>
      </div>
      {ready ? (
        <>
          <label>
            For which event
            <select name={`event.${key}`}>
              {props.ticketEvents.map((e) => (
                <option value={String(e.id)}>{e.title}</option>
              ))}
            </select>
          </label>
          <label>
            How many
            <select name={`qty.${key}`} data-qty>
              {Array.from({ length: b.balance + 1 }, (_, n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name={`me.${key}`} value="1" checked /> One of them is for me
          </label>
          <label>
            Guest names <span class="muted">(optional, for the extras)</span>
            <input name={`guests.${key}`} maxlength={100} placeholder="Ana, Ben" />
          </label>
          <button type="button" class="secondary small" data-add hidden>
            Add to cart
          </button>
        </>
      ) : (
        <p class="muted">{b.balance > 0 ? 'No upcoming event to use them for yet.' : 'Nothing in the bank yet.'}</p>
      )}
    </div>
  );
}

function RewardsShop(props: { rewards: Rewards; ticketEvents: TicketEvent[] }) {
  const { tickets, merch, bank } = props.rewards;
  const rules = rewardRules();
  const showMerch = trackOn(rules.merch) || merch.earned > 0;
  if (tickets.length === 0 && bank.length === 0 && !showMerch) return null;
  const order = [...tickets].sort((a, b) => Number(b.available > 0) - Number(a.available > 0));
  return (
    <section id="rewards">
      <h2>Rewards shop</h2>
      <p class="muted">
        What your sales earned. Add what you want to your cart and send it: the team confirms each item. Rewards for an
        event are lost once it is over: ask for them, or put them in your bank before then. Banked rewards keep their type
        and wait for any later event.
      </p>
      <form class="shop" method="post" action="/rewards/order" data-shop>
        <div class="shop-grid">
          {bank.map((b) => (
            <BankItem b={b} ticketEvents={props.ticketEvents} />
          ))}
          {order.map((t) => (
            <ShopItem t={t} ticketEvents={props.ticketEvents} />
          ))}
          {showMerch && (
            <div class={`card shop-item${merch.available > 0 ? '' : ' locked'}`} data-shop-item data-name={merch.readyLabel || 'Merch'}>
              <div class="shop-item-head">
                <span class="chip">Merch</span>
                <span class="shop-count">
                  <span class="big">{merch.available}</span> <span class="muted">ready</span>
                </span>
              </div>
              <div>
                <strong>{merch.readyLabel || 'Merch'}</strong>
                <div class="muted">{describeTrack(rules.merch, 'merch')}</div>
              </div>
              {merch.available > 0 ? (
                <>
                  <label>
                    How many
                    <select name="qty.merch" data-qty>
                      {Array.from({ length: merch.available + 1 }, (_, n) => (
                        <option value={String(n)}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {merch.readyLabel ? 'Size or option' : 'Which item and size'}
                    <input
                      name="merch.details"
                      maxlength={120}
                      placeholder={merch.readyLabel ? `${merch.readyLabel}, size L` : 'T-shirt, size L'}
                      value={merch.readyLabel ? `${merch.readyLabel}, ` : undefined}
                    />
                  </label>
                  <button type="button" class="secondary small" data-add hidden>
                    Add to cart
                  </button>
                </>
              ) : (
                <p class="muted">{merch.nextIn !== null ? `${merch.nextLabel || 'Merch'} unlocks in ${plural(merch.nextIn, 'more ticket')}.` : 'All merch unlocked.'}</p>
              )}
              {merch.nextIn !== null && <Progress percent={merch.progress} label="Progress to the next merch item" />}
            </div>
          )}
        </div>
        <div class="card cart" data-cart>
          <h3>Your cart</h3>
          <ul class="cart-lines" data-cart-lines>
            <li class="muted">Pick how many of a reward you want, then send your request.</li>
          </ul>
          <button type="submit" data-cart-send>
            Request my rewards
          </button>
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
}) {
  return (
    <Layout title="Payouts & rewards" user={props.user}>
      <h1>Payouts &amp; rewards</h1>
      <p class="muted">Request your commission and rewards, and follow what the team has sent you.</p>
      <Flash error={props.error} ok={props.ok} />

      {props.balances.length === 0 && <div class="card muted">No commission earned yet.</div>}
      {props.balances.map((b) => {
        const open = props.payouts.some((p) => p.status === 'pending' && p.currency === b.currency);
        return (
          <div class="two-col payout-block">
            <div class="card">
              <h2 class="first">Balance{props.balances.length > 1 ? ` (${b.currency})` : ''}</h2>
              <table class="balance">
                <tbody>
                  <tr>
                    <td>Commission from sales</td>
                    <td class="num">{formatMoney(b.fromSales, b.currency)}</td>
                  </tr>
                  {b.fromTeam !== 0 && (
                    <tr>
                      <td>Team commission, on your team's sales</td>
                      <td class="num">+{formatMoney(b.fromTeam, b.currency)}</td>
                    </tr>
                  )}
                  {b.added !== 0 && (
                    <tr>
                      <td>{b.added > 0 ? 'Added by the team' : 'Removed by the team'}</td>
                      <td class="num">
                        {b.added > 0 ? '+' : '−'}
                        {formatMoney(Math.abs(b.added), b.currency)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Already paid to you</td>
                    <td class="num">{b.paidOut > 0 ? '−' : ''}{formatMoney(b.paidOut, b.currency)}</td>
                  </tr>
                  <tr>
                    <td>Requested, not paid yet</td>
                    <td class="num">{b.pending > 0 ? '−' : ''}{formatMoney(b.pending, b.currency)}</td>
                  </tr>
                  <tr class="total">
                    <td>Available to request</td>
                    <td class="num">{formatMoney(b.available, b.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card payout-request" id={b === props.balances[0] ? 'request' : undefined}>
              <h2 class="first">Request a payout</h2>
              {open ? (
                <p class="muted">You have a request waiting. You can ask again once the team has handled it.</p>
              ) : b.available <= 0 ? (
                <p class="muted">Nothing to request right now.</p>
              ) : (
                <form class="stack" method="post" action="/payouts" data-payout-form>
                  <input type="hidden" name="currency" value={b.currency} />
                  <label>
                    How should we pay you?
                    <select name="method" required data-cash-method={config.cashMethod}>
                      {config.payoutMethods.map((m) => (
                        <option value={m} selected={m === (props.user.payout_method ?? config.payoutMethods[0])}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Amount ({b.currency}, up to {formatMoney(b.available, b.currency)})
                    <input
                      name="amount"
                      inputmode="decimal"
                      value={(
                        (config.cashOffered && props.user.payout_method === config.cashMethod ? cashAvailable(b) : b.available) / 100
                      ).toFixed(2)}
                      data-available={(b.available / 100).toFixed(2)}
                      data-cash-available={(cashAvailable(b) / 100).toFixed(2)}
                      required
                    />
                  </label>
                  {config.cashOffered && (
                    <p class="muted">
                      {cashAvailable(b) > 0
                        ? `Cash is paid in steps of ${formatMoney(config.cashStepCents, b.currency)}: up to ${formatMoney(cashAvailable(b), b.currency)} in cash.`
                        : `Cash needs at least ${formatMoney(config.cashStepCents, b.currency)} available.`}
                    </p>
                  )}
                  <label>
                    Send to (your e-Transfer email{config.cashOffered ? '; not needed for cash' : ''})
                    <input name="details" value={props.user.payout_details ?? props.user.email} maxlength={200} />
                  </label>
                  <label>
                    Note for the team (optional)
                    <textarea name="note" maxlength={500} />
                  </label>
                  <button type="submit">Request payout</button>
                </form>
              )}
            </div>
          </div>
        );
      })}

      <RewardsShop rewards={props.rewards} ticketEvents={props.ticketEvents} />

      {props.adjustments.length > 0 && (
        <>
          <h2>From the team</h2>
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

      <h2>Payout history</h2>
      <PayoutHistory payouts={props.payouts} />
      <h2>Reward history</h2>
      <RewardHistory requests={props.rewardRequests} />
    </Layout>
  );
}

export { parseRange, RewardHistory };
