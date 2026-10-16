import { config } from './config';
import type { DailySales } from './hievents';
import { commissionOn, formatMoney, type Rate } from './money';

// The CSP allows no inline styles, so bar heights and label positions use these precomputed classes.
export const chartCss = `
.chart { margin: 0; }
.chart-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.chart-head h2 { margin: 0; }
.ranges { display: flex; gap: 4px; margin-left: auto; font-size: 13px; }
.ranges a { padding: 3px 10px; border-radius: 999px; color: var(--muted); text-decoration: none; border: 1px solid transparent; }
.ranges a:hover { background: var(--bg); }
.ranges a[aria-current] { color: var(--text); border-color: var(--border); background: var(--bg); font-weight: 600; }
.plot { display: grid; grid-template-columns: auto 1fr; gap: 8px; }
.y-axis { position: relative; width: 28px; height: 180px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.y-axis span { position: absolute; right: 0; transform: translateY(50%); }
.bars { position: relative; height: 180px; display: flex; align-items: flex-end; }
.gridline { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border); }
.col { position: relative; flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; padding: 0 1px; }
.bar { width: 100%; max-width: 24px; background: var(--chart); border-radius: 4px 4px 0 0; min-height: 2px; }
.bar.h-0 { min-height: 0; }
.col:hover .bar { filter: brightness(1.15); }
.col:hover { background: color-mix(in srgb, var(--chart) 8%, transparent); }
.peak { position: absolute; left: 50%; transform: translate(-50%, -4px); font-size: 11px; font-weight: 600; color: var(--text); white-space: nowrap; }
.tip { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 2; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12px; white-space: nowrap; box-shadow: 0 4px 12px rgb(0 0 0 / 0.12); pointer-events: none; }
.tip strong { display: block; font-size: 14px; }
.tip.left { left: 0; transform: none; }
.tip.right { left: auto; right: 0; transform: none; }
.col:hover .tip { display: block; }
.x-axis { grid-column: 2; display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
.chart-empty { height: 180px; display: grid; place-items: center; color: var(--muted); font-size: 13px; border: 1px dashed var(--border); border-radius: 8px; }
details.table-view { margin-top: 12px; font-size: 13px; }
details.table-view summary { cursor: pointer; color: var(--muted); }
${Array.from({ length: 101 }, (_, i) => `.h-${i}{height:${i}%}.b-${i}{bottom:${i}%}.w-${i}{width:${i}%}`).join('')}
`;

export type Range = '7' | '30' | '90' | 'all';
export const ranges: { value: Range; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
];

export function parseRange(raw: string | undefined, fallback: Range): Range {
  return ranges.some((r) => r.value === raw) ? (raw as Range) : fallback;
}

type Bucket = { start: string; end: string; tickets: number; commission: Map<string, number> };

const dayMs = 86400000;
const toDay = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (day: string) => new Date(`${day}T00:00:00Z`);

export function today(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

/** Fills in empty days and switches to weekly bars when a period is too long to show day by day. */
function buildBuckets(daily: DailySales[], rate: Rate | number, from: string, to: string): Bucket[] {
  const spanDays = Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / dayMs) + 1;
  const step = spanDays > 120 ? 7 : 1;
  const buckets: Bucket[] = [];
  for (let t = parseDay(from).getTime(); t <= parseDay(to).getTime(); t += step * dayMs) {
    const end = Math.min(t + (step - 1) * dayMs, parseDay(to).getTime());
    buckets.push({ start: toDay(new Date(t)), end: toDay(new Date(end)), tickets: 0, commission: new Map() });
  }
  for (const d of daily) {
    const b = buckets.find((x) => d.day >= x.start && d.day <= x.end);
    if (!b) continue;
    b.tickets += d.tickets;
    b.commission.set(d.currency, (b.commission.get(d.currency) ?? 0) + commissionOn(rate, d.event_id, d.full_price, d.tickets));
  }
  return buckets;
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
}

function shortDate(day: string): string {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parseDay(day));
}

