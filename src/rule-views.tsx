import type { User } from './local-db';
import type { PreviewRow, RuleCheck } from './rule-admin';
import { FIXED_OUTPUTS, RULE_VARIABLES } from './rule-variables';
import type { RuleProblem } from './rules-engine';
import type { RewardType, RuleScope, RuleTemplate, RuleVersion } from './rules';
import { Flash, formatDate, Layout } from './views';

/* Promoters → Rules: the default rule, templates, reward types, and each event's and promoter's rule. */

export type RuleTargetInfo = {
  scope: RuleScope;
  userId?: number;
  eventId?: number;
  templateId?: number;
  promoterName?: string;
  eventTitle?: string;
  templateName?: string;
};

export const ruleEditHref = (t: { scope: RuleScope; userId?: number | null; eventId?: number | null; templateId?: number | null }) => {
  const q = new URLSearchParams({ scope: t.scope });
  if (t.userId) q.set('user', String(t.userId));
  if (t.eventId) q.set('event', String(t.eventId));
  if (t.templateId) q.set('template', String(t.templateId));
  return `/admin/rules/edit?${q}`;
};

function titleOf(t: RuleTargetInfo): string {
  switch (t.scope) {
    case 'default':
      return 'Default rule';
    case 'promoter':
      return `${t.promoterName}’s rule`;
    case 'event':
      return `${t.eventTitle}: rule`;
    case 'promoter_event':
      return `${t.promoterName} on ${t.eventTitle}`;
    case 'template':
      return t.templateName ? `Template: ${t.templateName}` : 'New template';
  }
}

function whatItIs(t: RuleTargetInfo): string {
  switch (t.scope) {
    case 'default':
      return 'Your usual deal: it applies to every promoter on every event, except the lines an event or a promoter has its own of.';
    case 'promoter':
      return `${t.promoterName}’s own lines, on every event: they replace the same lines of the default rule. An event’s rule still wins over them.`;
    case 'event':
      return 'Lines for everyone on this event: they replace the same lines of the default rule and of promoters’ own rules. Write free_tickets = 0 to give none.';
    case 'promoter_event':
      return `Lines for ${t.promoterName} on this event only: they win over everything else.`;
    case 'template':
      return 'A rule to copy into an event’s rule. Changing a template changes no event.';
  }
}

export function RuleProblems(props: { problems: RuleProblem[] }) {
  return (
    <ul class="rule-problems">
      {props.problems.map((p) => (
        <li>
          Line {p.line}: {p.message}
        </li>
      ))}
    </ul>
  );
}

