import { mkdir, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { config } from "../config.js";
import type { ItemType } from "../models/Item.js";

export const TYPE_DIR: Record<ItemType, string> = {
  ship: "spaceships",
  bullet: "bullets",
  cosmetic: "cosmetics",
};
export const ASSET_DIRS = new Set(Object.values(TYPE_DIR));

export const SPRITE_PATTERN = "^[a-z0-9][a-z0-9-]{1,39}$";
const SPRITE_RE = new RegExp(SPRITE_PATTERN);
export const MAX_FRAMES = 8;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FRAME_FILE_RE = /^f[1-8]\.(png|webp)$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageExt = "webp" | "png";
// When a folder holds both formats, webp wins
const IMAGE_EXTS: ImageExt[] = ["webp", "png"];
export const CONTENT_TYPE: Record<ImageExt, string> = {
  webp: "image/webp",
  png: "image/png",
};

export class AssetError extends Error {}

export function isValidSprite(sprite: string): boolean {
  return SPRITE_RE.test(sprite);
}

export function isServableAsset(dir: string, sprite: string, file: string) {
  return ASSET_DIRS.has(dir) && SPRITE_RE.test(sprite) && FRAME_FILE_RE.test(file);
}

export function assetPath(dir: string, sprite: string, file: string): string {
  return join(config.assetsDir, dir, sprite, file);
}

function itemDir(type: ItemType, sprite: string): string {
  return join(config.assetsDir, TYPE_DIR[type], sprite);
}

export interface ImageInfo {
  frames: number;
  imageVersion: number;
  imageExt: ImageExt;
}

// Frames must be contiguous from f1: a missing f2 ends the animation at f1.
// The version follows the files' mtime, so replacing a file by hand also
// busts the browsers' cache.
export async function readImageInfo(
  type: ItemType,
  sprite: string,
): Promise<ImageInfo> {
  const dir = itemDir(type, sprite);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { frames: 0, imageVersion: 0, imageExt: "png" };
  }

  const imageExt = IMAGE_EXTS.find((ext) => names.includes(`f1.${ext}`)) ?? "png";
  let frames = 0;
  while (frames < MAX_FRAMES && names.includes(`f${frames + 1}.${imageExt}`)) frames++;

  const mtimes = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      stat(join(dir, `f${i + 1}.${imageExt}`)).then((s) => s.mtimeMs),
    ),
  );
  return { frames, imageVersion: Math.floor(Math.max(0, ...mtimes)), imageExt };
}

export async function withImages<T extends { type: ItemType; sprite: string }>(
  items: T[],
): Promise<(T & ImageInfo)[]> {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      ...(await readImageInfo(item.type, item.sprite)),
    })),
  );
}

function detectFormat(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export interface DecodedImages {
  ext: ImageExt;
  buffers: Buffer[];
}

export function decodeImages(encoded: string[]): DecodedImages {
  if (encoded.length === 0 || encoded.length > MAX_FRAMES) {
    throw new AssetError(`Entre 1 et ${MAX_FRAMES} images`);
  }
  const decoded = encoded.map((b64, i) => {
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new AssetError(`Image ${i + 1} trop lourde (2 Mo max)`);
    }
    const ext = detectFormat(buf);
    if (!ext) {
      throw new AssetError(`Image ${i + 1} : seuls le WebP et le PNG sont acceptés`);
    }
    return { buf, ext };
  });
  const ext = decoded[0].ext;
  if (decoded.some((d) => d.ext !== ext)) {
    throw new AssetError("Toutes les images doivent avoir le même format");
  }
  return { ext, buffers: decoded.map((d) => d.buf) };
}

// The new frames are written next to the live folder and swapped in with
// renames, so a game loading the sprite never sees a half-written set.
export async function replaceItemImages(
  type: ItemType,
  sprite: string,
  { ext, buffers }: DecodedImages,
): Promise<void> {
  if (!isValidSprite(sprite)) throw new AssetError("Identifiant invalide");

  const target = itemDir(type, sprite);
  const parent = join(config.assetsDir, TYPE_DIR[type]);
  const suffix = randomBytes(6).toString("hex");
  const staging = join(parent, `.${sprite}.new-${suffix}`);
  const previous = join(parent, `.${sprite}.old-${suffix}`);

  await mkdir(staging, { recursive: true });
  try {
    await Promise.all(
      buffers.map((buf, i) => writeFile(join(staging, `f${i + 1}.${ext}`), buf)),
    );
    const hadPrevious = await rename(target, previous).then(
      () => true,
      () => false,
    );
    await rename(staging, target);
    if (hadPrevious) await rm(previous, { recursive: true, force: true });
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
