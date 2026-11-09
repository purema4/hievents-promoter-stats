import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client, createPromoter, describeIntegration, signInAdmin, startServer, text, type Server } from './harness';

/*
 * "Ask Claude", against a stand-in for the Claude API (ANTHROPIC_BASE_URL), so the tests spend
 * nothing. What the app sends is checked, and what comes back goes through the usual rule checks.
 */
describeIntegration('rule writer', () => {
  let server: Server;
  let admin: Client;
  let db: Database;
  const requests: { auth: string | null; body: any }[] = [];
  let answer: () => Response = () => new Response('{}', { status: 500 });
  const message = (rule: string, note: string, stop = 'end_turn') =>
    Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify({ rule, note }) }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  const api = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ auth: req.headers.get('x-api-key') ?? req.headers.get('authorization'), body: await req.json() });
      return answer();
    },
  });

  beforeAll(async () => {
    server = await startServer({ ANTHROPIC_API_KEY: 'sk-test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` });
    admin = await signInAdmin(server);
    // Events show on Rules once a promoter has a code on them.
    await createPromoter(admin, { codes: 'DJMAX' });
    db = new Database(join(server.dataDir, 'promoters.sqlite'));
    // The server writes too (notifications, milestones…): wait for it rather than fail with SQLITE_BUSY.
    db.exec('PRAGMA busy_timeout = 5000');
    db.query("INSERT INTO reward_types (key, label_en, label_fr) VALUES ('vip_tickets', 'VIP', 'VIP'), ('ga_list', 'GA list', 'Liste GA')").run();
  }, 60_000);
  afterAll(async () => {
    db?.close();
    await server?.stop();
    api.stop(true);
  });

  const write = (description: string) => admin.post('/admin/rules/write?scope=event&event=1', { description });

  test('the deal goes to Claude; the rule comes back into the box, checked, not saved', async () => {
    const before = db.query<{ n: number }, []>('SELECT count(*) AS n FROM rule_versions').get()!.n;
    answer = () =>
      message(
        '# 2 VIP dès la première vente, 1 place GA par 5 billets, 5 $ par billet\ncommission = tickets_sold * 5.00\nvip_tickets = tickets_sold >= 1 ? 2 : 0\nga_list = floor(tickets_sold / 5)',
        'J’ai compté la place GA à partir de 5 billets vendus.',
      );
    expect(text(await admin.page('/admin/rules/edit?scope=event&event=1'))).toContain('Ask Claude');
    const res = await write('1 billet vendu = 2 VIP, puis 1 place liste GA par 5 billets, 5 $ par billet');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ga_list = floor(tickets_sold / 5)</textarea>');
    expect(text(html)).toContain('J’ai compté la place GA à partir de 5 billets vendus. Check it below, then save.');
    expect(text(html)).toContain('VIP: 2 from your first sale.');
    expect(db.query<{ n: number }, []>('SELECT count(*) AS n FROM rule_versions').get()!.n).toBe(before);

    const sent = requests.at(-1)!;
    expect(sent.auth).toContain('sk-test-key');
    expect(sent.body.model).toBe('claude-opus-5-5');
    expect(sent.body.output_config.format.type).toBe('json_schema');
    const prompt = sent.body.messages[0].content as string;
    expect(prompt).toContain('1 billet vendu = 2 VIP');
    expect(prompt).toContain('- tickets_sold (number)');
    expect(prompt).toContain('- vip_tickets: reward "VIP"');
  });

  test('from the Rules page: pick the rule, describe the deal', async () => {
    expect(text(await admin.page('/admin/rules'))).toContain('Ask Claude');
    answer = () => message('commission = tickets_sold * 4', 'Done.');
    const html = await (await admin.post('/admin/rules/write', { rule: 'event:1', description: '4 $ par billet' })).text();
    expect(text(html)).toContain('Warehouse Night: rule');
    expect(html).toContain('commission = tickets_sold * 4</textarea>');
    expect((await admin.post('/admin/rules/write', { rule: 'event:4', description: 'x' })).status).toBe(404); // over
  });

  test('a rule with a problem shows it, like a typed one', async () => {
    answer = () => message('commission = tickets * 5', 'Done.');
    const html = text(await (await write('5 $ par billet')).text());
    expect(html).toContain('Line 1: tickets is not a variable a rule can read.');
  });

  test('problems with Claude are said plainly, and the saved rule stays in the box', async () => {
    answer = () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
    let res = await write('5 $ par billet');
    expect(res.status).toBe(400);
    expect(text(await res.text())).toContain('ANTHROPIC_API_KEY was refused');
    answer = () => message('', '', 'refusal');
    res = await write('5 $ par billet');
    expect(text(await res.text())).toContain('Claude did not write this one');
    expect((await write('  ')).status).toBe(400);
  });

  test('promoters cannot use it', async () => {
    const promoter = new Client(server);
    expect((await promoter.post('/admin/rules/write?scope=default', { description: 'x' })).status).toBeGreaterThanOrEqual(300);
  });
});
