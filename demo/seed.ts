import sharp from 'sharp';
import { addItem, saveDirectorySettings } from '../src/directory';
import { addAdjustment } from '../src/adjustments';
import { promoterData } from '../src/actions';
import { saveUploadedAvatar } from '../src/avatars';
import { updateBrand } from '../src/brand';
import { today } from '../src/chart';
import { setEventRule } from '../src/commission';
import { config } from '../src/config';
import { createInvite } from '../src/invites';
import { defaultTemplate, ensureAliases, saveLinkSettings } from '../src/links';
import { createUser, db, findUser, findUserByEmail, markAppInstalled, markOnboarded, normalizeCodes, setCodes, updateProfile, type User } from '../src/local-db';
import { setEventBanner, setGeneralBanner } from '../src/banners';
import { setMediaDrive } from '../src/media-drives';
import { checkAllMilestones } from '../src/milestones';
import { notify } from '../src/notifications';
import { requestPayout } from '../src/payouts';
import { setPageHidden } from '../src/promoter-page';
import { requestReward } from '../src/rewards';
import { assignTeam, setTeamCommission, setTeamLead } from '../src/teams';
import { addOrders, writer, type NewOrder } from './sales';

/*
 * Everything in the demo is made up here, on every start, with dates relative to today so it never
 * goes stale. The numbers are fixed (see `sold`): the same people are always one step from something
 * worth showing. Noah is 4 tickets from Platinum, for example.
 */

type Seller = {
  name: string;
  city: string;
  sold: number; // tickets kept after refunds
  lead?: number; // a team lead, with this team commission
  team?: string; // the first name of their team lead
  percent?: number;
  flat?: number; // cents per ticket
  hue: number | null; // profile photo colour; null shows initials
  joined?: 'recent';
};

const sellers: Seller[] = [
  { name: 'Maya Tremblay', city: 'Montréal, QC', sold: 142, lead: 3, percent: 12, hue: 280 },
  { name: 'Noah Gagnon', city: 'Laval, QC', sold: 96, team: 'Maya', hue: 200 },
  { name: 'Léa Roy', city: 'Longueuil, QC', sold: 61, team: 'Maya', hue: 340 },
  { name: 'Samir Haddad', city: 'Sherbrooke, QC', sold: 38, team: 'Maya', hue: 30 },
  { name: 'Chloé Nguyen', city: 'Montréal, QC', sold: 12, team: 'Maya', hue: 160, joined: 'recent' },
  { name: 'Jordan Reid', city: 'Toronto, ON', sold: 88, lead: 2, hue: 220 },
  { name: 'Priya Shah', city: 'Mississauga, ON', sold: 120, team: 'Jordan', hue: 10 },
  { name: 'Theo Martin', city: 'Hamilton, ON', sold: 47, team: 'Jordan', hue: 120 },
  { name: 'Zoé Lavoie', city: 'Ottawa, ON', sold: 23, team: 'Jordan', hue: 50, joined: 'recent' },
  { name: 'Kai Morin', city: 'Québec, QC', sold: 268, percent: 15, hue: 260 },
  { name: 'Inès Bouchard', city: 'Gatineau, QC', sold: 54, flat: 250, hue: 310 },
  { name: 'Sofia Bianchi', city: 'Trois-Rivières, QC', sold: 9, hue: null },
];

const emailOf = (name: string) => `${name.split(' ')[0]!.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}@example.com`;

/** The roles offered as one click in the bar. */
export const personas = [
  { label: 'Admin', email: 'admin@example.com' },
  { label: "Chef d'équipe", email: emailOf('Maya') },
  { label: 'Promoteur (équipe)', email: emailOf('Noah') },
  { label: 'Promoteur (solo)', email: emailOf('Kai') },
  { label: 'Nouveau promoteur', email: emailOf('Eli') },
];

// Past events first; `share` splits a promoter's tickets across the events that have sales.
const events = [
  { title: 'Neon Harvest', days: -75, price: 25, share: 0.2, cover: null },
  { title: 'Rooftop Sessions', days: -40, price: 30, share: 0.2, cover: 'rooftop.png' },
  { title: 'Cold Room 03', days: -12, price: 25, share: 0.25, cover: null },
  { title: 'Warehouse Night', days: 9, price: 30, share: 0.2, cover: 'warehouse.png' },
  { title: 'Winter Opening', days: 32, price: 40, share: 0.15, nights: 2, cover: 'winter.png' },
  { title: 'Midnight Market', days: 55, price: 35, share: 0, cover: null },
  { title: 'Secret Afterparty', days: 20, price: 20, share: 0, cover: null, draft: true },
];

