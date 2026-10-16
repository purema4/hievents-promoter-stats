/*
 * Integration test harness. The real server (`bun src/index.tsx`) runs as a subprocess with its own
 * temporary DATA_DIR and port, against the sandbox stack from docker-compose.dev.yml +
 * docker-compose.test.yml (Hi.Events Postgres with dev/seed.sql, Mailpit, the cover CDN).
 * Tests talk to it over HTTP only and read its emails through the Mailpit API.
 *
 * When the stack is unreachable the integration tests are skipped, except with CI=true, where that
 * is an error.
 */
import { describe, setDefaultTimeout, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

setDefaultTimeout(30_000);

export const stack = {
  dbUrl: process.env.TEST_HIEVENTS_DB_URL || 'postgres://promoter_stats:change-me@127.0.0.1:55432/hi-events',
  mailpitUrl: (process.env.TEST_MAILPIT_URL || 'http://127.0.0.1:18025').replace(/\/$/, ''),
  smtpPort: Number(process.env.TEST_SMTP_PORT || 11025),
  cdnUrl: (process.env.TEST_CDN_URL || 'http://127.0.0.1:18080').replace(/\/$/, ''),
};

const START_HINT =
  'Start it with: docker compose -p promoterstats-tests -f docker-compose.dev.yml -f docker-compose.test.yml up -d --wait hievents-db mailpit cdn';

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeStack(): Promise<string | null> {
  const sql = postgres(stack.dbUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`SELECT 1 FROM promo_codes LIMIT 1`;
  } catch (err) {
    return `Hi.Events test database not reachable at ${stack.dbUrl.replace(/:[^:@/]*@/, ':***@')} (${(err as Error).message})`;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
  try {
    const res = await fetch(`${stack.mailpitUrl}/api/v1/info`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return `Mailpit API at ${stack.mailpitUrl} answered ${res.status}`;
  } catch (err) {
    return `Mailpit API not reachable at ${stack.mailpitUrl} (${(err as Error).message})`;
  }
  if (!(await tcpOpen('127.0.0.1', stack.smtpPort, 3000))) return `Mailpit SMTP not reachable on 127.0.0.1:${stack.smtpPort}`;
  try {
    const res = await fetch(`${stack.cdnUrl}/event_cover/warehouse.png`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return `Cover CDN at ${stack.cdnUrl} answered ${res.status}`;
  } catch (err) {
    return `Cover CDN not reachable at ${stack.cdnUrl} (${(err as Error).message})`;
  }
  return null;
}

const problem = await probeStack();
const inCI = ['true', '1'].includes((process.env.CI ?? '').toLowerCase());
const message = problem && `${problem}. ${START_HINT}`;
if (problem && !inCI) console.warn(`\n[integration] Skipping integration tests: ${problem}.\n[integration] ${START_HINT}\n`);

export const stackAvailable = !problem;

/**
 * `describe` when the stack is up. Without it: `describe.skip` locally, and in CI (CI=true) a suite
 * whose only test fails with the reason, so a missing stack can never pass as green.
 */
export const describeIntegration: typeof describe = !problem
  ? describe
  : !inCI
    ? describe.skip
    : (((name: string) =>
        describe(name, () => {
          test('the integration test stack is reachable', () => {
            throw new Error(`Integration test stack unreachable and CI=true: ${message}`);
          });
        })) as unknown as typeof describe);

// --- The server under test -------------------------------------------------------------------

const root = resolve(import.meta.dir, '../..');
export const uid = () => crypto.randomUUID().slice(0, 8);

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

export type Server = {
  url: string;
  adminEmail: string;
  adminPassword: string;
  logs: () => string;
  stop: () => Promise<void>;
};

export async function startServer(extraEnv: Record<string, string> = {}): Promise<Server> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-it-'));
  const adminEmail = `admin-${uid()}@example.test`;
  const adminPassword = 'integration-password-123';
  // Built from scratch so nothing from the developer's shell or .env leaks into the server.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? tmpdir(),
    NODE_ENV: 'test',
    PORT: String(port),
    APP_URL: url,
    DATA_DIR: dataDir,
    COOKIE_SECURE: 'false',
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    HIEVENTS_DATABASE_URL: stack.dbUrl,
    HIEVENTS_ACCOUNT_IDS: '',
    HIEVENTS_PUBLIC_URL: '',
    HIEVENTS_IMAGE_BASE_URL: stack.cdnUrl,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(stack.smtpPort),
    SMTP_SECURE: 'false',
    MAIL_FROM: 'Promoter stats <promoters@example.test>',
    COMMISSION_PERCENT: '10',
    APP_TIMEZONE: 'America/Toronto',
    ...extraEnv,
  };
  const proc = Bun.spawn([process.execPath, '--no-env-file', 'src/index.tsx'], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) output += decoder.decode(chunk, { stream: true });
  };
  void drain(proc.stdout);
  void drain(proc.stderr);

  const stop = async () => {
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(5000)]);
    if (proc.exitCode === null) proc.kill(9);
    rmSync(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { url, adminEmail, adminPassword, logs: () => output, stop };
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  await stop();
  throw new Error(`The server did not start (exit code ${proc.exitCode}). Output:\n${output}`);
}

// --- HTTP with a cookie jar ------------------------------------------------------------------

type RequestOptions = Omit<RequestInit, 'body'> & {
  /** Origin header for non-GET requests: APP_URL by default, null to leave it out. */
  origin?: string | null;
  body?: BodyInit | null;
};

export class Client {
  readonly cookies = new Map<string, string>();
  constructor(readonly server: Server) {}

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const { origin, ...init } = options;
    const headers = new Headers(init.headers);
    if (this.cookies.size && !headers.has('cookie')) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && origin !== null && !headers.has('origin')) headers.set('origin', origin ?? this.server.url);
    const res = await fetch(`${this.server.url}${path}`, { ...init, method, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get(path: string, options: RequestOptions = {}) {
    return this.request(path, options);
  }

  /** A form POST, as a browser on APP_URL sends it. */
  /** A form POST; pairs can repeat a field, like a form with several rows. */
  post(path: string, form: Record<string, string> | [string, string][] = {}, options: RequestOptions = {}) {
    return this.request(path, {
      ...options,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(options.headers as Record<string, string> | undefined) },
      body: new URLSearchParams(form).toString(),
    });
  }

  /** GET a page that must answer 200; returns its HTML. */
  async page(path: string): Promise<string> {
    const res = await this.get(path);
    const html = await res.text();
    if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status} ${res.headers.get('location') ?? ''}\n${html.slice(0, 500)}`);
    return html;
  }
}

export const location = (res: Response) => res.headers.get('location');

// --- Mailpit ---------------------------------------------------------------------------------

type MailSummary = { ID: string; Subject: string; Created: string };
export type Mail = { ID: string; Subject: string; Text: string; HTML: string };

export async function emailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${stack.mailpitUrl}/api/v1/search?limit=100&query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search answered ${res.status}`);
  const body = (await res.json()) as { messages: MailSummary[] | null };
  return body.messages ?? [];
}

