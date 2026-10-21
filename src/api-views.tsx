import type { ApiToken } from './api-tokens';
import { MAX_KEYS } from './api-tokens';
import { canUse, ops, type Op } from './api-ops';
import { getBrand } from './brand';
import { config } from './config';
import type { User } from './local-db';
import { isTeamLead } from './teams';
import { Flash, Layout, since } from './views';

// When a key was made or an app connected: "just now", "3 h ago", or the date.
const made = (epoch: number) => since(epoch).replace('active now', 'just now');

const mcpUrl = `${config.appUrl}/mcp`;
const apiUrl = `${config.appUrl}/api/v1`;

function CopyField(props: { value: string; label: string }) {
  return (
    <div class="link-field">
      <input readonly value={props.value} aria-label={props.label} />
      <button type="button" class="secondary small" data-copy>
        Copy
      </button>
    </div>
  );
}

/** What changes a key or connection allowed to make them can make, for this person. */
function changesFor(user: User): string {
  if (user.is_admin) return 'mark payouts paid or declined, give or decline rewards, add promoters, change their codes and set commissions';
  return 'request payouts and rewards for you';
}

function whatItSees(user: User): string {
  if (user.is_admin) return 'every promoter: sales, balances, payouts, rewards, promo codes and events';
  if (isTeamLead(user)) return 'your sales and balance, and your team\'s';
  return 'your sales, balance, payouts, rewards and links';
}

