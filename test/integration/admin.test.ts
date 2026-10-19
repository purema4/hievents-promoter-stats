import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client, describeIntegration, location, newPromoter, signInAdmin, startServer, text, uid, waitForSubject, type Server } from './harness';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

describeIntegration('admin pages', () => {
  let server: Server;
  let admin: Client;

  beforeAll(async () => {
    server = await startServer();
    admin = await signInAdmin(server);
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  describe('email templates', () => {
    const template = {
      subject: 'Code {{code}} for {{name}}',
      heading: '<b>Welcome</b> {{name}}',
      body: 'Hello <script>alert(1)</script> & co\n\n**Bold** words\n\n{{nothing}}\n\nLast paragraph',
      button: 'Go <now>',
    };

    test('saving keeps HTML as text in the editor and in the preview', async () => {
      const saved = await admin.post('/admin/emails/login', { ...template, action: 'save' });
      expect(location(saved)).toBe('/admin/emails/login?ok=saved');

      const editor = await admin.page('/admin/emails/login');
      expect(editor).not.toContain('<script>alert(1)</script>');
      expect(editor).toContain('Hello &lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
      expect(editor).toContain('src="/admin/emails/login/preview?v=');

      const res = await admin.get('/admin/emails/login/preview');
      expect(res.status).toBe(200);
      const preview = await res.text();
      expect(preview).not.toContain('<script');
      expect(preview).toContain('Hello &#60;script&#62;alert(1)&#60;/script&#62; &#38; co');
      expect(preview).toContain('&#60;b&#62;Welcome&#60;/b&#62; Admin');
      expect(preview).toContain('<strong style="color:#1b1b1a">Bold</strong> words');
      expect(preview).toContain('Go &#60;now&#62;');
      // The empty {{nothing}} paragraph is dropped: Hello, Bold, Last.
      expect(preview.match(/<p style="margin:0 0 16px/g)).toHaveLength(3);
      expect(preview).toContain('482913'); // the sample code
    });

    test('the preview has its own policy: inline styles for the email, still no scripts, framed only here', async () => {
      const res = await admin.get('/admin/emails/login/preview');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("style-src 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toContain('script-src');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    });

    test('names typed by people are escaped in the preview', async () => {
      const page = await admin.page('/admin/promoters/1');
      const alias = page.match(/name="alias" value="([^"]+)"/)![1]!;
      const renamed = await admin.post('/admin/promoters/1', { name: '<img src=x onerror=alert(1)>', email: server.adminEmail, is_admin: '1', alias, codes: '' });
      expect(location(renamed)).toBe('/admin/promoters/1?ok=saved');
      const preview = await (await admin.get('/admin/emails/login/preview')).text();
      expect(preview).not.toContain('<img src=x');
      expect(preview).toContain('&#60;b&#62;Welcome&#60;/b&#62; &#60;img src=x onerror=alert(1)&#62;');
      // The admin pages escape it too.
      expect(await admin.page('/admin')).not.toContain('<img src=x');
      await admin.post('/admin/promoters/1', { name: 'Admin', email: server.adminEmail, is_admin: '1', alias, codes: '' });
    });

    test('"save and send me a test" sends the saved wording through SMTP', async () => {
      const subject = `Test ${uid()} {{code}}`;
      const res = await admin.post('/admin/emails/login', { ...template, subject, action: 'test' });
      expect(location(res)).toBe('/admin/emails/login?ok=test_sent');
      const mail = await waitForSubject(server.adminEmail, subject.replace('{{code}}', '482913'));
      expect(mail.HTML).not.toContain('<script');
      expect(mail.HTML).toContain('&#60;script&#62;');
      expect(mail.Text).toContain('Hello <script>alert(1)</script> & co');
      expect(mail.Text).not.toContain('**');
      expect(text(await admin.page('/admin/emails'))).toContain(subject.replace('{{code}}', '482913'));
    });

    test('reset brings the default wording back; unknown types do not exist', async () => {
      expect(location(await admin.post('/admin/emails/login', { action: 'reset' }))).toBe('/admin/emails/login?ok=reset');
      const preview = await (await admin.get('/admin/emails/login/preview')).text();
      expect(preview).toContain('Sign in to Promoter stats');
      expect((await admin.get('/admin/emails/nope')).status).toBe(404);
      expect((await admin.get('/admin/emails/nope/preview')).status).toBe(404);
      expect((await admin.post('/admin/emails/nope', { action: 'save' })).status).toBe(404);
    });

    test('the reply-to address must look like an email', async () => {
      expect(location(await admin.post('/admin/emails/settings', { reply_to: 'not an email' }))).toBe('/admin/emails?error=bad_email');
      expect(location(await admin.post('/admin/emails/settings', { reply_to: 'team@example.com' }))).toBe('/admin/emails?ok=saved');
    });
  });

  describe('notifications', () => {
    test('a test with no device says so, and is limited to one every 30 seconds', async () => {
      const promoter = await newPromoter(server, admin);
      const res = await promoter.client.post('/notifications/test');
      expect(location(res)).toBe('/notifications?test=none');
      const page = await promoter.client.page('/notifications?test=none');
      expect(page).toContain('no device has phone notifications turned on yet');
      expect(page).toContain('No device has phone notifications on yet.');
      expect(page).toContain('Test notification');
      expect(location(await promoter.client.post('/notifications/test'))).toBe('/notifications?test=soon');
    });

    test('only admins have alert settings', async () => {
      const promoter = await newPromoter(server, admin);
      expect((await promoter.client.post('/notifications/settings', { 'payout_requested:email': '1' })).status).toBe(403);
      expect(location(await admin.post('/notifications/settings', { 'payout_requested:app': '1' }))).toBe('/notifications?test=settings');
    });
  });

  describe('branding', () => {
    const brandingForm = (logo?: File) => {
      const form = new FormData();
      form.set('name', 'TechnoNacht');
      form.set('accent', '#7a1f1f');
      form.set('login_message', 'Welcome <b>back</b>');
      form.set('footer', 'Montréal');
      if (logo) form.set('logo', logo);
      return form;
    };

    test('an SVG logo is refused, a PNG is served back', async () => {
      const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'logo.png', { type: 'image/png' });
      expect(location(await admin.request('/admin/branding', { method: 'POST', body: brandingForm(svg) }))).toBe('/admin/branding?error=logo_type');
      expect((await admin.get('/brand/logo')).status).toBe(404);

      expect(location(await admin.request('/admin/branding', { method: 'POST', body: brandingForm(new File([png], 'logo.png')) }))).toBe('/admin/branding?ok=saved');
      const logo = await admin.get('/brand/logo');
      // Stored rebuilt as a PNG (src/images.ts).
      expect(logo.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await logo.arrayBuffer()).subarray(0, 8).equals(png.subarray(0, 8))).toBe(true);
    });

    test('the brand shows on the sign-in page, as text', async () => {
      const login = await new Client(server).page('/login');
      expect(login).toContain('Welcome &lt;b&gt;back&lt;/b&gt;');
      expect(login).toContain('TechnoNacht');
      const css = await (await new Client(server).get('/brand.css')).text();
      expect(css).toContain('--accent: #7a1f1f;');
    });

    test('only colours from the picker are accepted', async () => {
      const form = brandingForm();
      form.set('accent', 'red;}body{display:none');
      expect(location(await admin.request('/admin/branding', { method: 'POST', body: form }))).toBe('/admin/branding?error=bad_color');
    });
  });

  describe('event links', () => {
    test('promoters get links with the Hi.Events code and their alias once the site address is set', async () => {
      const promoter = await newPromoter(server, admin, { name: 'Marc-Antoine Carrière' });
      expect(await promoter.client.page('/events/1')).toContain('Links will show here once the team sets up');
      expect(location(await admin.post('/admin/links', { base_url: 'javascript:alert(1)', template: '' }))).toBe('/admin/links?error=bad_url');
      expect(location(await admin.post('/admin/links', { base_url: 'https://tickets.example.com/', template: '' }))).toBe('/admin/links?ok=saved');
      const page = await promoter.client.page('/events/1');
      expect(page).toContain('value="https://tickets.example.com/event/1/warehouse-night?promo_code=DJMAX&amp;aff=marc-antoine-carriere"');
    });
  });
});
