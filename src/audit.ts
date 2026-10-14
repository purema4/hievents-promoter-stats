import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

// One JSON line per security-relevant event, on stdout so `docker logs` and any log shipper pick it up.
export function audit(c: Context, event: string, details: Record<string, unknown> = {}) {
  let ip: string | undefined;
  try {
    ip = getConnInfo(c).remote.address;
  } catch {
    ip = undefined;
  }
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      event,
      ip,
      // Only meaningful behind a reverse proxy you control; clients can set it themselves.
      forwardedFor: c.req.header('x-forwarded-for'),
      ...details,
    }),
  );
}