// A small seeded generator: the same orders on every start.
let state = 20261104;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
const buyers = ['Ana', 'Ben', 'Cleo', 'Dani', 'Elio', 'Fay', 'Gabe', 'Hana', 'Ivan', 'Jade', 'Kim', 'Liam', 'Mia', 'Nico', 'Olive', 'Paul', 'Remy', 'Sara', 'Tom', 'Vera'];

const DAY = 86_400_000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** A moment in the weeks before an event, more likely close to it, and never in the future. */
function saleDate(eventDays: number) {
  const end = Math.min(eventDays, 0);
  return daysFromNow(end - 35 * random() ** 2 - 0.05);
}

async function wipe() {
  await writer`TRUNCATE events, event_occurrences, promo_codes, orders, order_items, images, attendees RESTART IDENTITY CASCADE`;
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'settings'").all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) db.exec(`DELETE FROM "${name}"`);
  db.exec('PRAGMA foreign_keys = ON');
  // Kept: the push keys, which the app read when it started.
  db.exec("DELETE FROM settings WHERE key <> 'vapid'");
}

async function addEvents() {
  const ids: number[] = [];
  for (const event of events) {
    const [row] = await writer<{ id: string }[]>`
      INSERT INTO events (account_id, title, timezone, status) VALUES (1, ${event.title}, 'America/Toronto', ${event.draft ? 'DRAFT' : 'LIVE'}) RETURNING id`;
    const id = Number(row!.id);
    ids.push(id);
    for (let night = 0; night < (event.nights ?? 1); night++) {
      const start = daysFromNow(event.days + night);
      start.setUTCHours(1, 0, 0, 0); // 9 pm in Toronto, near enough
      await writer`INSERT INTO event_occurrences (event_id, start_date, end_date) VALUES (${id}, ${start}, ${new Date(start.getTime() + 6 * 3_600_000)})`;
    }
    if (event.cover) {
      await writer`INSERT INTO images (entity_id, entity_type, type, path)
        VALUES (${id}, 'HiEvents\DomainObjects\EventDomainObject', 'EVENT_COVER', ${`event_cover/${event.cover}`})`;
    }
  }
  return ids;
}

/** Orders adding up to exactly `sold` kept tickets, with a few refunds, unpaid and cancelled orders on top. */
function ordersFor(seller: Seller, codeIds: number[], eventIds: number[]): NewOrder[] {
  const orders: NewOrder[] = [];
  const recent = seller.joined === 'recent';
  const shares = events.map((e, i) => (recent && i < 2 ? 0 : e.share));
  const whole = shares.reduce((a, b) => a + b, 0);
  let left = seller.sold;
  events.forEach((event, i) => {
    if (shares[i] === 0) return;
    const last = shares.slice(i + 1).every((s) => s === 0);
    let tickets = last ? left : Math.min(left, Math.round((seller.sold * shares[i]!) / whole));
    left -= tickets;
    const base = { eventId: eventIds[i]!, promoCodeId: codeIds[i]!, price: event.price };
    while (tickets > 0) {
      const size = Math.min(tickets, pick([1, 1, 2, 2, 2, 3, 4]));
      tickets -= size;
      const refund = random() < 0.05;
      orders.push({ ...base, status: 'COMPLETED', tickets: size + (refund ? 1 : 0), refunded: refund ? 1 : 0, createdAt: saleDate(event.days), name: pick(buyers) });
      if (random() < 0.04) orders.push({ ...base, status: 'CANCELLED', tickets: 2, createdAt: saleDate(event.days), name: pick(buyers) });
      if (event.days > 0 && random() < 0.06) orders.push({ ...base, status: 'AWAITING_OFFLINE_PAYMENT', tickets: 2, createdAt: daysFromNow(-random() * 3), name: pick(buyers) });
    }
  });
  return orders;
}

