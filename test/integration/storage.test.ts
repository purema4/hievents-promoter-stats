import { Database } from 'bun:sqlite';
import { S3Client } from 'bun';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { has, jpg, phoneJpeg, png } from '../fixtures/images';
import { Client, describeIntegration, location, newPromoter, signInAdmin, stack, startServer, uid, type Server } from './harness';

/*
 * Uploaded files (profile photos, the logo) in an S3 bucket (SeaweedFS here), with or without a CDN in front
 * of it, and moved there from the data volume when S3 is set up later. Each server gets its own folder
 * in the bucket (S3_PREFIX).
 */
const bucket = new S3Client({ ...stack.s3, region: 'us-east-1' });
const s3Env = (prefix: string, cdn = false): Record<string, string> => ({
  S3_BUCKET: stack.s3.bucket,
  S3_ENDPOINT: stack.s3.endpoint,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: stack.s3.accessKeyId,
  S3_SECRET_ACCESS_KEY: stack.s3.secretAccessKey,
  S3_PREFIX: prefix,
  ...(cdn ? { CDN_URL: `${stack.s3.endpoint}/${stack.s3.bucket}` } : {}),
});
const keysUnder = async (prefix: string) => ((await bucket.list({ prefix })).contents ?? []).map((o) => o.key);
// The bucket check and the move run in the background after startup.
async function waitForLog(server: Server, text: string) {
  const deadline = Date.now() + 10_000;
  while (!server.logs().includes(text) && Date.now() < deadline) await Bun.sleep(100);
  return server.logs();
}
const filesIn = (dir: string, sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)) : []);

function photoForm(image: Uint8Array<ArrayBuffer>, field = 'photo', extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set(field, new File([image], 'photo.jpg'));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}
const brand = { name: 'Brand', accent: '#2f5bea', login_message: '', footer: '' };

