import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * The app speaks English and French. Each request runs in the language the browser asks for
 * (Accept-Language); code outside a request (timers, emails, push) picks the recipient's with
 * withLang(), from the language saved on their last visit (users.lang).
 *
 * Wording sits next to the markup, both languages together: t('Copy my link', 'Copier mon lien').
 * Only promoter-facing screens are translated; admin pages stay in English.
 */

export type Lang = 'en' | 'fr';

const store = new AsyncLocalStorage<Lang>();

/** The language of the request or task being handled; English outside of one. */
export function lang(): Lang {
  return store.getStore() ?? 'en';
}

/** Runs fn in a language: for work done for someone outside their own request. */
export function withLang<T>(language: Lang | null | undefined, fn: () => T): T {
  return store.run(language === 'fr' ? 'fr' : 'en', fn);
}

/** The English or French wording, in the current language. */
export function t(en: string, fr: string): string {
  return lang() === 'fr' ? fr : en;
}

/** "1 ticket" / "2 tickets", in the current language. French counts 0 and 1 as singular. */
export function plural(n: number, one: [en: string, fr: string], many: [en: string, fr: string]): string {
  const fr = lang() === 'fr';
  const single = fr ? n < 2 : n === 1;
  return `${n} ${(single ? one : many)[fr ? 1 : 0]}`;
}

/** The first of French or English in an Accept-Language header, by preference; English otherwise. */
export function langFromHeader(header: string | null | undefined): Lang {
  const wanted = (header ?? '')
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { base: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => (x.base === 'fr' || x.base === 'en') && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return wanted[0]?.base === 'fr' ? 'fr' : 'en';
}

/** The Intl locale for the current language. Canadian either way: dates and dollars as written here. */
export function locale(): string {
  return lang() === 'fr' ? 'fr-CA' : 'en-CA';
}
