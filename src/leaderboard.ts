import { rangeBounds, today, type Range } from './chart';
import { dailyForCodes, statsForCodes, type DailySales } from './hievents';
import { adjustmentsByDay, hasAdjustments, moneyAdjustments, moneyAdjustmentsBetween, outsideTickets } from './adjustments';
import { codesFor, commissionPercentFor, listUsers, type User } from './local-db';
import { commissionCents, toCents, totalsByCurrency } from './money';
import { balances, countPendingPayouts } from './payouts';
import { countPendingRewards, levelFor, type Level } from './rewards';
import { hadTeam, teamCommission } from './teams';

export type Entry = {
  user: User;
  tickets: number;
  fullPrice: number; // cents
  commission: number; // cents, in the period
  owed: number; // cents, all time: earned − paid − requested
  lastSale: string | null; // YYYY-MM-DD
  level: Level;
  totalSold: number;
};

export type Sort = 'tickets' | 'sales' | 'commission';

export type Leaderboard = {
  entries: Entry[];
  // For the chart: commission is already worked out per promoter (rates differ), so full_price holds
  // the commission and the chart is drawn at 100%.
  daily: DailySales[];
  currency: string;
  totals: { tickets: number; fullPrice: number; commission: number; owed: number; pending: number };
};

/** Every promoter's numbers for the period (or only these promoters'), best first. Money is in the main currency (CAD-only setups). */
export async function leaderboard(range: Range, sort: Sort, users: User[] = listUsers()): Promise<Leaderboard> {
  const entries: Entry[] = [];
  const daily = new Map<string, { tickets: number; commission: number }>();
  let currency = 'CAD';
  for (const user of users) {
    const codes = codesFor(user.id);
    // Promoters with only sales entered by hand (events outside Hi.Events) are ranked too.
    if (codes.length === 0 && !hasAdjustments(user.id)) continue;
    const percent = commissionPercentFor(user);
    const [rows, days] = await Promise.all([statsForCodes(codes), dailyForCodes(codes)]);
    const totals = totalsByCurrency(rows, percent);
    currency = totals[0]?.currency ?? currency;
    const totalSold = totals.reduce((sum, t) => sum + t.tickets, 0);
    const allSold = totalSold + outsideTickets(user.id);
    const { from, to } = rangeBounds(range, days, today());
    const inRange = range === 'all' ? days : days.filter((d) => d.day >= from && d.day <= to);
    let tickets = 0;
    let fullPrice = 0;
    let commission = 0;
    for (const d of inRange) {
      const c = commissionCents(d.full_price, percent);
      tickets += d.tickets;
      fullPrice += toCents(d.full_price);
      commission += c;
      const slot = daily.get(d.day) ?? { tickets: 0, commission: 0 };
      slot.tickets += d.tickets;
      slot.commission += c;
      daily.set(d.day, slot);
    }
    // All time comes from the totals so it matches the promoter's own dashboard to the cent.
    if (range === 'all') {
      tickets = totalSold;
      fullPrice = totals.reduce((sum, t) => sum + t.fullPrice, 0);
      commission = totals.reduce((sum, t) => sum + t.commission, 0);
    }
    // Hand-entered sales and money also go on the chart, on the day they were entered.
    for (const a of adjustmentsByDay(user.id)) {
      if (range !== 'all' && (a.day < from || a.day > to)) continue;
      const slot = daily.get(a.day) ?? { tickets: 0, commission: 0 };
      slot.tickets += a.tickets;
      slot.commission += a.cents;
      daily.set(a.day, slot);
    }
    // Admin entries: sales outside Hi.Events and money added count too (by the day they were entered).
    tickets += range === 'all' ? outsideTickets(user.id) : outsideTickets(user.id, from, to);
    commission += range === 'all' ? [...moneyAdjustments(user.id).values()].reduce((a, b) => a + b, 0) : moneyAdjustmentsBetween(user.id, from, to);
    const team = hadTeam(user.id) ? await teamCommission(user) : [];
    const owed = balances(user.id, totals, team).reduce((sum, b) => sum + b.available + b.pending, 0);
    entries.push({
      user,
      tickets,
      fullPrice,
      commission,
      owed,
      lastSale: days.at(-1)?.day ?? null,
      level: levelFor(allSold).level,
      totalSold: allSold,
    });
  }
  const key = { tickets: (e: Entry) => e.tickets, sales: (e: Entry) => e.fullPrice, commission: (e: Entry) => e.commission }[sort];
  entries.sort((a, b) => key(b) - key(a) || b.totalSold - a.totalSold);
  return {
    entries,
    daily: [...daily]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, currency, tickets: v.tickets, full_price: (v.commission / 100).toFixed(2) })),
    currency,
    totals: {
      tickets: entries.reduce((s, e) => s + e.tickets, 0),
      fullPrice: entries.reduce((s, e) => s + e.fullPrice, 0),
      commission: entries.reduce((s, e) => s + e.commission, 0),
      owed: entries.reduce((s, e) => s + e.owed, 0),
      pending: countPendingPayouts() + countPendingRewards(),
    },
  };
}
