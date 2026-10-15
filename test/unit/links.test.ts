import { afterEach, describe, expect, test } from 'bun:test';
import { createUser, findUser } from '../../src/local-db';
import { aliasPattern, aliasTaken, defaultTemplate, eventLink, linkSettings, saveLinkSettings, setAlias, slugify, suggestAlias } from '../../src/links';

describe('slugify (Laravel Str::slug, which Hi.Events uses for event URLs)', () => {
  test.each([
    ['Warehouse Night', 'warehouse-night'],
    ['Marc-Antoine Carrière', 'marc-antoine-carriere'],
    ['Été à Montréal', 'ete-a-montreal'],
    ['  Winter   Opening  ', 'winter-opening'],
    ['Rock & Roll', 'rock-roll'],
    ['Drinks @ The Bar', 'drinks-at-the-bar'],
    ['DJ_Max -- Live!', 'dj-max-live'],
    ['2026 New Year', '2026-new-year'],
    ['Jazz—Soul', 'jazz-soul'],
    // Laravel removes punctuation other than dashes, underscores and spaces instead of turning it into a dash.
    ["Nuit d'été", 'nuit-dete'],
    ['L’After', 'lafter'],
    ['Hi.Events 2.0', 'hievents-20'],
    ['Cœur & Âme', 'coeur-ame'],
    ['Straße', 'strasse'],
    ['!!!', ''],
  ])('%p → %p', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});

describe('eventLink', () => {
  const event = { id: 12, title: 'Marc-Antoine Carrière' };
  afterEach(() => saveLinkSettings('https://tickets.example.com', defaultTemplate));

  test('uses the public Hi.Events address and the default template', () => {
    expect(linkSettings()).toEqual({ baseUrl: 'https://tickets.example.com', template: defaultTemplate });
    expect(eventLink(event, 'DJMAX', 'dj-max')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=DJMAX&aff=dj-max');
  });

  test('encodes the code and the alias', () => {
    expect(eventLink(event, 'A&B C', 'x y')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=A%26B%20C&aff=x%20y');
  });

  test('a title without letters still gets a path segment', () => {
    expect(eventLink({ id: 3, title: '!!!' }, 'X', 'a1')).toBe('https://tickets.example.com/event/3/event?promo_code=X&aff=a1');
  });

  test('a template written with a second "?" still gives a valid address', () => {
    saveLinkSettings('https://tickets.example.com/', '{event_url}?promo_code={code}?aff={alias}');
    expect(eventLink(event, 'DJMAX', 'dj-max')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=DJMAX&aff=dj-max');
  });

  test('an empty alias drops aff= instead of sending it empty', () => {
    expect(eventLink(event, 'DJMAX', '')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=DJMAX');
    expect(eventLink(event, 'DJMAX', null)).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=DJMAX');
  });

  test('an empty alias drops aff= wherever it is in the template', () => {
    saveLinkSettings('https://tickets.example.com', '{event_url}?aff={alias}&promo_code={code}');
    expect(eventLink(event, 'DJMAX', '')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?promo_code=DJMAX');
    saveLinkSettings('https://tickets.example.com', '{event_url}?utm=x&aff={alias}&promo_code={code}');
    expect(eventLink(event, 'DJMAX', '')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere?utm=x&promo_code=DJMAX');
    saveLinkSettings('https://tickets.example.com', '{event_url}?aff={alias}');
    expect(eventLink(event, 'DJMAX', '')).toBe('https://tickets.example.com/event/12/marc-antoine-carriere');
  });

  test('an empty template falls back to the default', () => {
    saveLinkSettings('https://tickets.example.com', '   ');
    expect(linkSettings().template).toBe(defaultTemplate);
  });

  test('no link without a site address', () => {
    saveLinkSettings('', defaultTemplate);
    expect(eventLink(event, 'DJMAX', 'dj-max')).toBeNull();
  });
});

describe('aliases', () => {
  test('the alias pattern', () => {
    expect(aliasPattern.test('dj-max')).toBe(true);
    expect(aliasPattern.test('dj_max_2')).toBe(true);
    expect(aliasPattern.test('a')).toBe(false);
    expect(aliasPattern.test('-max')).toBe(false);
    expect(aliasPattern.test('dj max')).toBe(false);
    expect(aliasPattern.test('x'.repeat(31))).toBe(false);
  });

  test('suggestAlias is made from the name and avoids taken aliases, case-insensitively', async () => {
    const first = await createUser({ email: `alias-1-${crypto.randomUUID()}@example.test`, name: 'Zed Alias', isAdmin: false });
    const second = await createUser({ email: `alias-2-${crypto.randomUUID()}@example.test`, name: 'Zed Alias', isAdmin: false });
    expect(suggestAlias('Zed Alias', first)).toBe('zed-alias');
    setAlias(first, 'Zed-Alias');
    expect(findUser(first)!.alias).toBe('zed-alias');
    expect(aliasTaken('ZED-ALIAS', second)).toBe(true);
    expect(aliasTaken('zed-alias', first)).toBe(false);
    expect(suggestAlias('Zed Alias', second)).toBe('zed-alias-2');
    expect(suggestAlias('!', second)).toBe('promoter');
  });
});