async function avatar(userId: number, hue: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},75%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,38%)"/>
    </linearGradient></defs>
    <rect width="256" height="256" fill="url(#g)"/>
    <circle cx="128" cy="100" r="48" fill="#fff" fill-opacity=".85"/>
    <ellipse cx="128" cy="232" rx="84" ry="72" fill="#fff" fill-opacity=".85"/>
  </svg>`;
  await saveUploadedAvatar(userId, new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()));
}

async function addPeople(eventIds: number[]) {
  const adminId = await createUser({ email: config.adminEmail!, name: 'Alex Admin', password: config.adminPassword, isAdmin: true });
  markAppInstalled(adminId);
  const now = Math.floor(Date.now() / 1000);
  const orders: NewOrder[] = [];
  const ids = new Map<string, number>();

  // Team leads first, so their promoters can join them.
  for (const seller of [...sellers].sort((a, b) => Number(!!b.lead) - Number(!!a.lead))) {
    const [first, last] = seller.name.split(' ') as [string, string];
    const email = emailOf(first);
    const id = await createUser({
      email,
      name: seller.name,
      isAdmin: false,
      commission: seller.flat ? { percent: null, flatCents: seller.flat } : seller.percent ? { percent: seller.percent, flatCents: null } : undefined,
    });
    ids.set(first, id);
    updateProfile(id, {
      first_name: first,
      last_name: last,
      phone: `514-555-01${String(ids.size).padStart(2, '0')}`,
      city: seller.city,
      instagram: `demo_${first.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}`,
      payout_method: config.payoutMethods[0]!,
      payout_details: email,
      theme: 'system',
    });
    markOnboarded(id);
    markAppInstalled(id);
    // Seen at some point this week, so the admin dashboard does not look like everyone just arrived.
    const seen = now - Math.floor(random() * 6 * 86400) - 600;
    db.query('UPDATE users SET last_login_at = ?, last_seen_at = ?, created_at = ? WHERE id = ?').run(seen, seen, dayOf(daysFromNow(-120)), id);
    if (seller.hue !== null) await avatar(id, seller.hue);

    setCodes(id, normalizeCodes(first.normalize('NFD').replace(/[^a-zA-Z]/g, '')));
    if (seller.lead) {
      setTeamLead(findUser(id)!, true);
      setTeamCommission(id, seller.lead);
    }
    if (seller.team) assignTeam(findUser(id)!, ids.get(seller.team)!);

    const code = first.normalize('NFD').replace(/[^a-zA-Z]/g, '').toUpperCase();
    const codeIds: number[] = [];
    for (const eventId of eventIds) {
      const [row] = await writer<{ id: string }[]>`INSERT INTO promo_codes (code, event_id) VALUES (${code}, ${eventId}) RETURNING id`;
      codeIds.push(Number(row!.id));
    }
    orders.push(...ordersFor(seller, codeIds, eventIds));
  }

  // Team leads earn from the day a promoter joined, so the teams need some history behind them.
  db.query('UPDATE team_memberships SET from_day = ?').run(dayOf(daysFromNow(-120)));
  db.query('UPDATE team_memberships SET from_day = ? WHERE member_id IN (?, ?)').run(dayOf(daysFromNow(-30)), ids.get('Chloé')!, ids.get('Zoé')!);

  // Signed up, welcome steps not done, nothing sold yet.
  const eli = await createUser({ email: emailOf('Eli'), name: 'Eli Fortin', isAdmin: false });
  setCodes(eli, ['eli']);
  for (const eventId of eventIds.slice(3)) await writer`INSERT INTO promo_codes (code, event_id) VALUES ('ELI', ${eventId})`;

  // Sales without a promoter, and a code nobody has yet, like a real event.
  await writer`INSERT INTO promo_codes (code, event_id) VALUES ('EARLYBIRD', ${eventIds[4]!}), ('FRIENDS', ${eventIds[3]!})`;
  for (let i = 0; i < 40; i++) {
    const n = pick([0, 1, 2, 3, 4]);
    orders.push({ eventId: eventIds[n]!, promoCodeId: null, status: 'COMPLETED', tickets: pick([1, 2]), price: events[n]!.price, createdAt: saleDate(events[n]!.days), name: pick(buyers) });
  }
  await addOrders(orders);
  return { adminId, ids, eli };
}

function pastPayout(user: User, cents: number, adminId: number, days: number, status: 'paid' | 'rejected', note: string) {
  db.query(
    `INSERT INTO payout_requests (user_id, promoter_name, promoter_email, amount_cents, currency, method, details, status, admin_note, created_at, processed_at, processed_by)
     VALUES (?, ?, ?, ?, 'CAD', ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?)`,
  ).run(user.id, user.name, user.email, cents, config.payoutMethods[0]!, user.email, status, note, `-${days} days`, `-${days - 1} days`, adminId);
}

const dollars = (cents: number) => Math.floor(cents / 500) * 500;

async function addHistory(adminId: number, ids: Map<string, number>, eventIds: number[]) {
  const admin = findUser(adminId)!;
  const person = (first: string) => findUser(ids.get(first)!)!;

  addAdjustment(admin, ids.get('Kai')!, { kind: 'money', amountCents: 5000, currency: 'CAD', label: 'Top seller bonus' });
  addAdjustment(admin, ids.get('Samir')!, { kind: 'tickets_sold', quantity: 6, amountCents: 15000, currency: 'CAD', label: 'Door sales at Cold Room 03' });
  addAdjustment(admin, ids.get('Priya')!, { kind: 'merch', quantity: 1, label: 'Thanks for the street team' });
  setEventRule(ids.get('Noah')!, eventIds[3]!, { kind: 'percent', value: 15 });
  setMediaDrive(eventIds[3]!, 'https://drive.example.com/warehouse-night', adminId);
  setMediaDrive(eventIds[4]!, 'https://drive.example.com/winter-opening', adminId);
  setGeneralBanner('Payouts for last month go out this Friday. Send your request before Thursday at noon.');
  setEventBanner(eventIds[3]!, 'Early bird tickets end Sunday. Push your link this week!', adminId);
  setEventBanner(eventIds[4]!, 'New venue: doors open at 9 pm at the Old Port.', adminId);
  setPageHidden(ids.get('Sofia')!, true, adminId);

  // Money already paid out, then requests waiting for the admin.
  for (const [first, share, days] of [['Kai', 0.5, 30], ['Priya', 0.4, 21], ['Theo', 0.5, 14]] as const) {
    const available = (await promoterData(person(first))).balances[0]?.available ?? 0;
    pastPayout(person(first), dollars(available * share), adminId, days, 'paid', `Interac ref. DEMO-${days}`);
  }
  pastPayout(person('Inès'), 2000, adminId, 8, 'rejected', 'Banking details did not match.');
  for (const first of ['Maya', 'Léa']) {
    const user = person(first);
    const balance = (await promoterData(user)).balances[0]!;
    requestPayout(user, balance, { amountCents: dollars(balance.available * 0.6), method: config.payoutMethods[0]!, details: user.email, note: '' });
  }
  const priya = await promoterData(person('Priya'));
  requestReward(person('Priya'), priya.rewards, { kind: 'merch', quantity: 1, details: 'Hoodie, size M' });
  const kai = await promoterData(person('Kai'));
  const [first, second] = kai.rewards.tickets.filter((t) => t.available > 0);
  if (first) requestReward(person('Kai'), kai.rewards, { kind: 'ticket', eventId: first.event.id, quantity: 1, details: '' });
  // A roll over for the admins to accept or decline.
  const later = kai.ticketEvents.find((e) => e.id !== first?.event.id && e.id !== second?.event.id);
  if (second && later) requestReward(person('Kai'), kai.rewards, { kind: 'ticket', eventId: second.event.id, useFor: later, quantity: 1, details: '' });

  createInvite(admin, { label: 'Spring street team', teamLeadId: null, maxUses: 20, days: 30 });
  createInvite(person('Maya'), { label: 'Maya’s crew', teamLeadId: ids.get('Maya')!, maxUses: null, days: null });

  notify(ids.get('Noah')!, { title: 'You reached Gold', body: '50 tickets sold in total. Next: Platinum at 100.', link: '/' });
  notify(ids.get('Kai')!, { title: 'Payout sent: $120.00', body: 'By Interac e-Transfer.', link: '/payouts' });
}

function dressTheApp() {
  updateBrand({ name: 'Demo Nights', accent: '#7c3aed', loginMessage: 'Demo environment: every name and number here is made up.', footer: 'Demo data' });
  saveLinkSettings('https://tickets.example.com', defaultTemplate);
  saveDirectorySettings({ title: 'Demo Nights crew', tagline: 'Pick your promoter to get your tickets with their code.', background: 'gradient', color: '#2e1065', color2: '#0f172a', newPromoters: 'show' });
  addItem('link', 'All upcoming events', 'https://tickets.example.com/events');
  addItem('heading', 'Our promoters');
}

export async function seed() {
  const started = Date.now();
  await wipe();
  const eventIds = await addEvents();
  dressTheApp();
  const { adminId, ids } = await addPeople(eventIds);
  ensureAliases();
  await addHistory(adminId, ids, eventIds);
  // Records where everyone stands, so the next sale is what triggers level and reward notifications.
  await checkAllMilestones();
  console.log(`Demo data ready in ${Date.now() - started} ms, as of ${today()}.`);
}

export const personaUsers = () =>
  personas.flatMap((p) => {
    const user = findUserByEmail(p.email);
    return user ? [{ ...p, user }] : [];
  });
