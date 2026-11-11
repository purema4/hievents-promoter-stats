import type { ApiToken } from './api-tokens';
import { MAX_KEYS } from './api-tokens';
import { canUse, ops, type Op } from './api-ops';
import { getBrand } from './brand';
import { config } from './config';
import { t } from './i18n';
import type { User } from './local-db';
import { isTeamLead } from './teams';
import { Flash, Layout, since } from './views';

// When a key was made or an app connected: "just now", "3 h ago", or the date.
const made = (epoch: number) => (Date.now() / 1000 - epoch < 150 ? t('just now', 'à l’instant') : since(epoch));

const mcpUrl = `${config.appUrl}/mcp`;
const apiUrl = `${config.appUrl}/api/v1`;

function CopyField(props: { value: string; label: string }) {
  return (
    <div class="link-field">
      <input readonly value={props.value} aria-label={props.label} />
      <button type="button" class="secondary small" data-copy>
        {t('Copy', 'Copier')}
      </button>
    </div>
  );
}

/** What changes a key or connection allowed to make them can make, for this person. */
function changesFor(user: User): string {
  if (user.is_admin)
    return t(
      'mark payouts paid or declined, give or decline rewards, add promoters, change their codes and set commissions',
      'marquer les paiements comme payés ou refusés, donner ou refuser des récompenses, ajouter des promoteurs, changer leurs codes et fixer les commissions',
    );
  return t('request payouts and rewards for you', 'demander des paiements et des récompenses à ta place');
}

