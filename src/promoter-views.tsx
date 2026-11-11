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
  // Named by what is actually ready: other types with none available don't change the words.
  const onlyPlain = props.rewards.tickets.every((t) => t.available === 0 || t.type.key === 'free_tickets');
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
            {freeTickets > 0 ? `${plural(freeTickets, onlyPlain ? 'free ticket' : 'event reward')} ready to request` : `Free tickets for each event: ${lowerFirst(describeTrack(rules.tickets, 'ticket'))}`}
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

// The event's media drive (photos, videos, flyers), set by admins on Events → Media drives.
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
              {!props.copyCodes && !e.draft && e.codes.map((c) => <span class="code">{c}</span>)}
              {e.draft && <span class="chip warn">Not on sale yet</span>}
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
                  link={e.draft ? null : shareLink(props.promoter, { id: e.id, title: e.title }, e.codes[0]!)}
                  copyCodes={!e.draft}
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
          {props.codes.length > 0 && <CodesCard codes={props.codes} rows={props.rows} upcoming={upcoming.filter((e) => !e.draft)} />}

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
        {e.draft ? (
          <p class="muted">This event is not on sale yet. Your link and code will show here once tickets are on sale.</p>
        ) : eventLink({ id: e.id, title: e.title }, e.codes[0]!, props.promoter.alias) ? (
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

/** The name of a reward type, like "VIP ticket", and what it is, in a sentence the team wrote. */
const typeName = (t: { key: string; label_en: string }) => t.label_en || t.key;
const typeWhat = (t: { description_en?: string | null }) => t.description_en ?? '';

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
        {/* "3/4 available" once some are in the cart: left out of all (set by app.js). */}
        <span class="big" data-left>
          {props.available}
        </span>
        <span class="of" data-of hidden>
          /{props.available}
        </span>{' '}
        <span class="muted">available</span>
      </td>
      <td class="shop-add">
        {ready ? (
          <>
            <select name={`qty.${props.field}`} data-qty class="qty-fallback" aria-label={`How many: ${props.name}`}>
              {Array.from({ length: props.available + 1 }, (_, n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
            <button type="button" class="plus" data-add hidden aria-label={`Add one ${props.name}${props.where ? ` for ${props.where}` : ''}`}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            </svg>
            </button>
            {/* Once one is in the cart, "+" becomes a pill: − on the left, how many, + on the right. */}
            <div class="stepper" data-stepper hidden>
              <button type="button" data-minus aria-label={`One less ${props.name}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="currentColor" d="M5 11h14v2H5z" />
                </svg>
              </button>
              <span class="stepper-n" data-count aria-live="polite">
                0
              </span>
              <button type="button" data-plus aria-label={`One more ${props.name}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
                </svg>
              </button>
            </div>
            {props.guestList && (
              <input name={`guests.${props.field}`} value="" maxlength={200} placeholder="Names on the guest list" aria-label={`Names on the guest list: ${props.name}`} data-guests-field />
            )}
            {props.children as never}
          </>
        ) : (
          <button type="button" class="plus" disabled aria-label={`None available: ${props.name}`}>
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
      <h2>Rewards shop</h2>
      <Flash ok={props.ok} />
      <p class="muted">
        What your sales earned, event by event. Press + to add one to your cart, then review and send it: the team confirms
        each item. Rewards for an event are lost once it is over: ask for them, or put them in your bank before then.
      </p>
      <form class="shop" method="post" action="/rewards/order" data-shop data-promoter={props.promoter}>
        <div class="shop-events">
          {bank.length > 0 && (
            <div class="card shop-event-card bank-card">
              <h3 class="first">Your bank</h3>
              <p class="muted">Kept until you use them, on any upcoming event. Their type stays.</p>
              <table class="shop-table">
                <tbody>
                  {bank.map((b) => (
                    <ShopRow
                      field={`bank.${b.type.key}`}
                      name={typeName(b.type)}
                      what={typeWhat(b.type)}
                      where="your bank"
                      kind="bank"
                      guestList={!!b.type.guest_list}
                      available={props.ticketEvents.length > 0 ? b.balance : 0}
                      note={b.pending > 0 ? `${b.pending} more waiting for the team to bank` : props.ticketEvents.length === 0 ? 'No upcoming event to use them for yet' : undefined}
                    >
                      <select name={`event.bank.${b.type.key}`} data-event-field hidden aria-label="For which event">
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
                  {rows.map((t) => (
                    <ShopRow
                      field={`${t.event.id}.${t.type.key}`}
                      name={typeName(t.type)}
                      what={typeWhat(t.type)}
                      where={t.event.title}
                      kind="event"
                      guestList={!!t.type.guest_list}
                      available={t.available}
                      note={t.available === 0 && t.used > 0 ? `All ${t.used} requested` : t.nextIn !== null ? `${plural(t.nextIn, 'more sale')} for the next one` : undefined}
                    >
                      <input type="hidden" name={`for.${t.event.id}.${t.type.key}`} value="" data-use-field />
                    </ShopRow>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {showMerch && (
            <div class="card shop-event-card">
              <h3 class="first">Merch</h3>
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
                    note={merch.available === 0 ? (merch.nextIn !== null ? `${merch.nextLabel || 'Merch'} unlocks in ${plural(merch.nextIn, 'more ticket')}` : 'All merch unlocked') : undefined}
                  >
                    <input type="hidden" name="merch.details" value={merch.readyLabel ? `${merch.readyLabel}, ` : ''} data-merch-field />
                  </ShopRow>
                </tbody>
              </table>
            </div>
          )}
        </div>
        <button type="button" class="cart-jump" data-cart-jump hidden>
          View cart
        </button>
        <div class="cart-backdrop" data-cart-backdrop hidden></div>
        <div class="card cart" id="cart" data-cart role="region" aria-label="Your cart">
          <div class="cart-head">
            <h3>Your cart</h3>
            <button type="button" class="cart-close" data-cart-close aria-label="Close the cart">
              ×
            </button>
          </div>
          <div class="cart-lines" data-cart-lines>
            <p class="muted">Press + next to a reward to add it here.</p>
          </div>
          <button type="submit" formaction="/rewards/checkout" data-cart-send>
            Review my request →
          </button>
          <p class="muted">Nothing is sent yet: you check everything on the next screen.</p>
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

      <RewardsShop rewards={props.rewards} ticketEvents={props.ticketEvents} promoter={props.user.name} ok={props.rewardOk} />

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

/** One line of a cart, in plain words, for checkout. */
export type CartLine = {
  quantity: number;
  type?: { key: string; label_en: string; description_en?: string | null };
  event?: { title: string; start?: Date | null; timezone?: string | null; dates?: number };
  toBank?: boolean;
  fromBank?: boolean;
  who?: string;
  merch?: string;
};

/**
 * Checkout: every line of the cart spelled out (the kind of ticket, the event, who each one is for), the
 * team's notice in a pop-up to accept, then Confirm. Nothing is sent before.
 */
export function CheckoutPage(props: { user: User; lines: CartLine[]; fields: [string, string][]; notice: string; error?: string }) {
  const total = props.lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <Layout title="Check your request" user={props.user}>
      <p class="muted">
        <a href="/payouts#rewards">Rewards shop</a> / Check your request
      </p>
      <h1>Check your request</h1>
      <p class="muted">Nothing is sent yet. Check each line: what kind of reward it is, for which event, and who it is for.</p>
      <Flash error={props.error} />
      <div class="checkout-lines">
        {props.lines.map((l) => (
          <div class="card checkout-line">
            <div class="checkout-qty">{l.quantity} ×</div>
            <div class="checkout-body">
              <div class="checkout-type">{l.merch !== undefined ? 'Merch' : (l.type?.label_en ?? '')}</div>
              {l.type?.description_en && <p class="shop-what">{l.type.description_en}</p>}
              <dl class="checkout-facts">
                {l.merch !== undefined ? (
                  <>
                    <dt>What</dt>
                    <dd>{l.merch || '—'}</dd>
                  </>
                ) : l.toBank ? (
                  <>
                    <dt>Goes to</dt>
                    <dd>
                      <strong>Your bank</strong>, from {l.event?.title}. The team confirms it; then they wait for any later
                      event, still {l.type?.label_en}.
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>Event</dt>
                    <dd>
                      <strong>{l.event?.title}</strong>
                      {l.event?.start ? ` · ${formatDate(l.event.start, l.event.timezone ?? null)}` : ''}
                      {l.fromBank ? ' · from your bank' : ''}
                    </dd>
                    <dt>For</dt>
                    <dd class="who-strong">{l.who}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        ))}
      </div>
      {props.notice && <Banner text={props.notice} label="A note from the team" />}
      <form class="checkout-confirm" method="post" action="/rewards/order">
        {props.fields.map(([name, value]) => (
          <input type="hidden" name={name} value={value} />
        ))}
        {props.notice && (
          <label class="check">
            <input type="checkbox" name="ack" value="1" required data-ack /> I have read the note from the team
          </label>
        )}
        <div class="checkout-actions">
          <button type="submit">Confirm and send {plural(total, 'reward')}</button>
          <a href="/payouts#rewards">Back to the shop</a>
        </div>
      </form>
      {props.notice && (
        <dialog class="notice-modal" data-notice-modal aria-labelledby="notice-title">
          <h2 id="notice-title">Before you send</h2>
          <p class="notice-text">{props.notice}</p>
          <button type="button" data-notice-ok>
            I understand
          </button>
        </dialog>
      )}
    </Layout>
  );
}

