import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// What the app does at startup with two-step secrets already in the database, run in subprocesses
// sharing one DATA_DIR: plain secrets get encrypted once a key is set; a missing or wrong key stops it.
const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-2fa-start-'));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const key = Buffer.alloc(32, 1).toString('base64');
const otherKey = 'ab'.repeat(32);

function run(args: string[], twoFactorKey: string | null) {
  const env: Record<string, string> = { ...process.env, DATA_DIR: dataDir } as Record<string, string>;
  delete env.TWO_FACTOR_KEY;
  if (twoFactorKey !== null) env.TWO_FACTOR_KEY = twoFactorKey;
  const proc = Bun.spawnSync([process.execPath, 'test/fixtures/two-factor-start.ts', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  const out = proc.stdout.toString();
  const lastLine = out.trim().split('\n').at(-1) ?? '';
  return { code: proc.exitCode, out, err: proc.stderr.toString(), json: lastLine.startsWith('{') ? JSON.parse(lastLine) : null };
}

test('secrets made without a key are encrypted when one is set, and keep working', () => {
  const setup = run(['setup'], null);
  expect(setup.code).toBe(0);
  const { secret } = setup.json;
  expect(setup.json.stored).toBe(secret);

  // Unencrypted secrets with no key: the app starts, with a warning.
  // Each check spends a code: setup used the previous step, so these use this step and the next.
  const plain = run(['check', secret, '0'], null);
  expect(plain.code).toBe(0);
  expect(plain.json.result).toBe('app');
  expect(plain.err).toContain('stored unencrypted');

  const sealed = run(['check', secret, '1'], key);
  expect(sealed.code).toBe(0);
  expect(sealed.json.result).toBe('app');
  expect(sealed.out).toContain('Encrypted the two-step secrets of 1 account(s)');
  expect(sealed.json.stored).toMatch(/^v1:/);

  // Already encrypted: nothing to do (that code is spent now, so it is refused).
  const again = run(['check', secret, '1'], key);
  expect(again.code).toBe(0);
  expect(again.out).not.toContain('Encrypted the');
  expect(again.json.result).toBeNull();
  expect(again.json.stored).toBe(sealed.json.stored);

  // Without the key, or with another one, the app refuses to start rather than lock everyone out.
  const missing = run(['check', secret, '0'], null);
  expect(missing.code).toBe(1);
  expect(missing.err).toContain('set TWO_FACTOR_KEY');
  const wrong = run(['check', secret, '0'], otherKey);
  expect(wrong.code).toBe(1);
  expect(wrong.err).toContain('does not decrypt');

  // A key that is not 32 bytes stops it too.
  expect(run(['check', secret, '0'], 'too-short').code).toBe(1);
});
