import { describe, expect, test } from 'bun:test';
import { createUser, db, findUser } from '../../src/local-db';
import {
  _test,
  confirmSetup,
  disableTwoFactor,
  hasTwoFactor,
  newRecoveryCodes,
  pendingSecret,
  recoveryCodesLeft,
  startSetup,
  verifySecondFactor,
} from '../../src/two-factor';

const { hotp, base32Encode, base32Decode, seal, unseal } = _test;
const step = (seconds: number) => Math.floor(seconds / 30);
const nowStep = () => step(Date.now() / 1000);
const codeAt = (secret: string, s: number) => hotp(base32Decode(secret), s);

describe('TOTP (RFC 6238, SHA-1, 6 digits)', () => {
  // The RFC's SHA-1 seed is the ASCII string "12345678901234567890"; its 8-digit values end in these 6 digits.
  const seed = Buffer.from('12345678901234567890', 'ascii');
  test.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'], // counter above 32 bits
  ])('T=%p → %p', (t, code) => {
    expect(hotp(seed, step(t))).toBe(code);
  });

  test('the seed survives a base32 round trip', () => {
    expect(base32Encode(seed)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(hotp(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), step(59))).toBe('287082');
  });
});

describe('base32 (RFC 4648)', () => {
  test.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('%p ↔ %p', (text, encoded) => {
    expect(base32Encode(Buffer.from(text))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(text);
  });

  test('decoding ignores padding, case and spaces', () => {
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  test('random secrets round trip', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(1 + (i % 32)));
      expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
    }
  });
});

async function userWithTwoFactor() {
  const id = await createUser({ email: `2fa-${crypto.randomUUID()}@example.test`, name: 'Two Step', isAdmin: false });
  const secret = startSetup(id);
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(hasTwoFactor(findUser(id)!)).toBe(false);
  const s = nowStep();
  const recovery = confirmSetup(findUser(id)!, codeAt(secret, s));
  expect(recovery).not.toBeNull();
  return { id, secret, recovery: recovery!, confirmedStep: s };
}

describe('setting up two-step verification', () => {
  test('a wrong first code is refused and nothing is turned on', async () => {
    const id = await createUser({ email: `2fa-${crypto.randomUUID()}@example.test`, name: 'Two Step', isAdmin: false });
    const secret = startSetup(id);
    const wrong = codeAt(secret, nowStep() + 5);
    expect(confirmSetup(findUser(id)!, wrong)).toBeNull();
    expect(confirmSetup(findUser(id)!, 'abcdef')).toBeNull();
    expect(hasTwoFactor(findUser(id)!)).toBe(false);
  });

  test('confirming gives 10 recovery codes and turns it on', async () => {
    const { id, recovery } = await userWithTwoFactor();
    expect(recovery).toHaveLength(10);
    for (const code of recovery) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(new Set(recovery).size).toBe(10);
    expect(hasTwoFactor(findUser(id)!)).toBe(true);
    expect(findUser(id)!.totp_pending).toBeNull();
    expect(recoveryCodesLeft(id)).toBe(10);
  });
});

