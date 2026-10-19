import { S3Client } from 'bun';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config';

/*
 * Where uploaded files (profile photos, the logo) are kept: in DATA_DIR by default, or in an S3-compatible
 * bucket when S3_BUCKET is set. Keys are made by the app only ("avatars/12-3f9c….jpg"), never from input.
 *
 * Delivery: the app always checks who may see a file first. Then, with CDN_URL, it sends the browser to the
 * CDN; otherwise it reads the file (from disk or the bucket) and serves it itself, so the bucket can stay
 * private. Keys carry a random part, so a CDN address cannot be guessed from a promoter's id.
 */

const s3Settings = config.s3;
const s3 = s3Settings.bucket
  ? new S3Client({
      bucket: s3Settings.bucket,
      region: s3Settings.region,
      endpoint: s3Settings.endpoint || undefined,
      accessKeyId: s3Settings.accessKeyId,
      secretAccessKey: s3Settings.secretAccessKey,
    })
  : null;

if (s3 && (!s3Settings.accessKeyId || !s3Settings.secretAccessKey)) {
  console.error('S3_BUCKET is set: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are needed too.');
  process.exit(1);
}
if (config.cdnUrl && !s3) console.warn('CDN_URL is ignored without S3_BUCKET: files are served by the app.');
const cdnUrl = s3 ? config.cdnUrl : '';

export const storageKind: 'local' | 's3' = s3 ? 's3' : 'local';

/** The CDN's origin, for the CSP's img-src; null without a CDN. */
export const cdnOrigin = cdnUrl ? new URL(cdnUrl).origin : null;

const localPath = (key: string) => join(config.dataDir, key);
const objectKey = (key: string) => `${s3Settings.prefix}${key}`;

/** A new key for a file, e.g. newKey('avatars/12', 'image/jpeg') → "avatars/12-<random>.jpg". */
export function newKey(base: string, type: string): string {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type] ?? 'bin';
  return `${base}-${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('hex')}.${ext}`;
}

export async function putFile(key: string, bytes: Uint8Array, type: string): Promise<void> {
  if (s3) {
    await s3.file(objectKey(key)).write(bytes, { type });
    return;
  }
  mkdirSync(dirname(localPath(key)), { recursive: true });
  writeFileSync(localPath(key), bytes);
}

export async function getFile(key: string): Promise<Uint8Array | null> {
  if (s3) {
    try {
      return new Uint8Array(await s3.file(objectKey(key)).arrayBuffer());
    } catch {
      return null; // missing, or the bucket did not answer
    }
  }
  return existsSync(localPath(key)) ? new Uint8Array(readFileSync(localPath(key))) : null;
}

export async function deleteFile(key: string): Promise<void> {
  if (s3) {
    await s3.file(objectKey(key)).delete().catch((err) => console.error(`Could not delete ${objectKey(key)} from the bucket:`, err));
    return;
  }
  rmSync(localPath(key), { force: true });
}

/** Known to exist without asking the bucket: always true on S3 (the database says so), checked on disk. */
export function fileKnown(key: string): boolean {
  return s3 ? true : existsSync(localPath(key));
}

/** The CDN address of a file, when there is a CDN. */
export function cdnAddress(key: string): string | null {
  return cdnUrl ? `${cdnUrl}/${objectKey(key).split('/').map(encodeURIComponent).join('/')}` : null;
}

/**
 * Moves a file kept on disk (before S3 was set up) to the bucket under a new key, then removes it from
 * disk. True when it was moved; false when there is no bucket or no such file on disk.
 */
export async function moveToBucket(diskKey: string, key: string, type: string): Promise<boolean> {
  if (!s3 || !existsSync(localPath(diskKey))) return false;
  await putFile(key, readFileSync(localPath(diskKey)), type);
  rmSync(localPath(diskKey), { force: true });
  return true;
}

/** A file to send: the CDN address to redirect to, or the file itself. */
export type Delivery = { redirect: string } | { bytes: Uint8Array; type: string };

export async function deliver(key: string, type: string): Promise<Delivery | null> {
  const address = cdnAddress(key);
  if (address) return { redirect: address };
  const bytes = await getFile(key);
  return bytes ? { bytes, type } : null;
}

/** Logs whether the bucket answers, at startup. */
export async function checkStorage() {
  if (!s3) return;
  const probe = `${s3Settings.prefix}.storage-check`;
  try {
    await s3.file(probe).write('ok', { type: 'text/plain' });
    await s3.file(probe).delete();
    console.log(`Uploaded files are stored in the S3 bucket ${s3Settings.bucket}${cdnUrl ? `, delivered by ${cdnUrl}` : ''}.`);
  } catch (err) {
    console.error(`The S3 bucket ${s3Settings.bucket} cannot be written to; photo and logo uploads will fail:`, err);
  }
}