function whatItSees(user: User): string {
  if (user.is_admin) return t('every promoter: sales, balances, payouts, rewards, promo codes and events', 'chaque promoteur : ventes, soldes, paiements, récompenses, codes promo et événements');
  if (isTeamLead(user)) return t("your sales and balance, and your team's", 'tes ventes et ton solde, et ceux de ton équipe');
  return t('your sales, balance, payouts, rewards and links', 'tes ventes, ton solde, tes paiements, tes récompenses et tes liens');
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
        {t(
          `Let Claude, or a program of your own, read ${whatItSees(u)}. It acts as you and sees only what you see here.`,
          `Laisse Claude, ou un programme à toi, lire ${whatItSees(u)}. Il agit en ton nom et voit seulement ce que tu vois ici.`,
        )}
      </p>
      <Flash ok={props.ok} error={props.error} />

      {props.newKey && (
        <div class="card stack-card">
          <h2 class="first">
            {t('Your new key:', 'Ta nouvelle clé :')} {props.newKey.name}
          </h2>
          <p>
            {t('Copy it now and keep it somewhere safe, like a password manager.', 'Copie-la maintenant et garde-la en lieu sûr, comme dans un gestionnaire de mots de passe.')}{' '}
            <strong>{t('It is shown only once.', 'Elle n’est affichée qu’une seule fois.')}</strong>{' '}
            {t('Anyone who has it can use it as you.', 'Quiconque l’a peut l’utiliser en ton nom.')}
          </p>
          <CopyField value={props.newKey.key} label={t('API key', 'Clé API')} />
        </div>
      )}

      <h2>{t('Connect Claude', 'Connecter Claude')}</h2>
      <div class="card stack-card">
        <p>
          {t(
            'Ask Claude things like “how many tickets did I sell this week?” or “which events are my best?”.',
            'Demande à Claude des choses comme « combien de billets j’ai vendus cette semaine? » ou « quels sont mes meilleurs événements? ».',
          )}
        </p>
        <CopyField value={mcpUrl} label={t('Server address', 'Adresse du serveur')} />
        <p>
          <strong>{t('Claude on the web, desktop or phone:', 'Claude sur le web, l’ordinateur ou le téléphone :')}</strong>{' '}
          {t(
            'Settings → Connectors → Add custom connector. Paste the address above, then Connect. You sign in here and choose what Claude may do.',
            'Paramètres → Connecteurs → Ajouter un connecteur personnalisé. Colle l’adresse ci-dessus, puis Connecter. Tu te connectes ici et tu choisis ce que Claude peut faire.',
          )}
        </p>
        <p>
          <strong>Claude Code{t(':', ' :')}</strong> {t('run', 'lance')} <code>claude mcp add --transport http promoter-stats {mcpUrl}</code>
          {t(', then type ', ', puis tape ')}
          <code>/mcp</code> {t('in Claude Code to sign in.', 'dans Claude Code pour te connecter.')}
        </p>
        <p class="muted">
          {t('Other apps that support MCP connect the same way, or with an API key below.', 'Les autres applis compatibles MCP se connectent de la même façon, ou avec une clé API ci-dessous.')}
        </p>
      </div>

      <h2>{t('Connected apps', 'Applis connectées')}</h2>
      {apps.length === 0 ? (
        <p class="muted">{t('No apps connected.', 'Aucune appli connectée.')}</p>
      ) : (
        <div class="device-list">
          {apps.map((k) => (
            <div class="card device">
              <div>
                <strong>
                  {k.name} <span class={k.can_write ? 'badge edited' : 'badge'}>{k.can_write ? t('Read and change', 'Lecture et modification') : t('Read only', 'Lecture seule')}</span>
                </strong>
                <span class="muted">
                  {t('Connected', 'Connectée')} {made(k.created_at)} · {t('last used', 'dernière utilisation :')} {since(k.last_used_at)}
                </span>
              </div>
              <form method="post" action={`/account/api/${k.id}/remove`}>
                <button class="secondary small" type="submit">
                  {t('Disconnect', 'Déconnecter')}
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      <h2>{t('API keys', 'Clés API')}</h2>
      {keys.length > 0 && (
        <div class="device-list">
          {keys.map((k) => (
            <div class="card device">
              <div>
                <strong>
                  {k.name} <span class={k.can_write ? 'badge edited' : 'badge'}>{k.can_write ? t('Read and change', 'Lecture et modification') : t('Read only', 'Lecture seule')}</span>
                </strong>
                <span class="muted">
                  {t('Ends in', 'Se termine par')} …{k.hint} · {t('made', 'créée')} {made(k.created_at)} · {t('last used', 'dernière utilisation :')}{' '}
                  {k.last_used_at ? since(k.last_used_at) : t('never', 'jamais')} ·{' '}
                  {k.expires_at
                    ? t(`works until ${new Date(k.expires_at * 1000).toISOString().slice(0, 10)}`, `valide jusqu’au ${new Date(k.expires_at * 1000).toISOString().slice(0, 10)}`)
                    : t('never expires', 'n’expire jamais')}
                </span>
              </div>
              <form method="post" action={`/account/api/${k.id}/remove`}>
                <button class="secondary small" type="submit">
                  {t('Remove', 'Retirer')}
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
      {keys.length < MAX_KEYS ? (
        <form class="card stack-card" method="post" action="/account/api/keys">
          <label>
            {t('Name, to remember what it is for', 'Nom, pour te rappeler à quoi elle sert')}
            <input name="name" maxlength={60} placeholder={t('Sales sheet', 'Tableau des ventes')} required />
          </label>
          <label>
            {t('Works for', 'Valide pendant')}
            <select name="days">
              <option value="30">{t('30 days', '30 jours')}</option>
              <option value="90" selected>
                {t('90 days', '90 jours')}
              </option>
              <option value="365">{t('1 year', '1 an')}</option>
              <option value="never">{t('Until I remove it', 'Jusqu’à ce que je la retire')}</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="can_write" value="1" /> {t('Can also make changes:', 'Peut aussi faire des changements :')} {changesFor(u)}
          </label>
          <button type="submit">{t('Make a key', 'Créer une clé')}</button>
        </form>
      ) : (
        <p class="muted">
          {t(
            `You have ${MAX_KEYS} keys, the most there can be. Remove one to make another.`,
            `Tu as ${MAX_KEYS} clés, le maximum possible. Retires-en une pour en créer une autre.`,
          )}
        </p>
      )}

      <h2>{t('Using the API', 'Utiliser l’API')}</h2>
      <div class="card stack-card api-docs">
        <p>
          {t('Send the key in the', 'Envoie la clé dans l’en-tête')} <code>Authorization</code>
          {t(
            ' header. Answers are JSON; money is in cents, with its currency.',
            '. Les réponses sont en JSON; les montants sont en cents, avec leur devise.',
          )}
        </p>
        <CopyField value={`curl -H "Authorization: Bearer YOUR_KEY" ${apiUrl}/stats`} label={t('Example', 'Exemple')} />
        <p class="muted">
          {t('The full description, for tools that read OpenAPI:', 'La description complète, pour les outils qui lisent OpenAPI :')}{' '}
          <a href="/api/v1/openapi.json">{apiUrl}/openapi.json</a>.{' '}
          {t(
            'Limits, for all your keys and apps together: 120 calls a minute, 60 changes an hour.',
            'Limites, pour toutes tes clés et applis ensemble : 120 appels par minute, 60 changements par heure.',
          )}
        </p>
        <div class="table-wrap">
          <table class="activity">
            <thead>
              <tr>
                <th>{t('Call', 'Appel')}</th>
                <th>{t('What it does', 'Ce qu’il fait')}</th>
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
                    {op.write ? <span class="muted"> {t('Needs a key that can make changes.', 'Demande une clé qui peut faire des changements.')}</span> : ''}
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
    <Layout title={t('Connect an app', 'Connecter une appli')}>
      <div class="login card stack-card">
        <h1 class="first">{t(`Connect ${props.clientName}?`, `Connecter ${props.clientName}?`)}</h1>
        <p>
          <strong>{props.clientName}</strong> ({host}) {t(`wants to use ${getBrand().name} as`, `veut utiliser ${getBrand().name} en tant que`)}{' '}
          <strong>{props.user.name}</strong>. {t(`It could read ${whatItSees(props.user)}.`, `Elle pourrait lire ${whatItSees(props.user)}.`)}
        </p>
        <p class="muted">
          {t(
            'Only connect apps you just added yourself. You can disconnect it any time under Account → API & Claude.',
            'Connecte seulement des applis que tu viens d’ajouter toi-même. Tu peux la déconnecter n’importe quand sous Compte → API & Claude.',
          )}
        </p>
        <form class="stack" method="post" action="/oauth/authorize">
          <input type="hidden" name="client_id" value={r.clientId} />
          <input type="hidden" name="redirect_uri" value={r.redirectUri} />
          <input type="hidden" name="state" value={r.state} />
          <input type="hidden" name="code_challenge" value={r.codeChallenge} />
          <label class="check">
            <input type="checkbox" name="can_write" value="1" /> {t('Also let it make changes:', 'La laisser aussi faire des changements :')} {changesFor(props.user)}
          </label>
          <button type="submit" name="answer" value="approve">
            {t('Connect', 'Connecter')}
          </button>
          <button class="secondary" type="submit" name="answer" value="deny">
            {t('Cancel', 'Annuler')}
          </button>
        </form>
      </div>
    </Layout>
  );
}

// The browser goes back to the app by itself (a form cannot be redirected to another site under the CSP).
export function OAuthRedirectPage(props: { to: string; clientName: string; approved: boolean }) {
  return (
    <Layout title={t('Connect an app', 'Connecter une appli')}>
      <meta http-equiv="refresh" content={`0;url=${props.to}`} />
      <div class="login card stack-card">
        <h1 class="first">{props.approved ? t(`${props.clientName} is connected`, `${props.clientName} est connectée`) : t('Not connected', 'Pas connectée')}</h1>
        <p>
          {t(`Going back to ${props.clientName}…`, `Retour à ${props.clientName}…`)} <a href={props.to}>{t('Continue', 'Continuer')}</a>
        </p>
      </div>
    </Layout>
  );
}

export function OAuthErrorPage(props: { message: string }) {
  return (
    <Layout title={t('Connect an app', 'Connecter une appli')}>
      <div class="login card stack-card">
        <h1 class="first">{t('Cannot connect', 'Connexion impossible')}</h1>
        <p>{props.message}</p>
        <p>
          <a href="/">{t('Back to the app', 'Retour à l’appli')}</a>
        </p>
      </div>
    </Layout>
  );
}
