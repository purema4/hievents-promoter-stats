// Started by test/unit/two-factor-startup.test.ts in a subprocess with its own DATA_DIR and TWO_FACTOR_KEY,
// so the app's startup check runs as it does in production.
import { createUser, db, findUser } from '../../src/local-db';
import { _test, confirmSetup, startSetup, verifySecondFactor } from '../../src/two-factor';

const step = () => Math.floor(Date.now() / 1000 / 30);
const code = (secret: string, s: number) => _test.hotp(_test.base32Decode(secret), s);
const stored = () => db.query<{ totp_secret: string }, []>('SELECT totp_secret FROM users').get()!.totp_secret;

if (process.argv[2] === 'setup') {
  const id = await createUser({ email: 'startup@example.test', name: 'Startup', isAdmin: false });
  const secret = startSetup(id);
  confirmSetup(findUser(id)!, code(secret, step() - 1));
  console.log(JSON.stringify({ secret, stored: stored() }));
} else {
  const user = db.query<{ id: number }, []>('SELECT id FROM users').get()!;
  // argv: check <secret> <steps from now>; the code is checked after the startup check above ran.
  const result = verifySecondFactor(findUser(user.id)!, code(process.argv[3]!, step() + Number(process.argv[4])));
  console.log(JSON.stringify({ result, stored: stored() }));
}
