// Started by test/integration/rules-migration.test.ts in a subprocess with its own DATA_DIR and the test
// stack's Hi.Events database: the old commission and free-ticket numbers next to the migrated rules'.
import { setEventRule, rateFor } from '../../src/commission';
import { statsForCodes } from '../../src/hievents';
import { createUser, findUser } from '../../src/local-db';
import { summarizeEvents } from '../../src/promoter-views';
import { freeTicketsEarned } from '../../src/rewards';
import { evaluateRules } from '../../src/rules-engine';
import { migrateToRules, ruleFor } from '../../src/rules';
import { emptyInputs } from '../../src/rule-variables';

const people = [
  { name: 'Default rate', commission: undefined },
  { name: '12.5%', commission: { percent: 12.5, flatCents: null } },
  { name: '15%', commission: { percent: 15, flatCents: null } },
  { name: '$2.50 a ticket', commission: { percent: null, flatCents: 250 } },
  { name: '$3 a ticket', commission: { percent: null, flatCents: 300 } },
];
const ids: number[] = [];
for (const p of people) ids.push(await createUser({ email: `${ids.length}@example.test`, name: p.name, isAdmin: false, commission: p.commission }));
// Rates on one event, set on Commissions.
setEventRule(ids[0]!, 1, { kind: 'flat', value: 200 });
setEventRule(ids[1]!, 2, { kind: 'percent', value: 7 });
setEventRule(ids[3]!, 1, { kind: 'percent', value: 20 });

// Taken before the migration, from the old code; then the same with the rules.
const codeSets = [['djmax'], ['luna'], ['djmax', 'luna'], ['nova'], ['djmax', 'ghost']];
const before = [];
for (const id of ids) {
  const user = findUser(id)!;
  for (const codes of codeSets) {
    const rows = await statsForCodes(codes);
    for (const e of summarizeEvents(rows, rateFor(user))) {
      before.push({ user: user.name, id, codes: codes.join('+'), event: e.id, codesOnEvent: e.rows.length, tickets: e.tickets, fullPrice: e.fullPrice, commission: e.commission, free: freeTicketsEarned(e.tickets) });
    }
  }
}
migrateToRules();
const out = [];
for (const b of before) {
  const rule = ruleFor(b.id, b.event);
  const subject = `${b.id}:${b.codes}:${b.event}`;
  const { results } = await evaluateRules({ version: rule.key, lines: rule.lines }, [
    { subject, variables: { ...emptyInputs(), tickets_sold: b.tickets, full_price_sales: b.fullPrice / 100 } },
  ]);
  const r = results.get(subject)!;
  out.push({ ...b, ruleCommission: Math.round((r.outputs.commission ?? 0) * 100), ruleFree: r.outputs.free_tickets ?? 0, errors: r.errors });
}
console.log(JSON.stringify(out));
process.exit(0);
