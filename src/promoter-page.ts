import { upcomingEventsForCodes, type PageEvent } from './hievents';
import { aliasPattern } from './links';
import { addColumn, codesFor, db, type User } from './local-db';

/*
 * Each promoter's public page, /p/<alias>: like a link-in-bio page, it lists their upcoming events,
 * each with their link (promo code included). Anyone with the address can open it, so it shows only
 * what a promoter puts out anyway: their name, photo and Instagram, and the events. No sales figures.
 * Promoters can hide it on /page.
 */
addColumn('users', 'page_hidden_at', 'INTEGER');

/** The promoter whose page this is, or null when there is none or it is hidden. */
export function pageOwner(alias: string): User | null {
  if (!aliasPattern.test(alias)) return null;
  const user = db.query<User, [string]>('SELECT * FROM users WHERE lower(alias) = ?').get(alias);
  return user && !user.page_hidden_at ? user : null;
}

export function setPageHidden(userId: number, hidden: boolean) {
  db.query('UPDATE users SET page_hidden_at = ? WHERE id = ?').run(hidden ? Math.floor(Date.now() / 1000) : null, userId);
  cache.delete(userId);
}

/** An Instagram handle that can be linked to, without the "@", or null. */
export function instagramHandle(user: User): string | null {
  const handle = (user.instagram ?? '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

// Public pages can be opened a lot at once (a story, a bio link): the events are kept for a minute.
const cache = new Map<number, { events: PageEvent[]; at: number }>();
const TTL = 60 * 1000;
const MAX_ENTRIES = 500;

export async function pageEvents(user: User): Promise<PageEvent[]> {
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < TTL) return hit.events;
  const events = await upcomingEventsForCodes(codesFor(user.id));
  cache.delete(user.id);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(user.id, { events, at: Date.now() });
  return events;
}