// Account → API & Claude: connect Claude, make and remove API keys.
export function ApiPage(props: { user: User; tokens: ApiToken[]; newKey?: { key: string; name: string }; ok?: string; error?: string }) {
  const u = props.user;
  const keys = props.tokens.filter((t) => !t.client_id);
  const apps = props.tokens.filter((t) => t.client_id);
  const usable: Op[] = ops.filter((op) => canUse(op, u, { can_write: 1 } as ApiToken));
  return (
    <Layout title="API & Claude" user={u}>
      <h1>API &amp; Claude</h1>
      <p class="muted">
        Let Claude, or a program of your own, read {whatItSees(u)}. It acts as you and sees only what you see here.
      </p>
      <Flash ok={props.ok} error={props.error} />

      {props.newKey && (
        <div class="card stack-card">
          <h2 class="first">Your new key: {props.newKey.name}</h2>
          <p>
            Copy it now and keep it somewhere safe, like a password manager. <strong>It is shown only once.</strong> Anyone who has it can
            use it as you.
          </p>
          <CopyField value={props.newKey.key} label="API key" />
        </div>
      )}

      <h2>Connect Claude</h2>
      <div class="card stack-card">
        <p>Ask Claude things like “how many tickets did I sell this week?” or “which events are my best?”.</p>
        <CopyField value={mcpUrl} label="Server address" />
        <p>
          <strong>Claude on the web, desktop or phone:</strong> Settings → Connectors → Add custom connector. Paste the address above, then
          Connect. You sign in here and choose what Claude may do.
        </p>
        <p>
          <strong>Claude Code:</strong> run <code>claude mcp add --transport http promoter-stats {mcpUrl}</code>, then type <code>/mcp</code>{' '}
          in Claude Code to sign in.
        </p>
        <p class="muted">Other apps that support MCP connect the same way, or with an API key below.</p>
      </div>

      <h2>Connected apps</h2>
      {apps.length === 0 ? (
        <p class="muted">No apps connected.</p>
      ) : (
        <div class="device-list">
          {apps.map((t) => (
            <div class="card device">
              <div>
                <strong>
                  {t.name} <span class={t.can_write ? 'badge edited' : 'badge'}>{t.can_write ? 'Read and change' : 'Read only'}</span>
                </strong>
                <span class="muted">
                  Connected {made(t.created_at)} · last used {since(t.last_used_at)}
                </span>
              </div>
              <form method="post" action={`/account/api/${t.id}/remove`}>
                <button class="secondary small" type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      <h2>API keys</h2>
      {keys.length > 0 && (
        <div class="device-list">
          {keys.map((t) => (
            <div class="card device">
              <div>
                <strong>
                  {t.name} <span class={t.can_write ? 'badge edited' : 'badge'}>{t.can_write ? 'Read and change' : 'Read only'}</span>
                </strong>
                <span class="muted">
                  Ends in …{t.hint} · made {made(t.created_at)} · last used {t.last_used_at ? since(t.last_used_at) : 'never'} ·{' '}
                  {t.expires_at ? `works until ${new Date(t.expires_at * 1000).toISOString().slice(0, 10)}` : 'never expires'}
                </span>
              </div>
              <form method="post" action={`/account/api/${t.id}/remove`}>
                <button class="secondary small" type="submit">
                  Remove
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
      {keys.length < MAX_KEYS ? (
        <form class="card stack-card" method="post" action="/account/api/keys">
          <label>
            Name, to remember what it is for
            <input name="name" maxlength={60} placeholder="Sales sheet" required />
          </label>
          <label>
            Works for
            <select name="days">
              <option value="30">30 days</option>
              <option value="90" selected>
                90 days
              </option>
              <option value="365">1 year</option>
              <option value="never">Until I remove it</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="can_write" value="1" /> Can also make changes: {changesFor(u)}
          </label>
          <button type="submit">Make a key</button>
        </form>
      ) : (
        <p class="muted">You have {MAX_KEYS} keys, the most there can be. Remove one to make another.</p>
      )}

      <h2>Using the API</h2>
      <div class="card stack-card api-docs">
        <p>
          Send the key in the <code>Authorization</code> header. Answers are JSON; money is in cents, with its currency.
        </p>
        <CopyField value={`curl -H "Authorization: Bearer YOUR_KEY" ${apiUrl}/stats`} label="Example" />
        <p class="muted">
          The full description, for tools that read OpenAPI: <a href="/api/v1/openapi.json">{apiUrl}/openapi.json</a>. Limits, for all your keys and
          apps together: 120 calls a minute, 60 changes an hour.
        </p>
        <div class="table-wrap">
          <table class="activity">
            <thead>
              <tr>
                <th>Call</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {usable.map((op) => (
                <tr>
                  <td>
                    <code>
                      {op.method} {op.path}
                    </code>
                  </td>
                  <td>
                    {op.description}
                    {op.write ? <span class="muted"> Needs a key that can make changes.</span> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

// --- Connecting an app (OAuth) ----------------------------------------------------------------------

export function OAuthConsentPage(props: {
  user: User;
  clientName: string;
  request: { clientId: string; redirectUri: string; state: string; codeChallenge: string };
}) {
  const r = props.request;
  const host = new URL(r.redirectUri).host;
  return (
    <Layout title="Connect an app">
      <div class="login card stack-card">
        <h1 class="first">Connect {props.clientName}?</h1>
        <p>
          <strong>{props.clientName}</strong> ({host}) wants to use {getBrand().name} as <strong>{props.user.name}</strong>. It could read{' '}
          {whatItSees(props.user)}.
        </p>
        <p class="muted">Only connect apps you just added yourself. You can disconnect it any time under Account → API &amp; Claude.</p>
        <form class="stack" method="post" action="/oauth/authorize">
          <input type="hidden" name="client_id" value={r.clientId} />
          <input type="hidden" name="redirect_uri" value={r.redirectUri} />
          <input type="hidden" name="state" value={r.state} />
          <input type="hidden" name="code_challenge" value={r.codeChallenge} />
          <label class="check">
            <input type="checkbox" name="can_write" value="1" /> Also let it make changes: {changesFor(props.user)}
          </label>
          <button type="submit" name="answer" value="approve">
            Connect
          </button>
          <button class="secondary" type="submit" name="answer" value="deny">
            Cancel
          </button>
        </form>
      </div>
    </Layout>
  );
}

// The browser goes back to the app by itself (a form cannot be redirected to another site under the CSP).
export function OAuthRedirectPage(props: { to: string; clientName: string; approved: boolean }) {
  return (
    <Layout title="Connect an app">
      <meta http-equiv="refresh" content={`0;url=${props.to}`} />
      <div class="login card stack-card">
        <h1 class="first">{props.approved ? `${props.clientName} is connected` : 'Not connected'}</h1>
        <p>
          Going back to {props.clientName}… <a href={props.to}>Continue</a>
        </p>
      </div>
    </Layout>
  );
}

export function OAuthErrorPage(props: { message: string }) {
  return (
    <Layout title="Connect an app">
      <div class="login card stack-card">
        <h1 class="first">Cannot connect</h1>
        <p>{props.message}</p>
        <p>
          <a href="/">Back to the app</a>
        </p>
      </div>
    </Layout>
  );
}
