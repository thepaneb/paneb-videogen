import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";
import { Asset, StoredParams } from "./model.js";

export const INPUTS_DIR = path.join(DATA_DIR, "inputs");
fs.mkdirSync(INPUTS_DIR, { recursive: true });
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function saveInput(jobId: string, tag: "first" | "last", a: Asset): string {
  const file = `${jobId}-${tag}.${EXT[a.mime] ?? "bin"}`;
  fs.writeFileSync(path.join(INPUTS_DIR, file), a.buffer);
  return file;
}
export function loadInput(file?: string): Asset | undefined {
  if (!file || file !== path.basename(file)) return undefined;
  const p = path.join(INPUTS_DIR, file);
  if (!fs.existsSync(p)) return undefined;
  return { buffer: fs.readFileSync(p), mime: MIME[path.extname(file).slice(1)] ?? "application/octet-stream" };
}
export function removeInputs(p: StoredParams) {
  for (const f of [p.imageFile, p.lastImageFile]) if (f) fs.rmSync(path.join(INPUTS_DIR, path.basename(f)), { force: true });
}

/** Checa os bytes mágicos mínimos (o mimetype do upload vem do cliente e não é confiável). */
export function hasImageMagic(buffer: Buffer, mime: string): boolean {
  if (mime === "image/png") return buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/webp")
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}
