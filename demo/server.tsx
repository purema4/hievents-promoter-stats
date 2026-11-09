import './guard';
import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import { announcePayoutRequest, announceRewardRequest, promoterData } from '../src/actions';
import { currentUser, endSession, startSession } from '../src/auth';
import { config } from '../src/config';
import { codesFor, findUser, listUsers, type User } from '../src/local-db';
import { checkAllMilestones } from '../src/milestones';
import { formatMoney } from '../src/money';
import { requestPayout } from '../src/payouts';
import { requestReward, rewardRequestsFor } from '../src/rewards';
import { levelFor } from '../src/reward-rules';
import app from '../src/index';
import { DemoBar } from './bar';
import { addOrders, nextEvent } from './sales';
import { personaUsers, seed } from './seed';

/*
 * The demo entry point: the unchanged app with a debug bar on top. Requests to /__demo are answered here
 * and everything else goes to the app, whose pages get the bar added on the way out. Nothing in src/
 * knows about any of it, so production has no such routes.
 */
await seed();

// One presenter at a time: the outcome of the last action, shown once, and who it was for.
let message: string | null = null;
let keepOpen = false; // the actions panel stays open between actions, not after changing roles
let target: number | null = null;

const demo = new Hono();
demo.use(csrf({ origin: config.appUrl }));

const sellers = () => listUsers().filter((u) => !u.is_admin);
const backTo = (raw: unknown) => {
  const path = String(raw ?? '/');
  return /^\/(?![/\\])/.test(path) ? path : '/';
};

async function done(c: Context, text: string) {
  message = text;
  keepOpen = true;
  const body = await c.req.parseBody();
  return c.redirect(backTo(body.back), 303);
}

async function chosen(c: Context): Promise<User | null> {
  const body = await c.req.parseBody();
  const user = findUser(Number(body.user));
  if (user) target = user.id;
  return user;
}

async function sell(user: User, tickets: number): Promise<string | null> {
  const event = await nextEvent(codesFor(user.id));
  if (!event) return null;
  const [name] = user.name.split(' ');
  await addOrders([{ eventId: event.eventId, promoCodeId: event.promoCodeId, status: 'COMPLETED', tickets, price: event.price, createdAt: new Date(), name: 'Guest' }]);
  return `${name} : +${tickets} ${tickets === 1 ? 'billet' : 'billets'} sur ${event.title}`;
}

