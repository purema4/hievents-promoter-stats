// Preloaded by bunfig.toml before any test file. src/config.ts exits the process when APP_URL or
// HIEVENTS_DATABASE_URL is missing, and src/local-db.ts opens SQLite in DATA_DIR at import, so the
// environment has to be in place before the first `import ... from '../../src/...'`.
// Integration tests do not use this: they start the real server as a subprocess with its own env.
import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-unit-'));

Object.assign(process.env, {
  APP_URL: 'http://127.0.0.1:3999',
  // Never connected to: postgres() is lazy and unit tests do not query Hi.Events.
  HIEVENTS_DATABASE_URL: 'postgres://unit:unit@127.0.0.1:1/unit-tests',
  DATA_DIR: dataDir,
  COOKIE_SECURE: 'false',
  COMMISSION_PERCENT: '10',
  REWARD_TICKET_EVERY: '5',
  MERCH_EVERY: '50',
  CASH_STEP: '50',
  PAYOUT_METHODS: 'Interac e-Transfer,Cash',
  APP_TIMEZONE: 'America/Toronto',
  HIEVENTS_PUBLIC_URL: 'https://tickets.example.com',
  TWO_FACTOR_KEY: Buffer.alloc(32, 7).toString('base64'),
});
for (const key of ['SMTP_HOST', 'HIEVENTS_ACCOUNT_IDS', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'HIEVENTS_IMAGE_BASE_URL', 'CASH_METHOD', 'KUTT_URL', 'KUTT_API_KEY']) {
  delete process.env[key];
}

// In a preload, afterAll runs once after every test file.
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
