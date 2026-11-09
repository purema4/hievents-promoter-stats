import { config } from './config';
import { db } from './local-db';
import { RULE_VARIABLES, type RuleInputs } from './rule-variables';

/*
 * The one door to the rules engine (rules-engine/, a cel-go sidecar on the Docker network). Nothing
 * else calls it, and the browser never does, so the engine can be swapped (say, for CEL in-process)
 * by changing this file alone.
 *
 * A rule is lines of `name = expression`; lines starting with # are comments. Splitting the lines and
 * checking the names happens here; only the expressions go to the engine.
 */

export const RULE_MAX_LENGTH = 10_000;
export const RULE_MAX_LINES = 50;

export type RuleLine = { line: number; name: string; expr: string };
export type RuleProblem = { line: number; message: string };

/** The parsed tree of an expression, as the engine sends it (used to put rules into words). */
export type RuleNode =
  | { k: 'num'; v?: number }
  | { k: 'str'; s?: string }
  | { k: 'bool'; b?: boolean }
  | { k: 'var'; s: string }
  | { k: 'call'; s: string; a?: RuleNode[] }
  | { k: 'other' };

export class RulesEngineUnavailable extends Error {
  constructor(cause?: unknown) {
    super('The rules engine is not available', { cause });
  }
}

const NAME = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.*)$/;

/** Splits a rule into its lines. Problems found here need no engine: format, duplicates, size. */
export function parseRule(text: string): { lines: RuleLine[]; problems: RuleProblem[] } {
  const lines: RuleLine[] = [];
  const problems: RuleProblem[] = [];
  if (text.length > RULE_MAX_LENGTH) return { lines, problems: [{ line: 1, message: `The rule is longer than ${RULE_MAX_LENGTH} characters.` }] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const m = NAME.exec(trimmed);
    if (!m) {
      problems.push({ line, message: 'Write it as name = expression.' });
      return;
    }
    const [, name, expr] = m as unknown as [string, string, string];
    if (lines.some((l) => l.name === name)) problems.push({ line, message: `${name} is already given on another line.` });
    else lines.push({ line, name, expr: expr.trim() });
  });
  if (lines.length > RULE_MAX_LINES) problems.push({ line: lines[RULE_MAX_LINES]!.line, message: `A rule has ${RULE_MAX_LINES} lines at most.` });
  return { lines, problems };
}

const variables = RULE_VARIABLES.map((v) => ({ name: v.name, type: v.type }));

async function call<T>(path: string, body: unknown): Promise<T> {
  // Just failed: answer at once instead of waiting seconds again on every call of every page (a missing
  // engine costs 5 s of DNS each time). The health check, every minute, tells when it is back.
  if (lastFailure && Date.now() - lastFailure < RETRY_AFTER_MS) throw new RulesEngineUnavailable(new Error('The rules engine failed less than 30 s ago'));
  let res: Response;
  try {
    res = await fetch(`${config.rulesEngineUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    });
  } catch (err) {
    markDown();
    throw new RulesEngineUnavailable(err);
  }
  if (!res.ok) {
    markDown();
    throw new RulesEngineUnavailable(new Error(`${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`));
  }
  engineDownSince = null;
  return (await res.json()) as T;
}

// --- Up or down -----------------------------------------------------------------------------------

let engineDownSince: number | null = null;
let lastFailure = 0;
const RETRY_AFTER_MS = 30_000;
const markDown = () => {
  engineDownSince ??= Date.now();
  lastFailure = Date.now();
};

/** True when the engine answered its last call (or a health check now). Payouts wait while it is down. */
export async function rulesEngineUp(): Promise<boolean> {
  try {
    const res = await fetch(`${config.rulesEngineUrl}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (res.ok) {
      engineDownSince = null;
      lastFailure = 0;
      return true;
    }
  } catch {
    // down
  }
  markDown();
  return false;
}

/** Whether the last call to the engine failed; no network call. */
export const rulesEngineSeemsDown = () => engineDownSince !== null;

// --- Checking ---------------------------------------------------------------------------------------

export type CheckedRule = { lines: RuleLine[]; problems: RuleProblem[]; trees: Map<string, RuleNode> };

/**
 * Checks a rule: its format, that each name is one of `outputs`, and each expression (with the engine).
 * Problems carry their line number. Throws RulesEngineUnavailable when the engine cannot be reached.
 */
export async function checkRule(text: string, outputs: readonly string[]): Promise<CheckedRule> {
  const { lines, problems } = parseRule(text);
  for (const l of lines) {
    if (!outputs.includes(l.name)) problems.push({ line: l.line, message: `${l.name} is not something a rule can give. Use one of: ${outputs.join(', ')}.` });
  }
  const trees = new Map<string, RuleNode>();
  if (lines.length > 0) {
    const res = await call<{ results: Record<string, { errors?: { message: string; column: number }[]; tree?: RuleNode }> }>('/check', {
      expressions: Object.fromEntries(lines.map((l) => [l.name, l.expr])),
      variables,
    });
    for (const l of lines) {
      const r = res.results[l.name];
      for (const e of r?.errors ?? []) problems.push({ line: l.line, message: friendly(e.message, e.column, l) });
      if (r?.tree) trees.set(l.name, r.tree);
    }
  }
  problems.sort((a, b) => a.line - b.line);
  return { lines, problems, trees };
}

// Engine messages are terse; the column is counted from the start of the line as typed.
function friendly(message: string, column: number, line: RuleLine): string {
  const undeclared = /undeclared reference to '([^']+)'/.exec(message);
  if (undeclared) return `${undeclared[1]} is not a variable a rule can read.`;
  const at = column > 0 ? ` (at "${line.expr.slice(column, column + 12)}")` : '';
  const text = message.replace(/^ERROR: <input>:\d+:\d+: /, '').split('\n')[0]!;
  return `${text[0]!.toUpperCase()}${text.slice(1)}${at}`;
}

