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

/** Covers share the Redis that holds door check-ins and profiles: this budget keeps uploads from filling it. */
const BUDGET_BYTES = 100_000_000;
const USED = "covers:bytes";
export const COVERS_FULL = "Cover storage is full";

export async function saveCover(bytes: Buffer): Promise<string> {
  const id = createHash("sha256").update(bytes).digest("hex");
  if (usesRedis()) {
    if (await redis<number>(["EXISTS", key(id)])) return id;
    const data = bytes.toString("base64");
    // shortcut: covers saved before this counter existed are not in it; fine while they are a few MB.
    if (await redis<number>(["INCRBY", USED, data.length]) > BUDGET_BYTES) {
      await redis(["DECRBY", USED, data.length]);
      throw new Error(COVERS_FULL);
    }
    await redis(["SET", key(id), data]);
  } else {
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
