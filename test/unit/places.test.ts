import { describe, expect, test } from 'bun:test';
import { findPlace, normalize, promoterMap, tidyCity } from '../../src/places';
import type { User } from '../../src/local-db';

describe('places', () => {
  test('a city is found however it is typed', () => {
    for (const typed of ['Montréal', 'montreal', 'MONTREAL, QC', 'Montréal, Québec', 'montreal, quebec, canada', ' Montréal ,QC ']) {
      expect(findPlace(typed)?.label).toBe('Montréal, QC');
    }
    expect(findPlace('Saint-Jérôme')?.label).toBe('Saint-Jérôme, QC');
    expect(findPlace('st jerome')).toBeNull(); // abbreviations are not guessed
  });

  test('the province picks between places of the same name; without it, the most populous', () => {
    expect(findPlace('London, ON')?.province).toBe('ON');
    expect(findPlace('Richmond, BC')?.province).toBe('BC');
    expect(findPlace('Richmond, QC')?.province).toBe('QC');
    expect(findPlace('Richmond')?.province).toBe('BC');
  });

  test('anything else is not found, and kept as typed', () => {
    expect(findPlace('Atlantis')).toBeNull();
    expect(findPlace('')).toBeNull();
    expect(findPlace(null)).toBeNull();
    expect(tidyCity('montreal')).toBe('Montréal, QC');
    expect(tidyCity('Atlantis')).toBe('Atlantis');
    expect(tidyCity(null)).toBeNull();
    expect(normalize('Saint-Jérôme, Québec')).toBe('saint jerome quebec');
  });

  test('promoters grouped by place, with who has no city or one not found', () => {
    const user = (name: string, city: string | null) => ({ name, city }) as User;
    const map = promoterMap([user('Ana', 'Montréal, QC'), user('Ben', 'montreal'), user('Cy', 'Laval'), user('Di', 'Atlantis'), user('Ed', null), user('Fe', '  ')]);
    expect(map.points.map((p) => [p.label, p.users.map((u) => u.name)])).toEqual([
      ['Montréal, QC', ['Ana', 'Ben']],
      ['Laval, QC', ['Cy']],
    ]);
    expect(map.points[0]).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(map.noCity.map((u) => u.name)).toEqual(['Ed', 'Fe']);
    expect(map.unknown.map((u) => [u.name, u.city])).toEqual([['Di', 'Atlantis']]);
  });
});
