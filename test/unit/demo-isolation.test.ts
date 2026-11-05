import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';

// The demo hands out admin access and wipes its data: it must stay out of what production runs.
test('the production image only gets src and public', () => {
  const copied = readFileSync('Dockerfile', 'utf8').split('\n').filter((line) => line.startsWith('COPY'));
  expect(copied.join('\n')).not.toContain('demo');
  expect(readFileSync('docker-compose.yml', 'utf8')).not.toContain('demo');
});

test('nothing in src knows about the demo', () => {
  for (const file of new Glob('src/**/*.{ts,tsx}').scanSync()) {
    const text = readFileSync(file, 'utf8');
    expect(`${file}: ${/__demo|DEMO_|from '\.\.\/demo/.test(text)}`).toBe(`${file}: false`);
  }
});
