import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { User } from './local-db';

/*
 * Canadian places (public/places.json, from GeoNames, built by dev/build-places.ts), for suggesting a city
 * as promoters type it (in the browser, from the same file: no outside service) and for putting promoters
 * on the map. A promoter's city is free text: "Montreal", "montréal, qc" and "Montréal, QC" all find
 * Montréal; text that matches no place stays as typed and is simply not on the map.
 */
export type Place = { name: string; province: string; lat: number; lng: number; label: string };

const raw = readFileSync(join(import.meta.dir, '..', 'public', 'places.json'));
export const placesVersion = new Bun.CryptoHasher('sha256').update(raw).digest('hex').slice(0, 10);

const provinceNames: Record<string, string> = {
  alberta: 'AB', 'british columbia': 'BC', 'colombie britannique': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  'nouveau brunswick': 'NB', newfoundland: 'NL', 'newfoundland and labrador': 'NL', 'terre neuve et labrador': 'NL',
  'nova scotia': 'NS', 'nouvelle ecosse': 'NS', ontario: 'ON', 'prince edward island': 'PE', 'ile du prince edouard': 'PE',
  quebec: 'QC', saskatchewan: 'SK', yukon: 'YT', 'northwest territories': 'NT', 'territoires du nord ouest': 'NT', nunavut: 'NU',
};

/** Lower case, no accents or punctuation: "Saint-Jérôme" → "saint jerome". */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const byName = new Map<string, Place>(); // the most populous place of that name
const byNameAndProvince = new Map<string, Place>();
for (const [name, province, lat, lng] of JSON.parse(raw.toString()) as [string, string, number, number, number][]) {
  const place = { name, province, lat, lng, label: `${name}, ${province}` };
  const key = normalize(name);
  if (!byName.has(key)) byName.set(key, place);
  byNameAndProvince.set(`${key}|${province}`, place);
}

/** The place a city typed by a promoter refers to, or null. */
export function findPlace(city: string | null | undefined): Place | null {
  if (!city?.trim()) return null;
  const parts = city.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && normalize(parts.at(-1)!) === 'canada') parts.pop();
  if (parts.length > 1) {
    const last = normalize(parts.at(-1)!);
    const province = provinceNames[last] ?? last.toUpperCase();
    const found = byNameAndProvince.get(`${normalize(parts.slice(0, -1).join(' '))}|${province}`);
    if (found) return found;
  }
  return byName.get(normalize(parts.join(' '))) ?? null;
}

/** "Montréal, QC" for anything that finds Montréal; other text as typed. */
export const tidyCity = (city: string | null) => (city ? (findPlace(city)?.label ?? city) : null);

export type MapPoint = { label: string; lat: number; lng: number; users: User[] };
export type PromoterMap = { points: MapPoint[]; noCity: User[]; unknown: User[] };

/** Where these promoters are, by place (most promoters first), for the map; and who has no city, or one not found. */
export function promoterMap(users: User[]): PromoterMap {
  const points = new Map<string, MapPoint>();
  const noCity: User[] = [];
  const unknown: User[] = [];
  for (const user of users) {
    if (!user.city?.trim()) {
      noCity.push(user);
      continue;
    }
    const place = findPlace(user.city);
    if (!place) {
      unknown.push(user);
      continue;
    }
    const point = points.get(place.label) ?? { label: place.label, lat: place.lat, lng: place.lng, users: [] };
    point.users.push(user);
    points.set(place.label, point);
  }
  return { points: [...points.values()].sort((a, b) => b.users.length - a.users.length || a.label.localeCompare(b.label)), noCity, unknown };
}