describeIntegration('files in an S3 bucket, served by the app', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  const prefix = `it-${uid()}/`;

  beforeAll(async () => {
    server = await startServer(s3Env(prefix));
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('the bucket is checked at startup', async () => {
    expect(await waitForLog(server, 'Uploaded files are stored')).toContain(`Uploaded files are stored in the S3 bucket ${stack.s3.bucket}.`);
  });

  test('a photo goes to the bucket, cleaned, under a key that cannot be guessed, and not to the disk', async () => {
    expect(location(await admin.request(`/admin/promoters/${maya.id}/photo`, { method: 'POST', body: photoForm(phoneJpeg(6)) }))).toBe(
      `/admin/promoters/${maya.id}?ok=photo_set#photo`,
    );
    const keys = await keysUnder(`${prefix}avatars/`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^${prefix}avatars/${maya.id}-[0-9a-f]{24}\\.jpg$`));
    const stored = new Uint8Array(await bucket.file(keys[0]!).arrayBuffer());
    expect(has(stored, 'SECRET')).toBe(false);
    expect(filesIn(server.dataDir, 'avatars')).toEqual([]);
    // Served by the app, which reads it from the bucket.
    const res = await maya.client.get(`/avatar/${maya.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(stored);
  });

  test('a new photo replaces the old file; removing it deletes it', async () => {
    const before = await keysUnder(`${prefix}avatars/`);
    await admin.request(`/admin/promoters/${maya.id}/photo`, { method: 'POST', body: photoForm(png) });
    const after = await keysUnder(`${prefix}avatars/`);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]).toEndWith('.jpg'); // photos are always stored as JPEG
    await admin.post(`/admin/promoters/${maya.id}/photo/remove`);
    expect(await keysUnder(`${prefix}avatars/`)).toEqual([]);
    expect((await maya.client.get(`/avatar/${maya.id}`)).status).toBe(404);
  });

  test('the logo too', async () => {
    expect(location(await admin.request('/admin/branding', { method: 'POST', body: photoForm(jpg, 'logo', brand) }))).toBe('/admin/branding?ok=saved');
    const keys = await keysUnder(`${prefix}brand/`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEndWith('.png'); // the logo is always stored as PNG
    const res = await new Client(server).get('/brand/logo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(await bucket.file(keys[0]!).arrayBuffer()));
    expect(filesIn(server.dataDir, 'brand')).toEqual([]);
    // Removed.
    await admin.request('/admin/branding', { method: 'POST', body: photoForm(new Uint8Array(0), 'logo', { ...brand, remove_logo: '1' }) });
    expect(await keysUnder(`${prefix}brand/`)).toEqual([]);
  });
});

describeIntegration('files in an S3 bucket, delivered by a CDN', () => {
  let server: Server;
  let admin: Client;
  let maya: Awaited<ReturnType<typeof newPromoter>>;
  let other: Awaited<ReturnType<typeof newPromoter>>;
  const prefix = `it-${uid()}/`;
  const cdn = `${stack.s3.endpoint}/${stack.s3.bucket}`;

  beforeAll(async () => {
    server = await startServer(s3Env(prefix, true));
    admin = await signInAdmin(server);
    maya = await newPromoter(server, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    other = await newPromoter(server, admin, { name: `Other ${uid()}`, codes: 'LUNA' });
    await admin.request(`/admin/promoters/${maya.id}/photo`, { method: 'POST', body: photoForm(jpg) });
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  test('the app checks who may see a photo, then sends the browser to the CDN', async () => {
    const res = await maya.client.get(`/avatar/${maya.id}`);
    expect(res.status).toBe(302);
    const address = location(res)!;
    expect(address).toMatch(new RegExp(`^${cdn}/${prefix}avatars/${maya.id}-[0-9a-f]{24}\\.jpg$`));
    expect(res.headers.get('cache-control')).toBe('private, max-age=604800');
    // The CDN address is the bucket file's: CDN_URL + its key.
    expect(await bucket.file(address.slice(cdn.length + 1)).exists()).toBe(true);
    // Someone not allowed gets nothing, not the address.
    const denied = await other.client.get(`/avatar/${maya.id}`);
    expect(denied.status).toBe(404);
    expect(location(denied)).toBeNull();
  });

  test('pages allow images from the CDN', async () => {
    const csp = (await maya.client.get('/')).headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(new RegExp(`img-src 'self' data: ${new URL(cdn).origin}`));
  });

  test('the logo and public page photos go through the CDN too', async () => {
    await admin.request('/admin/branding', { method: 'POST', body: photoForm(png, 'logo', brand) });
    const logo = await new Client(server).get('/brand/logo');
    expect(logo.status).toBe(302);
    expect(location(logo)).toStartWith(`${cdn}/${prefix}brand/logo-`);
    const alias = (await admin.page(`/admin/promoters/${maya.id}`)).match(/name="alias" value="([^"]+)"/)![1]!;
    const pagePhoto = await new Client(server).get(`/p/${alias}/avatar`);
    expect(pagePhoto.status).toBe(302);
    expect(location(pagePhoto)).toStartWith(`${cdn}/${prefix}avatars/`);
  });
});

describeIntegration('moving to S3 later', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-move-'));
  const prefix = `it-${uid()}/`;
  let promoterId = 0;
  let servers: Server[] = [];

  afterAll(async () => {
    for (const s of servers) await s.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('photos and the logo on the data volume are moved to the bucket on the next start', async () => {
    // First on disk.
    const local = await startServer({ DATA_DIR: dataDir });
    servers.push(local);
    let admin = await signInAdmin(local);
    const maya = await newPromoter(local, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
    promoterId = maya.id;
    await admin.request(`/admin/promoters/${maya.id}/photo`, { method: 'POST', body: photoForm(jpg) });
    await admin.request('/admin/branding', { method: 'POST', body: photoForm(png, 'logo', brand) });
    expect(filesIn(dataDir, 'avatars')).toHaveLength(1);
    expect(filesIn(dataDir, 'brand')).toHaveLength(1);
    const photoBefore = new Uint8Array(await (await admin.get(`/avatar/${maya.id}`)).arrayBuffer());
    const logoBefore = new Uint8Array(await (await new Client(local).get('/brand/logo')).arrayBuffer());
    await local.stop();
    servers = [];

    // Then with S3.
    const moved = await startServer({ DATA_DIR: dataDir, ...s3Env(prefix) });
    servers.push(moved);
    expect(await waitForLog(moved, 'Moved to the S3 bucket')).toContain('Moved to the S3 bucket: 1 profile photos and the logo.');
    expect(await keysUnder(`${prefix}avatars/`)).toHaveLength(1);
    expect(await keysUnder(`${prefix}brand/`)).toHaveLength(1);
    expect(filesIn(dataDir, 'avatars')).toEqual([]);
    expect(filesIn(dataDir, 'brand')).toEqual([]);
    admin = await signInAdmin(moved);
    const photo = await admin.get(`/avatar/${promoterId}`);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(photoBefore);
    expect(new Uint8Array(await (await new Client(moved).get('/brand/logo')).arrayBuffer())).toEqual(logoBefore);
  }, 60_000);
});

describeIntegration('storage settings', () => {
  test('without S3, a CDN_URL alone is ignored and files stay on disk', async () => {
    const server = await startServer({ CDN_URL: 'https://cdn.example.test' });
    try {
      expect(server.logs()).toContain('CDN_URL is ignored without S3_BUCKET');
      const admin = await signInAdmin(server);
      await admin.request('/admin/branding', { method: 'POST', body: photoForm(png, 'logo', brand) });
      const logo = await new Client(server).get('/brand/logo');
      expect(logo.status).toBe(200);
      expect(filesIn(server.dataDir, 'brand')).toHaveLength(1);
      expect((await admin.get('/admin')).headers.get('content-security-policy')).not.toContain('cdn.example.test');
    } finally {
      await server.stop();
    }
  });

  test('S3_BUCKET without its keys stops the app at startup', async () => {
    const error = await startServer({ S3_BUCKET: 'x', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' }).catch((err: Error) => err);
    expect(String(error)).toContain('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are needed');
  });

  test('a bucket that does not answer is reported, and the app still starts', async () => {
    const server = await startServer({ ...s3Env(`it-${uid()}/`), S3_SECRET_ACCESS_KEY: 'wrong-secret' });
    try {
      expect(await waitForLog(server, 'cannot be written to')).toContain(`The S3 bucket ${stack.s3.bucket} cannot be written to`);
      expect((await new Client(server).get('/healthz')).status).toBe(200);
    } finally {
      await server.stop();
    }
  });
});

describeIntegration('photos stored before shrinking', () => {
  test('are shrunk once, at the next start', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'promoter-stats-shrink-'));
    try {
      const first = await startServer({ DATA_DIR: dataDir });
      const admin = await signInAdmin(first);
      const maya = await newPromoter(first, admin, { name: `Maya ${uid()}`, codes: 'DJMAX' });
      await first.stop();
      // A photo as the app stored them before: full size, at avatars/<id>, with no key.
      const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c81e1e' } }).png().toBuffer();
      mkdirSync(join(dataDir, 'avatars'), { recursive: true });
      writeFileSync(join(dataDir, 'avatars', String(maya.id)), big);
      const db = new Database(join(dataDir, 'promoters.sqlite'));
      db.query("UPDATE users SET avatar_type = 'image/png', avatar_source = 'upload', avatar_key = NULL WHERE id = ?").run(maya.id);
      db.query("DELETE FROM settings WHERE key = 'photosShrunk'").run();
      db.close();

      const second = await startServer({ DATA_DIR: dataDir });
      try {
        expect(await waitForLog(second, 'Shrunk the stored images')).toContain('Shrunk the stored images: 1 profile photos.');
        const photo = new Uint8Array(await (await (await signInAdmin(second)).get(`/avatar/${maya.id}`)).arrayBuffer());
        expect(await sharp(photo).metadata()).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
        // The old full-size file is gone; only the new one is left.
        expect(filesIn(dataDir, 'avatars')).toHaveLength(1);
        expect(filesIn(dataDir, 'avatars')[0]).toMatch(new RegExp(`^${maya.id}-[0-9a-f]{24}\\.jpg$`));
      } finally {
        await second.stop();
      }
      // Only once.
      const third = await startServer({ DATA_DIR: dataDir });
      await Bun.sleep(500);
      expect(third.logs()).not.toContain('Shrunk the stored images');
      await third.stop();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
