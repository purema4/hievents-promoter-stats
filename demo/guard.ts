/*
 * Imported first by demo/server.tsx, before the app opens anything. The demo wipes its databases on
 * every start and hands out admin access, so it only runs in its own image against its own database.
 */
const host = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
};

const problems = [
  process.env.DEMO_MODE === 'on' ? '' : 'DEMO_MODE is not on',
  host(process.env.DEMO_DATABASE_URL) === 'demo-db' ? '' : 'DEMO_DATABASE_URL is not the demo-db container',
  host(process.env.HIEVENTS_DATABASE_URL) === 'demo-db' ? '' : 'HIEVENTS_DATABASE_URL is not the demo-db container',
].filter(Boolean);

if (problems.length) {
  console.error(`Refusing to start the demo: ${problems.join('; ')}.`);
  process.exit(1);
}

export {};
