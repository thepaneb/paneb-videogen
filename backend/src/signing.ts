import { createHmac, timingSafeEqual } from "node:crypto";

const mac = (secret: string, file: string, exp: number) =>
  createHmac("sha256", secret).update(`${file}.${exp}`).digest("hex");

/** URL relativa assinada e com validade para um arquivo de vídeo. */
export function signFile(file: string, secret: string, ttlMs: number, now = Date.now()): string {
  const exp = Math.floor((now + ttlMs) / 1000);
  return `/files/${encodeURIComponent(file)}?exp=${exp}&sig=${mac(secret, file, exp)}`;
}

export function verifyFile(file: string, exp: string, sig: string, secret: string, now = Date.now()): boolean {
  const e = Number(exp);
  if (!Number.isInteger(e) || e * 1000 < now || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(mac(secret, file, e), "hex"));
}
