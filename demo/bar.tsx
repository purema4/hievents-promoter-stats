import type { User } from '../src/local-db';

export type BarProps = {
  user: User | null;
  personas: { label: string; user: User }[];
  people: User[];
  target: number | null;
  message: string | null;
  open: boolean;
  back: string;
  lang: 'fr' | 'en' | null; // chosen in the bar; null follows the browser
};

const roleOf = (u: User) => (u.is_admin ? 'admin' : u.is_team_lead ? "chef d'équipe" : u.team_lead_id ? 'promoteur (équipe)' : 'promoteur');

/** The debug bar, added at the end of every page. Plain forms: the strict CSP stays on, and it needs no script. */
export function DemoBar({ user, personas, people, target, message, open, back, lang }: BarProps) {
  return (
    <div id="demo-bar">
      <span class="demo-tag">DÉMO</span>
      <form method="post" action="/__demo/as" class="demo-personas">
        {personas.map((p) => (
          <button name="user" value={String(p.user.id)} class={p.user.id === user?.id ? 'demo-on' : ''}>
            {p.label}
          </button>
        ))}
      </form>
      {/* The app follows the browser's language; this picks one for the demo without changing the browser. */}
      <form method="post" action="/__demo/lang" class="demo-lang" aria-label="Langue">
        <input type="hidden" name="back" value={back} />
        {(
          [
            ['auto', 'Auto'],
            ['fr', 'FR'],
            ['en', 'EN'],
          ] as const
        ).map(([value, label]) => (
          <button name="lang" value={value} class={(lang ?? 'auto') === value ? 'demo-on' : ''}>
            {label}
          </button>
        ))}
      </form>
      {message ? <output class="demo-message">{message}</output> : null}
      <details class="demo-tools" open={open}>
        <summary>Actions</summary>
        <div class="demo-panel">
          <form method="post">
            <input type="hidden" name="back" value={back} />
            <label>
              Pour
              <select name="user">
                {people.map((p) => (
                  <option value={String(p.id)} selected={p.id === target}>
                    {p.name} · {roleOf(p)}
                  </option>
                ))}
              </select>
            </label>
            <div class="demo-row">
              <button formaction="/__demo/as">Se connecter comme</button>
            </div>
            <h4>Ventes</h4>
            <div class="demo-row">
              <button formaction="/__demo/sale?tickets=1">+1 billet</button>
              <button formaction="/__demo/sale?tickets=5">+5 billets</button>
              <button formaction="/__demo/sale?tickets=20">+20 billets</button>
              <button formaction="/__demo/level">Jusqu'au prochain niveau</button>
            </div>
            <h4>Demandes</h4>
            <div class="demo-row">
              <button formaction="/__demo/payout">Demander un paiement</button>
              <button formaction="/__demo/reward">Demander une récompense</button>
            </div>
            <h4>Tout le monde</h4>
            <div class="demo-row">
              <button formaction="/__demo/rush">Rafale de ventes</button>
              <button formaction="/__demo/reset" class="demo-danger">
                Réinitialiser la démo
              </button>
            </div>
          </form>
          <p class="demo-links">
            <a href="/p">Page publique /p</a>
            <a href="http://127.0.0.1:8028" target="_blank" rel="noreferrer">
              Courriels (Mailpit)
            </a>
          </p>
          <p class="demo-who">{user ? `Connecté : ${user.name} (${roleOf(user)})` : 'Pas connecté'}</p>
        </div>
      </details>
    </div>
  );
}