function bucketLabel(b: Bucket): string {
  return b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} – ${shortDate(b.end)}`;
}

function money(commission: Map<string, number>, fallbackCurrency: string): string {
  if (commission.size === 0) return formatMoney(0, fallbackCurrency);
  return [...commission].map(([currency, cents]) => formatMoney(cents, currency)).join(' + ');
}

/** The period a range covers, ending today; "all" starts at the first sale. */
export function rangeBounds(range: Range, daily: DailySales[], end = today()): { from: string; to: string } {
  if (range === 'all') {
    const first = daily[0]?.day ?? end;
    return { from: first < end ? first : end, to: daily.at(-1)?.day && daily.at(-1)!.day > end ? daily.at(-1)!.day : end };
  }
  return { from: toDay(new Date(parseDay(end).getTime() - (Number(range) - 1) * dayMs)), to: end };
}

export function RangeLinks(props: { current: Range; basePath: string }) {
  return (
    <nav class="ranges" aria-label="Period">
      {ranges.map((r) => (
        <a href={`${props.basePath}?range=${r.value}`} aria-current={r.value === props.current ? 'true' : undefined}>
          {r.label}
        </a>
      ))}
    </nav>
  );
}

export function SalesChart(props: {
  title: string;
  daily: DailySales[];
  percent: Rate | number;
  range: Range;
  basePath: string;
  currency: string;
  end?: string;
  ticketsOnly?: boolean; // no money shown (a promoter looking at their team)
}) {
  const { from, to } = rangeBounds(props.range, props.daily, props.end);
  const buckets = buildBuckets(props.daily, props.percent, from, to);
  const max = Math.max(0, ...buckets.map((b) => b.tickets));
  const total = buckets.reduce((sum, b) => sum + b.tickets, 0);
  // Tickets are whole numbers, so ticks never go below a step of 1.
  const step = max > 0 ? Math.max(1, niceStep(max / 4)) : 1;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const pct = (v: number) => Math.round((v / top) * 100);
  const peakIndex = buckets.findIndex((b) => b.tickets === max);
  const weekly = buckets.some((b) => b.start !== b.end);

  return (
    <figure class="chart card">
      <div class="chart-head">
        <h2>{props.title}</h2>
        <span class="muted">
          {total} {total === 1 ? 'ticket' : 'tickets'}
          {weekly ? ', per week' : ''}
        </span>
        <RangeLinks current={props.range} basePath={props.basePath} />
      </div>
      {total === 0 ? (
        <div class="chart-empty">No tickets sold in this period.</div>
      ) : (
        <>
          <div class="plot" role="img" aria-label={`${props.title}: ${total} tickets from ${shortDate(from)} to ${shortDate(to)}, peak of ${max}.`}>
            <div class="y-axis" aria-hidden="true">
              {ticks.map((t) => (
                <span class={`b-${pct(t)}`}>{t}</span>
              ))}
            </div>
            <div class="bars" aria-hidden="true">
              {ticks.map((t) => (
                <div class={`gridline b-${pct(t)}`} />
              ))}
              {buckets.map((b, i) => (
                <div class="col">
                  <div class={`bar h-${pct(b.tickets)}`} />
                  {/* The peak gets a label only when no axis tick already names its value. */}
                  {i === peakIndex && !ticks.includes(max) && <span class={`peak b-${pct(b.tickets)}`}>{b.tickets}</span>}
                  <div class={`tip ${i < buckets.length / 4 ? 'left' : i > (buckets.length * 3) / 4 ? 'right' : ''}`}>
                    <strong>
                      {b.tickets} {b.tickets === 1 ? 'ticket' : 'tickets'}
                    </strong>
                    {bucketLabel(b)}
                    {!props.ticketsOnly && ` · ${money(b.commission, props.currency)} commission`}
                  </div>
                </div>
              ))}
            </div>
            <div class="x-axis" aria-hidden="true">
              <span>{shortDate(from)}</span>
              {buckets.length > 2 && <span>{shortDate(buckets[Math.floor(buckets.length / 2)].start)}</span>}
              <span>{shortDate(to)}</span>
            </div>
          </div>
          <details class="table-view">
            <summary>Show as a table</summary>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{weekly ? 'Week' : 'Day'}</th>
                    <th class="num">Tickets</th>
                    {!props.ticketsOnly && <th class="num">Commission</th>}
                  </tr>
                </thead>
                <tbody>
                  {buckets
                    .filter((b) => b.tickets > 0)
                    .map((b) => (
                      <tr>
                        <td>{bucketLabel(b)}</td>
                        <td class="num">{b.tickets}</td>
                        {!props.ticketsOnly && <td class="num">{money(b.commission, props.currency)}</td>}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </figure>
  );
}