demo.get('/__demo/bar.css', () => new Response(Bun.file(`${import.meta.dir}/bar.css`), { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' } }));

// The markup of the bar for this visitor, read from their session cookie.
demo.get('/__demo/bar', (c) => {
  const user = currentUser(c);
  const shown = message;
  const open = keepOpen;
  message = null;
  keepOpen = false;
  const people = sellers();
  const fallback = user && !user.is_admin ? user.id : (personaUsers().find((p) => !p.user.is_admin)?.user.id ?? null);
  return c.html(
    <DemoBar user={user} personas={personaUsers()} people={people} target={target ?? fallback} message={shown} open={open} back={c.req.query('back') ?? '/'} />,
  );
});

demo.post('/__demo/as', async (c) => {
  const user = findUser(Number((await c.req.parseBody()).user));
  if (!user) return c.redirect('/', 303);
  endSession(c);
  startSession(c, user.id);
  target = user.is_admin ? null : user.id;
  message = `Connecté comme ${user.name}`;
  return c.redirect('/', 303);
});

demo.post('/__demo/sale', async (c) => {
  const user = await chosen(c);
  const tickets = Math.min(50, Math.max(1, Number(c.req.query('tickets')) || 1));
  const sold = user && (await sell(user, tickets));
  if (sold) await checkAllMilestones();
  return done(c, sold ?? 'Cette personne n’a aucun code sur un événement à venir.');
});

demo.post('/__demo/level', async (c) => {
  const user = await chosen(c);
  if (!user) return done(c, 'Choisis une personne.');
  const { rewards } = await promoterData(user);
  const next = levelFor(rewards.totalSold).next;
  if (!next) return done(c, `${user.name} est déjà au niveau le plus haut.`);
  const sold = await sell(user, next.at - rewards.totalSold);
  if (!sold) return done(c, 'Cette personne n’a aucun code sur un événement à venir.');
  await checkAllMilestones();
  return done(c, `${sold}. Niveau ${next.name} atteint.`);
});

demo.post('/__demo/payout', async (c) => {
  const user = await chosen(c);
  if (!user) return done(c, 'Choisis une personne.');
  const balance = (await promoterData(user)).balances.find((b) => b.available > 0);
  if (!balance) return done(c, `${user.name} n’a rien à retirer.`);
  const input = { amountCents: Math.ceil(balance.available / 2), method: config.payoutMethods[0]!, details: user.payout_details ?? user.email, note: '' };
  const result = requestPayout(user, balance, input);
  if (result === 'already_pending') return done(c, `${user.name} a déjà une demande en attente.`);
  if (result !== 'ok') return done(c, `Demande refusée : ${result}.`);
  announcePayoutRequest(user, { ...input, currency: balance.currency });
  return done(c, `${user.name} a demandé ${formatMoney(input.amountCents, balance.currency)}.`);
});

demo.post('/__demo/reward', async (c) => {
  const user = await chosen(c);
  if (!user) return done(c, 'Choisis une personne.');
  const { rewards } = await promoterData(user);
  const ticket = rewards.tickets.find((t) => t.available > 0);
  if (!ticket && rewards.merch.available === 0) return done(c, `${user.name} n’a aucune récompense à demander.`);
  const input = ticket
    ? { kind: 'ticket' as const, eventId: ticket.event.id, quantity: 1, details: '' }
    : { kind: 'merch' as const, quantity: 1, details: 'Hoodie, size M' };
  const result = requestReward(user, rewards, input);
  if (result !== 'ok') return done(c, `Demande refusée : ${result}.`);
  announceRewardRequest(user, rewardRequestsFor(user.id)[0]!);
  return done(c, `${user.name} a demandé ${ticket ? `un billet gratuit pour ${ticket.event.title}` : 'du merch'}.`);
});

demo.post('/__demo/rush', async (c) => {
  const active = sellers().filter((u) => u.onboarded_at);
  for (let i = 0; i < 12; i++) await sell(active[Math.floor(Math.random() * active.length)]!, 1 + Math.floor(Math.random() * 3));
  await checkAllMilestones();
  return done(c, '12 ventes ajoutées au hasard.');
});

// Ends the process: Docker starts it again and every start seeds from scratch, which also clears what
// the app keeps in memory. The page waits for the app to answer, then goes to the sign-in page.
demo.post('/__demo/reset', (c) => {
  setTimeout(() => process.exit(75), 200);
  return c.html(`<!doctype html><meta charset="utf-8"><title>Réinitialisation</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">Réinitialisation de la démo…
<script>setTimeout(function poll(){fetch('/healthz').then(r=>r.ok?location.replace('/'):setTimeout(poll,500)).catch(()=>setTimeout(poll,500))},1500)</script>`);
});

const canonical = new URL(config.appUrl);

async function withBar(req: Request, res: Response): Promise<Response> {
  if (!res.headers.get('content-type')?.includes('text/html') || req.headers.get('sec-fetch-dest') === 'iframe') return res;
  const url = new URL(req.url);
  const bar = await demo.fetch(new Request(`${url.origin}/__demo/bar?back=${encodeURIComponent(url.pathname + url.search)}`, { headers: req.headers }));
  const html = (await res.text())
    .replace('</head>', '<link rel="stylesheet" href="/__demo/bar.css"></head>')
    .replace('</body>', `${await bar.text()}</body>`);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  // Public pages are cached for a minute, which would keep an old bar.
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: res.status, headers });
}

console.log(`Demo ready on ${config.appUrl}`);

export default {
  port: app.port,
  idleTimeout: app.idleTimeout,
  async fetch(req: Request, server: unknown) {
    const url = new URL(req.url);
    // Sessions and links follow APP_URL; a cookie for "localhost" would also collide with the dev stack's.
    // Through ngrok (an https APP_URL), every other address goes there too, except Docker's health check.
    const elsewhere = canonical.protocol === 'https:' && url.host !== canonical.host && url.pathname !== '/healthz';
    if (url.hostname === 'localhost' || elsewhere) return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 307);
    if (url.pathname.startsWith('/__demo/')) return demo.fetch(req, server);
    return withBar(req, await app.fetch(req, server));
  },
};
