// Host-uploaded cover photos. The browser re-encodes every photo to a JPEG
// before upload, so the server accepts only small JPEGs and stores them by hash
// in the same Redis (or local web/.data) as event details.
import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redis, usesRedis } from "./eventDetails";

export const MAX_COVER_BYTES = 600_000;
const DIR = path.join(process.cwd(), ".data", "covers");
const key = (id: string) => `cover:${id}`;

export const isCoverId = (id: string) => /^[0-9a-f]{64}$/.test(id);
export const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export async function saveCover(bytes: Buffer): Promise<string> {
  const id = createHash("sha256").update(bytes).digest("hex");
  if (usesRedis()) await redis(["SET", key(id), bytes.toString("base64")]);
  else {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${id}.jpg`), bytes);
  }
  return id;
}

export async function getCover(id: string): Promise<Buffer | null> {
  if (usesRedis()) {
    const value = await redis<string | null>(["GET", key(id)]);
    return value ? Buffer.from(value, "base64") : null;
  }
  return readFile(path.join(DIR, `${id}.jpg`)).catch(() => null);
}
