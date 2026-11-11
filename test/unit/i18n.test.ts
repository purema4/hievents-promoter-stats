import { describe, expect, test } from 'bun:test';
import { lang, langFromHeader, locale, plural, t, withLang } from '../../src/i18n';
import { formatMoney } from '../../src/money';

describe('langFromHeader', () => {
  test('French when the browser prefers it, English otherwise', () => {
    expect(langFromHeader('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(langFromHeader('fr')).toBe('fr');
    expect(langFromHeader('en-CA,en;q=0.9,fr;q=0.8')).toBe('en');
    // By preference, not by order.
    expect(langFromHeader('en;q=0.5, fr;q=0.9')).toBe('fr');
    // Languages the app does not speak are skipped.
    expect(langFromHeader('es-MX,es;q=0.9,fr;q=0.5')).toBe('fr');
    expect(langFromHeader('de-DE')).toBe('en');
    expect(langFromHeader('fr;q=0, en')).toBe('en');
    expect(langFromHeader('')).toBe('en');
    expect(langFromHeader(undefined)).toBe('en');
    expect(langFromHeader('*')).toBe('en');
  });
});

describe('t, plural and formats', () => {
  test('English outside a request', () => {
    expect(lang()).toBe('en');
    expect(t('Copy', 'Copier')).toBe('Copy');
  });

  test('the language given, and back to English after', () => {
    withLang('fr', () => {
      expect(t('Copy', 'Copier')).toBe('Copier');
      expect(locale()).toBe('fr-CA');
      expect(formatMoney(31000, 'CAD').replace(/\s/g, ' ')).toBe('310,00 $');
    });
    expect(t('Copy', 'Copier')).toBe('Copy');
    expect(formatMoney(31000, 'CAD')).toBe('$310.00');
    // Unknown or missing: English.
    withLang(null, () => expect(lang()).toBe('en'));
  });

  test('plural: French counts 0 and 1 as singular', () => {
    const n = (k: number) => plural(k, ['ticket', 'billet'], ['tickets', 'billets']);
    expect([0, 1, 2].map(n)).toEqual(['0 tickets', '1 ticket', '2 tickets']);
    withLang('fr', () => expect([0, 1, 2].map(n)).toEqual(['0 billet', '1 billet', '2 billets']));
  });

  test('carries across awaits', async () => {
    await withLang('fr', async () => {
      await Bun.sleep(1);
      expect(lang()).toBe('fr');
    });
  });
});
