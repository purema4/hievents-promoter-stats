import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeIntegration, stack } from './harness';

/*
 * The rates and free tickets used before rules, migrated to rules, give the same numbers on the seed
 * data: the usual rate (COMMISSION_PERCENT and promoters' own percentages and flat amounts), rates on
 * one event, and the free-ticket track. Team commission is not a rule and is checked by its own tests.
 */
describeIntegration('migration to rules', () => {
  test('same commission and free tickets as before, for every rate and event', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-migration-'));
    try {
      const proc = Bun.spawnSync([process.execPath, 'test/fixtures/legacy-vs-rules.ts'], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          APP_URL: 'http://127.0.0.1:3998',
          DATA_DIR: dataDir,
          HIEVENTS_DATABASE_URL: stack.dbUrl,
          RULES_ENGINE_URL: stack.rulesUrl,
          COMMISSION_PERCENT: '10',
          REWARD_TICKET_EVERY: '5',
          APP_TIMEZONE: 'America/Toronto',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const lines = proc.stdout.toString().trim().split('\n');
      if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
      const rows: {
        user: string; codes: string; event: number; codesOnEvent: number; commission: number; ruleCommission: number; free: number; ruleFree: number; errors: Record<string, string>;
      }[] = JSON.parse(lines.at(-1)!);
      expect(rows.length).toBeGreaterThan(40);
      expect(rows.some((r) => r.commission > 0)).toBe(true);
      for (const r of rows) {
        const where = `${r.user}, codes ${r.codes}, event ${r.event}`;
        expect(r.errors, where).toEqual({});
        expect(r.ruleFree, where).toBe(r.free);
        // The old code rounded each code's commission on its own; a rule rounds the event once. With
        // one code on the event that is the same; with more, it can differ by a cent per extra code.
        if (r.codesOnEvent === 1) expect(r.ruleCommission, where).toBe(r.commission);
        else expect(Math.abs(r.ruleCommission - r.commission), where).toBeLessThanOrEqual(r.codesOnEvent - 1);
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
