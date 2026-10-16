import { describe, expect, test } from 'bun:test';
import { pageAddress, readLink, shortAddress } from '../../src/short-links';

describe('shortAddress', () => {
  test("the event's first words and the alias", () => {
    expect(shortAddress('HALLOWEEN BLOOD RAVE [MONTREAL]', 'djmax')).toBe('halloween-blood-rave-djmax');
    expect(shortAddress('Warehouse Night', 'dj-max')).toBe('warehouse-night-dj-max');
    expect(shortAddress('Warehouse Night', 'dj-max', 3)).toBe('warehouse-night-dj-max-3');
  });

  test('stays short and within what Kutt accepts', () => {
    const long = shortAddress('PLEASUREKRAFT - BERLIN RECORDS X DAZE OTTAWA: OBSIDIAN - EPISODE 12', 'a-very-long-alias-of-thirty-ch', 5);
    expect(long).toBe('pleasurekraft-berlin-a-very-long-alias-of-thirty-ch-5');
    expect(long.length).toBeLessThanOrEqual(64);
    expect(shortAddress('Supercalifragilisticexpialidocious Night', 'x1')).toBe('supercalifragilisticexpi-x1');
    expect(shortAddress('Été à Montréal & co', 'Luna')).toBe('ete-a-montreal-co-luna');
    expect(shortAddress('!!!', 'luna')).toBe('event-luna');
    for (const address of [long, shortAddress('Ü / ß', '<script>')]) expect(address).toMatch(/^[a-z0-9_-]+$/);
  });
});

describe('readLink', () => {
  const id = '6f1c9a52-3b0e-4d6a-9a43-2f6c1f6f0b11';

  test('takes the id, the short link and the clicks', () => {
    expect(readLink({ id, link: 'https://outkzt.link/halloween-djmax', visit_count: 12, target: 'x' })).toEqual({
      id,
      link: 'https://outkzt.link/halloween-djmax',
      clicks: 12,
    });
    expect(readLink({ id, link: 'https://outkzt.link/a' })?.clicks).toBeNull();
  });

  test('refuses anything that is not a plain web address or a Kutt id', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,hi', '//outkzt.link/a', 'https://user:pass@outkzt.link/a', 'not a url', `https://outkzt.link/${'a'.repeat(300)}`]) {
      expect(readLink({ id, link })).toBeNull();
    }
    expect(readLink({ id: '../../admin', link: 'https://outkzt.link/a' })).toBeNull();
    expect(readLink({ link: 'https://outkzt.link/a' })).toBeNull();
    expect(readLink(null)).toBeNull();
    expect(readLink({ id, link: 'https://outkzt.link/a', visit_count: -1 })?.clicks).toBeNull();
  });
});

describe('pageAddress', () => {
  test("a promoter's page is on their alias", () => {
    expect(pageAddress('dj-max')).toBe('dj-max');
    expect(pageAddress('dj-max', 2)).toBe('dj-max-2');
    expect(pageAddress('')).toBe('promoter');
    expect(pageAddress('a/b?c')).toBe('abc');
  });
});
