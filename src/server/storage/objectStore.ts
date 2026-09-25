import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/server/env";

/**
 * Private object storage. There is intentionally no "public URL" method: the
 * only way to read an object is through the app after an ownership check.
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  exists(key: string): Promise<boolean>;
}

/** Keys never contain filenames or anything user-supplied. */
export function newObjectKey(userId: string): string {
  return `u/${userId}/${uuidv7()}`;
}
export function userPrefix(userId: string): string {
  return `u/${userId}/`;
}

class LocalObjectStore implements ObjectStore {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^u\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key) && !/^u\/[0-9a-f-]{36}\/$/.test(key)) {
      throw new Error("invalid object key");
    }
    return path.join(this.root, key);
  }
  async put(key: string, body: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    const dir = this.resolve(prefix);
    const files = await readdir(dir).catch(() => []);
    await rm(dir, { recursive: true, force: true });
    return files.length;
  }
  async exists(key: string) {
    return readFile(this.resolve(key)).then(
      () => true,
      () => false,
    );
  }
}

class R2ObjectStore implements ObjectStore {
  private client: S3Client;
  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private bucket: string,
  ) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async deletePrefix(prefix: string) {
    let count = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
        count += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return count;
  }
  async exists(key: string) {
    try {
      await this.get(key);
      return true;
    } catch {
      return false;
    }
  }
}

let store: ObjectStore | undefined;
export function objectStore(): ObjectStore {
  if (!store) {
    const e = env();
    store =
      e.STORAGE_DRIVER === "r2"
        ? new R2ObjectStore(e.R2_ACCOUNT_ID!, e.R2_ACCESS_KEY_ID!, e.R2_SECRET_ACCESS_KEY!, e.R2_BUCKET!)
        : new LocalObjectStore(path.resolve(e.LOCAL_STORAGE_DIR));
  }
  return store;
}
