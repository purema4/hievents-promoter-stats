import { afterEach, describe, expect, test } from 'bun:test';
import {
  definitions,
  emailTypes,
  getReplyTo,
  getTemplate,
  isCustomized,
  renderEmail,
  resetTemplate,
  sampleVars,
  saveReplyTo,
  saveTemplate,
  type Template,
} from '../../src/email-templates';

const paragraphs = (html: string) => html.match(/<p style="margin:0 0 16px[^"]*">[\s\S]*?<\/p>/g) ?? [];

describe('renderEmail', () => {
  const template: Template = {
    subject: 'Payout for {{name}}: {{amount}}',
    heading: '<h1>Hello</h1> {{name}}',
    body: 'Typed by an admin: <img src=x onerror=alert(1)> & "quotes"\n\n**Amount:** {{amount}}\nSecond line\n\n{{note}}\n\nBye {{name}}',
    button: 'Open <b>it</b>',
  };
  const vars = { name: '<script>alert("x")</script>', amount: '$5.00', note: '', link: 'https://example.com/a?b=1&c="2"' };

  test('HTML typed into the template is shown as text', () => {
    const { html } = renderEmail('payout_paid', vars, template);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62; &#38; &#34;quotes&#34;');
    expect(html).toContain('&#60;h1&#62;Hello&#60;/h1&#62;');
    expect(html).toContain('Open &#60;b&#62;it&#60;/b&#62;');
  });

  test('placeholder values are escaped everywhere they appear', () => {
    const { html } = renderEmail('payout_paid', vars, template);
    expect(html).not.toContain('<script');
    expect(html).toContain('Bye &#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;');
    expect(html).toContain('href="https://example.com/a?b=1&#38;c=&#34;2&#34;"');
  });

  test('**bold** and single line breaks are kept', () => {
    const { html } = renderEmail('payout_paid', vars, template);
    expect(html).toContain('<strong style="color:#1b1b1a">Amount:</strong> $5.00<br>Second line');
  });

  test('a paragraph that is only an empty placeholder is dropped', () => {
    const { html } = renderEmail('payout_paid', vars, template);
    expect(paragraphs(html)).toHaveLength(3);
    const withNote = renderEmail('payout_paid', { ...vars, note: 'Reference: CA1234' }, template);
    expect(paragraphs(withNote.html)).toHaveLength(4);
  });

  test('the subject and the plain-text part', () => {
    const { subject, text } = renderEmail('payout_paid', vars, template);
    expect(subject).toBe('Payout for <script>alert("x")</script>: $5.00');
    expect(text).toContain('Amount: $5.00\nSecond line');
    expect(text).not.toContain('**');
    expect(text).not.toContain('<strong');
    expect(text).toContain('Open <b>it</b>: https://example.com/a?b=1&c="2"');
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.trimEnd().endsWith('http://127.0.0.1:3999')).toBe(true);
  });

  test('sign-in emails carry the code and the expiry, in both parts', () => {
    const { subject, html, text } = renderEmail('login', { name: 'Max', link: 'https://x/login/verify?token=t', code: '482913', expiry: '30 minutes' });
    expect(subject).toBe('Promoter stats sign-in code: 482913');
    expect(html).toContain('>482913</p>');
    expect(html).toContain('expire in 30 minutes');
    expect(text).toContain('Sign in: https://x/login/verify?token=t');
    expect(text).toContain('Enter this code instead: 482913');
  });

  test('without a link the button goes to the app', () => {
    const { html } = renderEmail('payout_declined', { name: 'Max', amount: '$1.00', note: 'No', link: '#' });
    expect(html).toContain('href="http://127.0.0.1:3999"');
  });

  test('an empty button label leaves the button out', () => {
    const { html, text } = renderEmail('new_signin', { name: 'A', device: 'Mac · Safari' }, { ...definitions.new_signin.defaults, button: ' ' });
    expect(html).not.toContain('border-radius:10px;background:');
    expect(text).not.toContain(': http://127.0.0.1:3999\n');
  });

  test('every default template renders with its sample values and no leftover placeholders', () => {
    for (const type of emailTypes) {
      const rendered = renderEmail(type, sampleVars(type, 'DJ Max'), definitions[type].defaults);
      expect(rendered.subject).not.toContain('{{');
      expect(rendered.html).not.toContain('{{');
      expect(rendered.text).not.toContain('{{');
      expect(rendered.subject.length).toBeGreaterThan(0);
    }
  });
});

describe('saved templates', () => {
  afterEach(() => resetTemplate('reward_given'));

  test('saving, reading and resetting', () => {
    expect(isCustomized('reward_given')).toBe(false);
    saveTemplate('reward_given', { subject: '  New {{reward}}  ', heading: 'Hi', body: 'Line 1\r\nLine 2', button: 'Go' });
    expect(isCustomized('reward_given')).toBe(true);
    expect(getTemplate('reward_given')).toEqual({ subject: 'New {{reward}}', heading: 'Hi', body: 'Line 1\nLine 2', button: 'Go' });
    resetTemplate('reward_given');
    expect(getTemplate('reward_given')).toEqual(definitions.reward_given.defaults);
  });

  test('an empty subject falls back to the default; long text is cut', () => {
    saveTemplate('reward_given', { subject: '   ', heading: 'h'.repeat(500), body: 'b'.repeat(5000), button: 'x'.repeat(100) });
    const t = getTemplate('reward_given');
    expect(t.subject).toBe(definitions.reward_given.defaults.subject);
    expect(t.heading).toHaveLength(200);
    expect(t.body).toHaveLength(4000);
    expect(t.button).toHaveLength(60);
  });

  test('reply-to is saved and cleared', () => {
    saveReplyTo(' team@example.com ');
    expect(getReplyTo()).toBe('team@example.com');
    saveReplyTo('');
    expect(getReplyTo()).toBe('');
  });
});
