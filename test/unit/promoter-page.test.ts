import { describe, expect, test } from 'bun:test';
import { setAlias } from '../../src/links';
import { findUser, type User } from '../../src/local-db';
import { instagramHandle, pageOwner, setPageHidden } from '../../src/promoter-page';
import { newUser } from './helpers';

describe('instagramHandle', () => {
  test.each([
    ['@nova.star', 'nova.star'],
    ['nova_star', 'nova_star'],
    [' @Nova ', 'Nova'],
    ['https://instagram.com/nova', null],
    ['nova star', null],
    ['@', null],
    [null, null],
  ])('%p → %p', (instagram, handle) => {
    expect(instagramHandle({ instagram } as User)).toBe(handle);
  });
});

describe('pageOwner', () => {
  test('found by alias, unless the page is hidden', async () => {
    const user = await newUser();
    const alias = `page-${crypto.randomUUID().slice(0, 8)}`;
    setAlias(user.id, alias);
    expect(pageOwner(alias)?.id).toBe(user.id);
    expect(pageOwner(alias.toUpperCase())).toBeNull();
    expect(pageOwner(`${alias}'--`)).toBeNull();
    setPageHidden(user.id, true);
    expect(findUser(user.id)!.page_hidden_at).toBeGreaterThan(0);
    expect(pageOwner(alias)).toBeNull();
    setPageHidden(user.id, false);
    expect(pageOwner(alias)?.id).toBe(user.id);
  });
});
