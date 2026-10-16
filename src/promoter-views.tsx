import { parseRange, SalesChart, type Range } from './chart';
import { config } from './config';
import type { CodeStats, DailySales } from './hievents';
import type { User } from './local-db';
import { commissionCents, formatMoney, formatPercent, toCents, totalsByCurrency, type Totals } from './money';
import { cashAvailable, type Balance, type PayoutRequest } from './payouts';
import { describeReward, levelFor, type RewardRequest, type Rewards } from './rewards';
import { describeTrack, rewardRules, trackOn } from './reward-rules';
import { describeAdjustment, type Adjustment } from './adjustments';
import { Avatar, Flash, formatDate, Layout, LevelBadge } from './views';
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
};

// The stats query returns one row per code and event; pages work per event.
export function summarizeEvents(rows: CodeStats[], percent: number): EventSummary[] {
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
    };
    e.codes.push(r.code);
    e.rows.push(r);
    e.tickets += r.tickets_sold;
    e.pending += r.tickets_pending;
    e.orders += r.orders;
    e.fullPrice += toCents(r.full_price);
    e.paid += toCents(r.paid);
    e.commission += commissionCents(r.full_price, percent);
    events.set(r.event_id, e);
  }
  // Chronological, oldest first; pages re-sort as they need.
  return [...events.values()].sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
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
      Commission is based on the full ticket price, before your promo code's discount, without taxes and fees, minus
      refunds. Tickets awaiting payment count once they are paid. Refunded and cancelled tickets are not counted.
    </p>
  );
}