export async function readEmail(id: string): Promise<Mail> {
  const res = await fetch(`${stack.mailpitUrl}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message ${id} answered ${res.status}`);
  return (await res.json()) as Mail;
}

/** Waits for the newest email to `address` whose subject matches (shared inboxes like the admin's). */
export async function waitForSubject(address: string, subject: string | RegExp, timeoutMs = 15_000): Promise<Mail> {
  const matches = (s: string) => (typeof subject === 'string' ? s === subject : subject.test(s));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await emailsTo(address)).find((m) => matches(m.Subject));
    if (found) return readEmail(found.ID);
    await Bun.sleep(100);
  }
  throw new Error(`No email to ${address} with subject ${subject} within ${timeoutMs} ms`);
}

/** Waits until `address` has received at least `count` emails; returns the newest one. */
export async function waitForEmail(address: string, count = 1, timeoutMs = 15_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await emailsTo(address);
    if (messages.length >= count) return readEmail(messages[0]!.ID);
    await Bun.sleep(100);
  }
  throw new Error(`Expected ${count} email(s) to ${address} within ${timeoutMs} ms, got ${(await emailsTo(address)).length}`);
}

/** The sign-in link token and 6-digit code from an invite or sign-in email. */
export function signInDetails(mail: Mail): { token: string; code: string } {
  const token = mail.Text.match(/\/login\/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
  const code = mail.Text.match(/Enter this code instead: ([0-9]{6})/)?.[1];
  if (!token || !code) throw new Error(`No sign-in link or code in:\n${mail.Text}`);
  return { token, code };
}

// --- Accounts --------------------------------------------------------------------------------

export async function signInAdmin(server: Server): Promise<Client> {
  const client = new Client(server);
  const res = await client.post('/login', { email: server.adminEmail, password: server.adminPassword });
  if (res.status !== 302 || location(res) !== '/') throw new Error(`Admin password sign-in answered ${res.status} ${location(res)}`);
  return client;
}

export type Promoter = { id: number; email: string; name: string };

export async function createPromoter(admin: Client, options: { name?: string; codes?: string; commission?: string } = {}): Promise<Promoter> {
  const name = options.name ?? `Promoter ${uid()}`;
  const email = `promoter-${uid()}@example.test`;
  const res = await admin.post('/admin/promoters', {
    name,
    email,
    codes: options.codes ?? 'DJMAX',
    commission_percent: options.commission ?? '',
    invite: '0',
  });
  const id = Number(location(res)?.match(/^\/admin\/promoters\/(\d+)\?ok=created$/)?.[1]);
  if (res.status !== 302 || !id) throw new Error(`Creating a promoter answered ${res.status} ${location(res)}`);
  return { id, email, name };
}

/** Emails the promoter an invite from the admin page (not rate limited) and returns its link and code. */
export async function sendInvite(admin: Client, promoter: Promoter): Promise<{ token: string; code: string }> {
  const before = (await emailsTo(promoter.email)).length;
  const res = await admin.post(`/admin/promoters/${promoter.id}/invite`);
  if (location(res) !== `/admin/promoters/${promoter.id}?ok=link_sent`) throw new Error(`Invite answered ${res.status} ${location(res)}`);
  return signInDetails(await waitForEmail(promoter.email, before + 1));
}

/** Opens an emailed link the way a browser does: the confirm page, then its auto-submitted form. */
export async function openLink(client: Client, token: string): Promise<Response> {
  const confirm = await client.get(`/login/verify?token=${token}`);
  if (confirm.status !== 200) throw new Error(`Link confirm page answered ${confirm.status}`);
  return client.post('/login/verify', { token });
}

/** A promoter signed in through an invite link, past the welcome steps. */
export async function signInPromoter(server: Server, admin: Client, promoter: Promoter, onboard = true): Promise<Client> {
  const client = new Client(server);
  const { token } = await sendInvite(admin, promoter);
  const res = await openLink(client, token);
  if (res.status !== 302 || location(res) !== '/') throw new Error(`Opening the invite answered ${res.status} ${location(res)}`);
  if (onboard) {
    const done = await client.post('/welcome/done');
    if (done.status !== 302) throw new Error(`Skipping the welcome steps answered ${done.status}`);
  }
  return client;
}

export async function newPromoter(server: Server, admin: Client, options: Parameters<typeof createPromoter>[1] = {}) {
  const promoter = await createPromoter(admin, options);
  return { ...promoter, client: await signInPromoter(server, admin, promoter) };
}

// --- TOTP, computed independently of src/two-factor.ts -----------------------------------------

function base32ToBytes(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export function totp(secretB32: string, step = Math.floor(Date.now() / 30_000)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32ToBytes(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export const currentStep = () => Math.floor(Date.now() / 30_000);

// --- Reading pages ---------------------------------------------------------------------------

/** The stat cards of a page: label text → value text. */
export function stats(html: string): Map<string, string> {
  const cards = new Map<string, string>();
  for (const m of html.matchAll(/<div class="value">([^<]*)<\/div><div class="label">([\s\S]*?)<\/div>/g)) {
    cards.set(m[2]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), m[1]!.trim());
  }
  return cards;
}

/** The text of a page without tags, for simple "contains" checks. */
export function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}
