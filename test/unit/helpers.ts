import { createUser, findUser, type User } from '../../src/local-db';
import type { EventSummary } from '../../src/promoter-views';

export async function newUser(name = 'Test Promoter', isAdmin = false): Promise<User> {
  const id = await createUser({ email: `${isAdmin ? 'admin' : 'promoter'}-${crypto.randomUUID()}@example.test`, name, isAdmin });
  return findUser(id)!;
}

const day = 86400_000;

export function event(id: number, tickets: number, daysFromNow: number, title = `Event ${id}`): EventSummary {
  const start = new Date(Date.now() + daysFromNow * day);
  return {
    id,
    title,
    start,
    end: new Date(start.getTime() + 6 * 3600_000),
    dates: 1,
    timezone: 'America/Toronto',
    hasCover: false,
    currency: 'CAD',
    codes: ['djmax'],
    rows: [],
    tickets,
    pending: 0,
    orders: tickets,
    fullPrice: tickets * 2500,
    paid: tickets * 2250,
    commission: tickets * 250,
  };
}