function PreviewTable(props: { rows: PreviewRow[]; outputs: string[]; labels: Record<string, string> }) {
  if (props.rows.length === 0) return null;
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            <th class="num">Sold</th>
            {props.outputs.map((o) => (
              <th class="num">{props.labels[o] ?? o}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr class={r.made_up ? 'made-up' : undefined}>
              <td>{r.label}</td>
              <td class="num">{r.tickets}</td>
              {props.outputs.map((o) => (
                <td class="num">{r.values[o] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RulePanel(props: { check: RuleCheck | null; labels: Record<string, string>; engineDown?: boolean }) {
  const c = props.check;
  return (
    <div class="rule-panel" id="rule-panel" aria-live="polite">
      {props.engineDown && <p class="flash error">The rules engine is not available: the rule cannot be checked or saved right now.</p>}
      {c && c.problems.length > 0 && (
        <div class="card">
          <h3>To fix</h3>
          <RuleProblems problems={c.problems} />
        </div>
      )}
      {c && c.problems.length === 0 && (
        <>
          <div class="card">
            <h3>In words</h3>
            <ul>
              {c.en.map((line) => (
                <li>{line}</li>
              ))}
            </ul>
            <h3>En français</h3>
            <ul>
              {c.fr.map((line) => (
                <li>{line}</li>
              ))}
            </ul>
          </div>
          <div class="card">
            <h3>Preview</h3>
            <PreviewTable rows={c.preview} outputs={c.outputs} labels={props.labels} />
          </div>
        </>
      )}
    </div>
  );
}

function Variables(props: { rewardTypes: RewardType[] }) {
  return (
    <details class="card">
      <summary>What a rule can read and give</summary>
      <dl class="rule-vars">
        {RULE_VARIABLES.map((v) => (
          <>
            <dt>{v.name}</dt>
            <dd>{v.en}</dd>
          </>
        ))}
      </dl>
      <p class="muted">Each line gives one of these:</p>
      <dl class="rule-vars">
        {FIXED_OUTPUTS.map((o) => (
          <>
            <dt>{o.name}</dt>
            <dd>{o.en}</dd>
          </>
        ))}
        {props.rewardTypes.map((t) => (
          <>
            <dt>{t.key}</dt>
            <dd>Reward: {t.label_en}</dd>
          </>
        ))}
      </dl>
      <p class="muted">
        Write <code>name = expression</code>, one per line; lines starting with # are notes. Numbers like 5 and 5.0 are the
        same. Also: <code>floor()</code>, <code>ceil()</code>, <code>round()</code>, <code>min()</code>, <code>max()</code>,
        <code>a ? b : c</code>, <code>&amp;&amp;</code>, <code>||</code>.
      </p>
    </details>
  );
}

export function AdminRuleEditPage(props: {
  user: User;
  target: RuleTargetInfo;
  text: string;
  check: RuleCheck | null;
  labels: Record<string, string>;
  history: (RuleVersion & { by: string | null })[];
  templates: RuleTemplate[];
  rewardTypes: RewardType[];
  /** On an event: its promoters, for their own lines there. */
  promoters?: User[];
  engineDown?: boolean;
  /** Shown when ANTHROPIC_API_KEY is set. */
  canWrite?: boolean;
  description?: string;
  note?: string;
  ok?: string;
  error?: string;
}) {
  const t = props.target;
  const href = ruleEditHref(t);
  return (
    <Layout title={titleOf(t)} user={props.user}>
      <p class="muted">
        <a href="/admin/rules">Rules</a> / {titleOf(t)}
      </p>
      <h1>{titleOf(t)}</h1>
      <p class="muted">{whatItIs(t)}</p>
      <Flash error={props.error} ok={props.ok} />
      {t.scope === 'event' && props.templates.length > 0 && (
        <form class="media-form" method="get" action="/admin/rules/edit">
          <input type="hidden" name="scope" value="event" />
          <input type="hidden" name="event" value={String(t.eventId)} />
          <select name="copy" aria-label="Template to copy">
            {props.templates.map((tpl) => (
              <option value={String(tpl.id)}>{tpl.name}</option>
            ))}
          </select>
          <button class="secondary" type="submit">
            Copy into the box
          </button>
        </form>
      )}
      {props.canWrite && (
        <details class="card write-card" open={!!props.description || undefined}>
          <summary>Write it for me</summary>
          <form class="stack" method="post" action={`/admin/rules/write?${href.split('?')[1]}`}>
            <label>
              Describe the deal, in French or English
              <textarea name="description" rows={3} maxlength={2000} required placeholder="1 billet vendu = 2 VIP (lui et son +1), puis 1 place liste GA par 5 billets, 5 $ par billet">
                {props.description ?? ''}
              </textarea>
            </label>
            <button class="secondary" type="submit">
              Write the rule
            </button>
            <p class="muted">Claude writes it into the box below. It is checked like a rule you type, and nothing is saved until you save.</p>
          </form>
        </details>
      )}
      {props.note && <p class="flash ok">{props.note}</p>}
      <div class="rule-editor">
        <form method="post" action={href} data-rule-editor data-check={`/admin/rules/check?${href.split('?')[1]}`}>
          {t.scope === 'template' && (
            <label>
              Name
              <input name="name" value={t.templateName ?? ''} maxlength={60} required placeholder="Big show" />
            </label>
          )}
          <label>
            Rule
            <textarea class="rule-text" name="text" spellcheck={false} autocapitalize="off" autocomplete="off" data-rule-text>
              {props.text}
            </textarea>
          </label>
          <label class="rule-test">
            Also try with
            <input name="test" type="number" min="0" max="100000" step="1" placeholder="30" data-rule-test />
            tickets sold
          </label>
          <p class="rule-pending" data-rule-status hidden>
            Checking…
          </p>
          <div>
            <button type="submit">Save</button>
            {t.scope !== 'default' && (
              <button class="secondary" type="submit" name="remove" value="1" formnovalidate>
                {t.scope === 'template' ? 'Remove the template' : 'Remove this rule'}
              </button>
            )}
          </div>
          <p class="muted">Nothing is saved while the rule has a problem. Each save is kept as a version.</p>
        </form>
        <RulePanel check={props.check} labels={props.labels} engineDown={props.engineDown} />
      </div>

      <Variables rewardTypes={props.rewardTypes} />

      {props.promoters && props.promoters.length > 0 && (
        <>
          <h2>Promoters on this event</h2>
          <p class="muted">Give one of them their own lines on this event.</p>
          <ul>
            {props.promoters.map((p) => (
              <li>
                <a href={ruleEditHref({ scope: 'promoter_event', userId: p.id, eventId: t.eventId })}>{p.name}</a>
              </li>
            ))}
          </ul>
        </>
      )}

      {props.history.length > 0 && (
        <>
          <h2>Versions</h2>
          <ul class="rule-history">
            {props.history.map((v) => (
              <li>
                #{v.id} · {v.created_at} UTC · {v.by ?? 'Set up from the rates used before rules'}
                {v.text === '' ? ' · removed' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </Layout>
  );
}

export function AdminRulesPage(props: {
  user: User;
  defaultText: string;
  defaultWords: string[];
  templates: RuleTemplate[];
  rewardTypes: RewardType[];
  events: { id: number; title: string; start: Date | null; timezone: string | null; promoters: User[]; hasRule: boolean; overrides: number }[];
  promotersWithRules: User[];
  ok?: string;
  error?: string;
}) {
  return (
    <Layout title="Rules" user={props.user}>
      <h1>Rules</h1>
      <p class="muted">
        Rules work out each promoter’s commission, bonus and rewards on each event, from their sales. The most specific
        line wins: a promoter on an event, then the event, then the promoter, then the default rule.
      </p>
      <Flash error={props.error} ok={props.ok} />

      <div class="card rate-card">
        <h2 class="first">Default rule</h2>
        <ul>
          {props.defaultWords.map((w) => (
            <li>{w}</li>
          ))}
        </ul>
        <pre class="code-block">{props.defaultText}</pre>
        <a class="button secondary" href={ruleEditHref({ scope: 'default' })}>
          Edit
        </a>
      </div>

      <h2>Events</h2>
      <p class="muted">Drafts and events that are not over, with promoter codes.</p>
      {props.events.length === 0 && <p class="muted">No upcoming events with promoter codes.</p>}
      <div class="card table-wrap">
        <table>
          <tbody>
            {props.events.map((e) => (
              <tr>
                <td>
                  <a href={ruleEditHref({ scope: 'event', eventId: e.id })}>{e.title}</a>
                  <div class="muted">{formatDate(e.start, e.timezone)}</div>
                </td>
                <td>{e.hasRule ? 'Own rule' : <span class="muted">Default rule</span>}</td>
                <td class="muted">
                  {e.promoters.length} {e.promoters.length === 1 ? 'promoter' : 'promoters'}
                  {e.overrides > 0 && ` · ${e.overrides} with their own lines`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Promoters with their own rule</h2>
      {props.promotersWithRules.length === 0 ? (
        <p class="muted">None. Open a promoter’s page to give them one.</p>
      ) : (
        <ul>
          {props.promotersWithRules.map((p) => (
            <li>
              <a href={ruleEditHref({ scope: 'promoter', userId: p.id })}>{p.name}</a>
            </li>
          ))}
        </ul>
      )}

      <h2>Templates</h2>
      <p class="muted">Named rules to copy into an event’s rule, like “Big show” or “Free event”.</p>
      <ul>
        {props.templates.map((t) => (
          <li>
            <a href={ruleEditHref({ scope: 'template', templateId: t.id })}>{t.name}</a>
          </li>
        ))}
      </ul>
      <a class="button secondary" href={ruleEditHref({ scope: 'template' })}>
        New template
      </a>

      <h2 id="types">Reward types</h2>
      <p class="muted">
        What a rule can give besides commission, bonus and merch. The key is the name a rule uses (like vip_tickets);
        promoters see the label.
      </p>
      <div class="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>En français</th>
            </tr>
          </thead>
          <tbody>
            {props.rewardTypes.map((t) => (
              <tr>
                <td>
                  <code>{t.key}</code>
                </td>
                <td>{t.label_en}</td>
                <td>{t.label_fr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form class="card stack-card" method="post" action="/admin/rules/types">
        <h3>Add or rename a reward type</h3>
        <div class="field-row">
          <label>
            Key
            <input name="key" pattern="[a-z][a-z0-9_]{1,39}" maxlength={40} required placeholder="vip_tickets" />
          </label>
          <label>
            Label
            <input name="label_en" maxlength={40} required placeholder="VIP" />
          </label>
        </div>
        <label>
          En français
          <input name="label_fr" maxlength={40} placeholder="VIP" />
        </label>
        <button type="submit">Save</button>
      </form>
    </Layout>
  );
}