// --- Evaluating, with a cache ------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS rule_results (
    subject    TEXT PRIMARY KEY, -- what was evaluated, like "user:3:event:12"
    input_hash TEXT NOT NULL,    -- the rule version and every input value
    outputs    TEXT NOT NULL,    -- JSON {name: number}
    errors     TEXT,             -- JSON {name: message}, or NULL
    updated_at INTEGER NOT NULL
  );
`);

export type RuleResult = { outputs: Record<string, number>; errors: Record<string, string> };
export type Evaluation = {
  results: Map<string, RuleResult>;
  /** The engine was down: some results are the last ones known, or missing. */
  stale: boolean;
};

const sortedJson = (v: RuleInputs) => JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
const hashOf = (version: string, inputs: RuleInputs) => new Bun.CryptoHasher('sha256').update(`${version}\0${sortedJson(inputs)}`).digest('hex');

/**
 * Evaluates one rule for many subjects in one call. A result is reused while the rule version and the
 * inputs are the same. When the engine is down, the last result of each subject is given, marked stale.
 */
export async function evaluateRules(
  rule: { version: string; lines: RuleLine[] },
  inputs: { subject: string; variables: RuleInputs }[],
  opts: { cache?: boolean } = {},
): Promise<Evaluation> {
  const results = new Map<string, RuleResult>();
  // Previews of rules not saved: straight from the engine, nothing read from or written to the cache.
  if (opts.cache === false) {
    if (rule.lines.length === 0) return { results: new Map(inputs.map((i) => [i.subject, { outputs: {}, errors: {} }])), stale: false };
    const res = await call<{ results: { key: string; outputs: Record<string, number>; errors?: Record<string, string> }[] }>('/evaluate', {
      expressions: Object.fromEntries(rule.lines.map((l) => [l.name, l.expr])),
      variables,
      inputs: inputs.slice(0, 5000).map((t) => ({ key: t.subject, variables: t.variables })),
    });
    for (const r of res.results) results.set(r.key, { outputs: r.outputs ?? {}, errors: r.errors ?? {} });
    return { results, stale: false };
  }
  const read = db.query<{ input_hash: string; outputs: string; errors: string | null }, [string]>(
    'SELECT input_hash, outputs, errors FROM rule_results WHERE subject = ?',
  );
  const todo: { subject: string; variables: RuleInputs; hash: string }[] = [];
  const last = new Map<string, RuleResult>();
  for (const i of inputs) {
    const hash = hashOf(rule.version, i.variables);
    const row = read.get(i.subject);
    const cached = row ? { outputs: JSON.parse(row.outputs), errors: row.errors ? JSON.parse(row.errors) : {} } : null;
    if (row && cached && row.input_hash === hash) results.set(i.subject, cached);
    else {
      if (cached) last.set(i.subject, cached);
      todo.push({ ...i, hash });
    }
  }
  if (todo.length === 0 || rule.lines.length === 0) {
    for (const t of todo) results.set(t.subject, { outputs: {}, errors: {} });
    return { results, stale: false };
  }

  const expressions = Object.fromEntries(rule.lines.map((l) => [l.name, l.expr]));
  try {
    const write = db.query(
      'INSERT INTO rule_results (subject, input_hash, outputs, errors, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (subject) DO UPDATE SET input_hash = excluded.input_hash, outputs = excluded.outputs, errors = excluded.errors, updated_at = excluded.updated_at',
    );
    for (let at = 0; at < todo.length; at += 5000) {
      const batch = todo.slice(at, at + 5000);
      const res = await call<{ results: { key: string; outputs: Record<string, number>; errors?: Record<string, string> }[] }>('/evaluate', {
        expressions,
        variables,
        inputs: batch.map((t) => ({ key: t.subject, variables: t.variables })),
      });
      const byKey = new Map(res.results.map((r) => [r.key, r]));
      db.transaction(() => {
        for (const t of batch) {
          const r = byKey.get(t.subject);
          const result = { outputs: r?.outputs ?? {}, errors: r?.errors ?? (r ? {} : { '*': 'No result' }) };
          results.set(t.subject, result);
          write.run(t.subject, t.hash, JSON.stringify(result.outputs), Object.keys(result.errors).length ? JSON.stringify(result.errors) : null, Date.now());
        }
      })();
    }
    return { results, stale: false };
  } catch (err) {
    if (!(err instanceof RulesEngineUnavailable)) throw err;
    for (const t of todo) results.set(t.subject, last.get(t.subject) ?? { outputs: {}, errors: { '*': 'The rules engine is not available' } });
    return { results, stale: true };
  }
}