function SummaryCards(props: {
  totals: Totals[];
  balances: Balance[];
  outsideSold: number;
  percent: number;
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
              Commission earned ({formatPercent(props.percent)})
              {b && b.added !== 0 && <> · incl. {b.added > 0 ? '+' : '−'}{formatMoney(Math.abs(b.added), cur)} from the team</>}
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
            {freeTickets > 0 ? `${plural(freeTickets, 'free ticket')} ready to request` : `Free tickets for each event: ${lowerFirst(describeTrack(rules.tickets, 'ticket'))}`}
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

function EventCard(props: { event: EventSummary; href: string; freeTickets?: number; link?: string | null; copyCodes?: boolean }) {
  const e = props.event;
  return (
    <div class="card event-card">
    <a class="event-card-main" href={props.href}>
      <span class="event-main">
      {e.hasCover && <img class="cover-thumb" src={`/event-image/${e.id}`} alt="" loading="lazy" />}
      <span class="event">
        <strong>{e.title}</strong>
        <span class="muted">{eventDate(e)}</span>
        <span>
          {e.codes.map((c) => (
            <span class="code">{c}</span>
          ))}
          {!!props.freeTickets && <span class="chip">{plural(props.freeTickets, 'free ticket')} ready</span>}
        </span>
      </span>
      </span>
      <span class="numbers">
        <span>
          <span class="big">{e.tickets}</span>
          <span class="muted">
            {e.tickets === 1 ? 'ticket' : 'tickets'}
            {e.pending > 0 && <span class="pending"> +{e.pending} pending</span>}
          </span>
        </span>
        <span>
          <span class="big">{formatMoney(e.commission, e.currency)}</span>
          <span class="muted">commission</span>
        </span>
      </span>
    </a>
    {(props.link || props.copyCodes) && (
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
      </div>
    )}
    </div>
  );
}

export function DashboardPage(props: {
  viewer: User;
  promoter: User;
  basePath: string; // '' for the promoter, '/admin/promoters/:id/view' when an admin looks
  codes: string[];
  rows: CodeStats[];
  daily: DailySales[];
  balances: Balance[];
  rewards: Rewards;
  percent: number;
  range: Range;
}) {
  const events = summarizeEvents(props.rows, props.percent);
  const freeFor = (e: EventSummary) => props.rewards.tickets.find((t) => t.event.id === e.id)?.available ?? 0;
  const upcoming = events.filter((e) => !isPast(e));
  const past = events.filter(isPast).reverse();
  const totals = totalsByCurrency(props.rows, props.percent);
  const self = props.basePath === '';
  const eventHref = (e: EventSummary) => `${props.basePath}/events/${e.id}`;

  return (
    <Layout title="My sales" user={props.viewer}>
      {!self && (
        <p class="muted">
          <a href="/admin">Promoters</a> / <a href={`/admin/promoters/${props.promoter.id}`}>{props.promoter.name}</a> /
          Their dashboard
        </p>
      )}
      <div class="who">
        <Avatar user={props.promoter} />
        <h1>{self ? `Hi ${props.promoter.name}` : `${props.promoter.name}'s dashboard`}</h1>
      </div>
      <p class="muted">Live from the ticketing system.</p>

      {props.codes.length === 0 && props.balances.length === 0 && props.rewards.outsideSold === 0 ? (
        <div class="card muted">No promo codes are assigned to this account yet.</div>
      ) : (
        <>
          {self && <PayoutCallout balances={props.balances} rewards={props.rewards} />}
          <SummaryCards
            totals={totals}
            balances={props.balances}
            outsideSold={props.rewards.outsideSold}
            percent={props.percent}
            payoutsHref={self ? '/payouts' : undefined}
          />
          <LevelCard rewards={props.rewards} rewardsHref={self ? '/payouts#rewards' : undefined} />
          {props.codes.length > 0 && <CodesCard codes={props.codes} rows={props.rows} upcoming={upcoming} />}
          <SalesChart
            title="Tickets sold per day"
            daily={props.daily}
            percent={props.percent}
            range={props.range}
            basePath={props.basePath || '/'}
            currency={totals[0]?.currency ?? 'CAD'}
          />

          <h2>Upcoming events</h2>
          {upcoming.length === 0 ? (
            <p class="muted">No upcoming events with your codes.</p>
          ) : (
            <div class="rows">
              {upcoming.map((e) => (
                <EventCard
                  event={e}
                  href={eventHref(e)}
                  freeTickets={freeFor(e)}
                  link={shareLink(props.promoter, { id: e.id, title: e.title }, e.codes[0]!)}
                  copyCodes
                />
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <h2>Past events</h2>
              <div class="rows">
                {past.map((e) => (
                  <EventCard event={e} href={eventHref(e)} />
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
  percent: number;
  range: Range;
}) {
  const events = summarizeEvents(props.rows, props.percent);
  const index = events.findIndex((e) => e.id === props.eventId);
  const reward = props.rewards.tickets.find((t) => t.event.id === props.eventId);
  const self = props.basePath === '';
  const e = events[index];
  const previous = events[index - 1];
  const next = events[index + 1];
  const href = (id: number) => `${props.basePath}/events/${id}`;
  // Sales stop when the event is over, so a past event's chart ends on its last date.
  const end = isPast(e) && e.end ? new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone ?? 'UTC' }).format(e.end) : undefined;

  return (
    <Layout title={e.title} user={props.viewer}>
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

      <div class="grid">
        <div class="card stat highlight">
          <div class="value">{formatMoney(e.commission, e.currency)}</div>
          <div class="label">Commission ({formatPercent(props.percent)})</div>
        </div>
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

      {reward && (
        <div class="card reward-card">
          <div>
            <strong>
              {reward.available > 0 ? `${plural(reward.available, 'free ticket')} ready for this event` : 'Free tickets for this event'}
            </strong>
            <div class="muted">
              {plural(reward.earned, 'free ticket')} earned{reward.used > 0 ? `, ${reward.used} requested` : ''}
              {reward.nextIn !== null ? ` · ${plural(reward.nextIn, 'more sale')} for the next one` : ''}
            </div>
            {reward.nextIn !== null && <Progress percent={reward.progress} label="Progress to the next free ticket" />}
          </div>
          {self && reward.available > 0 && <a href="/payouts#rewards">Request →</a>}
        </div>
      )}

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
                {e.rows.map((r) => (
                  <tr>
                    <td>
                      <span class="code">{r.code}</span>
                    </td>
                    <td class="num">{r.tickets_sold}</td>
                    <td class="num">{formatMoney(toCents(r.full_price), r.currency)}</td>
                    <td class="num">{formatMoney(commissionCents(r.full_price, props.percent), r.currency)}</td>
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

function RewardsSection(props: { rewards: Rewards }) {
  const { tickets, merch } = props.rewards;
  const rules = rewardRules();
  const showTickets = trackOn(rules.tickets) || tickets.some((t) => t.earned > 0);
  const showMerch = trackOn(rules.merch) || merch.earned > 0;
  if (!showTickets && !showMerch) return null;
  return (
    <section id="rewards">
      <h2>Rewards</h2>
      <div class="two-col">
        {showTickets && (
          <div class="card">
            <h3>Free tickets</h3>
            <p class="muted">For each event: {lowerFirst(describeTrack(rules.tickets, 'ticket'))}</p>
            {tickets.length === 0 ? (
              <p class="muted">No upcoming events with your codes.</p>
            ) : (
              <div class="reward-list">
                {tickets.map((t) => (
                  <div class="reward-row">
                    <div>
                      <strong>{t.event.title}</strong>
                      <div class="muted">
                        {plural(t.event.tickets, 'sale')} · {plural(t.earned, 'free ticket')} earned
                        {t.bonus !== 0 ? ` (${t.bonus > 0 ? '+' : ''}${t.bonus} from the team)` : ''}
                        {t.used > 0 ? `, ${t.used} requested` : ''}
                        {t.nextIn !== null ? ` · next in ${plural(t.nextIn, 'sale')}` : ''}
                      </div>
                    </div>
                    {t.available > 0 && (
                      <form class="reward-form" method="post" action="/rewards/ticket">
                        <input type="hidden" name="event_id" value={String(t.event.id)} />
                        <select name="quantity" aria-label="How many">
                          {Array.from({ length: t.available }, (_, i) => (
                            <option value={String(i + 1)}>{plural(i + 1, 'ticket')}</option>
                          ))}
                        </select>
                        <input name="details" placeholder="Name for the guest list (optional)" maxlength={120} />
                        <button type="submit">Request</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {showMerch && (
          <div class="card">
            <h3>Merch</h3>
            <p class="muted">{describeTrack(rules.merch, 'merch')}</p>
            {merch.nextIn !== null && <Progress percent={merch.progress} label="Progress to the next merch item" />}
            <p class="muted">
              {plural(merch.earned, 'item')} unlocked{merch.bonus !== 0 ? ` (${merch.bonus > 0 ? '+' : ''}${merch.bonus} from the team)` : ''}
              {merch.used > 0 ? `, ${merch.used} requested` : ''}
              {merch.nextIn !== null ? ` · ${merch.nextLabel ? `${merch.nextLabel} in` : 'next in'} ${plural(merch.nextIn, 'ticket')}` : ''}
            </p>
            {merch.available > 0 ? (
              <form class="stack" method="post" action="/rewards/merch">
                <label>
                  {merch.readyLabel ? `Your ${merch.readyLabel}: which size or option?` : 'What would you like? (item and size)'}
                  <input
                    name="details"
                    placeholder={merch.readyLabel ? `${merch.readyLabel}, size L` : 'T-shirt, size L'}
                    value={merch.readyLabel ? `${merch.readyLabel}, ` : undefined}
                    maxlength={120}
                    required
                  />
                </label>
                <button type="submit">Request merch</button>
              </form>
            ) : (
              <p class="muted">{merch.nextIn !== null ? 'Keep selling to unlock it.' : 'All merch unlocked.'}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function PayoutsPage(props: {
  user: User;
  balances: Balance[];
  payouts: PayoutRequest[];
  rewards: Rewards;
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
                        (props.user.payout_method === config.cashMethod ? cashAvailable(b) : b.available) / 100
                      ).toFixed(2)}
                      data-available={(b.available / 100).toFixed(2)}
                      data-cash-available={(cashAvailable(b) / 100).toFixed(2)}
                      required
                    />
                  </label>
                  <p class="muted">
                    {cashAvailable(b) > 0
                      ? `Cash is paid in steps of ${formatMoney(config.cashStepCents, b.currency)}: up to ${formatMoney(cashAvailable(b), b.currency)} in cash.`
                      : `Cash needs at least ${formatMoney(config.cashStepCents, b.currency)} available.`}
                  </p>
                  <label>
                    Send to (your e-Transfer email; not needed for cash)
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

      <RewardsSection rewards={props.rewards} />

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