describe('verifySecondFactor', () => {
  test('accepts the next code from the app once, and refuses a replay', async () => {
    const { id, secret, confirmedStep } = await userWithTwoFactor();
    // The code used to confirm the setup is spent already.
    expect(verifySecondFactor(findUser(id)!, codeAt(secret, confirmedStep))).toBeNull();
    const next = codeAt(secret, confirmedStep + 1);
    expect(verifySecondFactor(findUser(id)!, next)).toBe('app');
    expect(verifySecondFactor(findUser(id)!, next)).toBeNull();
  });

  test('refuses a replay even with a user loaded before the first use (two requests at once)', async () => {
    const { id, secret, confirmedStep } = await userWithTwoFactor();
    const next = codeAt(secret, confirmedStep + 1);
    const loadedByRequestA = findUser(id)!;
    const loadedByRequestB = findUser(id)!;
    expect(verifySecondFactor(loadedByRequestA, next)).toBe('app');
    expect(verifySecondFactor(loadedByRequestB, next)).toBeNull();
  });

  test('refuses codes outside one step of drift, and anything that is not a code', async () => {
    const { id, secret, confirmedStep } = await userWithTwoFactor();
    expect(verifySecondFactor(findUser(id)!, codeAt(secret, confirmedStep + 3))).toBeNull();
    expect(verifySecondFactor(findUser(id)!, '')).toBeNull();
    expect(verifySecondFactor(findUser(id)!, '12345')).toBeNull();
    expect(verifySecondFactor(findUser(id)!, 'not a code')).toBeNull();
  });

  test('a code typed with spaces works', async () => {
    const { id, secret, confirmedStep } = await userWithTwoFactor();
    const next = codeAt(secret, confirmedStep + 1);
    expect(verifySecondFactor(findUser(id)!, ` ${next.slice(0, 3)} ${next.slice(3)} `)).toBe('app');
  });

  test('a recovery code works once, whatever its case and dashes', async () => {
    const { id, recovery } = await userWithTwoFactor();
    const [first, second] = recovery;
    expect(verifySecondFactor(findUser(id)!, first!.toUpperCase().replace('-', ''))).toBe('recovery');
    expect(verifySecondFactor(findUser(id)!, first!)).toBeNull();
    expect(verifySecondFactor(findUser(id)!, ` ${second!.toUpperCase()} `)).toBe('recovery');
    expect(recoveryCodesLeft(id)).toBe(8);
  });

  test("recovery codes belong to one account", async () => {
    const a = await userWithTwoFactor();
    const b = await userWithTwoFactor();
    expect(verifySecondFactor(findUser(b.id)!, a.recovery[0]!)).toBeNull();
  });

  test('new recovery codes replace the old ones', async () => {
    const { id, recovery } = await userWithTwoFactor();
    const fresh = newRecoveryCodes(id);
    expect(verifySecondFactor(findUser(id)!, recovery[0]!)).toBeNull();
    expect(verifySecondFactor(findUser(id)!, fresh[0]!)).toBe('recovery');
  });

  test('turning it off removes the secret and the recovery codes', async () => {
    const { id, secret, recovery, confirmedStep } = await userWithTwoFactor();
    disableTwoFactor(id);
    const user = findUser(id)!;
    expect(hasTwoFactor(user)).toBe(false);
    expect(user.totp_secret).toBeNull();
    expect(recoveryCodesLeft(id)).toBe(0);
    expect(verifySecondFactor(user, codeAt(secret, confirmedStep + 1))).toBeNull();
    expect(verifySecondFactor(user, recovery[0]!)).toBeNull();
  });
});

describe('secrets at rest (TWO_FACTOR_KEY is set in test/setup.ts)', () => {
  const stored = (id: number) =>
    db.query<{ totp_secret: string | null; totp_pending: string | null }, [number]>('SELECT totp_secret, totp_pending FROM users WHERE id = ?').get(id)!;

  test('the pending and confirmed secrets are stored encrypted', async () => {
    const id = await createUser({ email: `2fa-${crypto.randomUUID()}@example.test`, name: 'Two Step', isAdmin: false });
    const secret = startSetup(id);
    expect(stored(id).totp_pending).toMatch(/^v1:[A-Za-z0-9_-]+$/);
    expect(stored(id).totp_pending).not.toContain(secret);
    expect(pendingSecret(findUser(id)!)).toBe(secret);
    confirmSetup(findUser(id)!, codeAt(secret, nowStep()));
    expect(stored(id).totp_secret).toMatch(/^v1:/);
    expect(stored(id).totp_secret).not.toContain(secret);
  });

  test('each encryption is different, and only opens for its own account', () => {
    const a = seal(1, 'JBSWY3DPEHPK3PXP');
    expect(seal(1, 'JBSWY3DPEHPK3PXP')).not.toBe(a);
    expect(unseal(1, a)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => unseal(2, a)).toThrow();
    const tampered = a.slice(0, -2) + (a.endsWith('A') ? 'B' : 'A') + a.slice(-1);
    expect(() => unseal(1, tampered)).toThrow();
  });

  test('a secret copied onto another account does not give codes for it', async () => {
    const a = await userWithTwoFactor();
    const b = await userWithTwoFactor();
    db.query('UPDATE users SET totp_secret = ? WHERE id = ?').run(stored(a.id).totp_secret, b.id);
    expect(() => verifySecondFactor(findUser(b.id)!, codeAt(a.secret, a.confirmedStep + 1))).toThrow();
  });

  test('a secret stored before encryption still works', async () => {
    const { id, secret, confirmedStep } = await userWithTwoFactor();
    db.query('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, id);
    expect(verifySecondFactor(findUser(id)!, codeAt(secret, confirmedStep + 1))).toBe('app');
  });
});
