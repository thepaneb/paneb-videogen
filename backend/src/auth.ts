import { createHash } from "node:crypto";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

/** APP_KEYS="alice:chave1,bob:chave2" e/ou APP_KEY (usuário "default"). Guardamos só o hash da chave. */
export function loadUsers(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (env.APP_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    if (i <= 0 || i === part.length - 1) throw new Error("APP_KEYS inválido: use usuario:chave,usuario2:chave2");
    m.set(h(part.slice(i + 1)), part.slice(0, i));
  }
  if (env.APP_KEY) m.set(h(env.APP_KEY), "default");
  return m;
}
export const userFor = (users: Map<string, string>, key?: string) => (key ? users.get(h(key)) : undefined);
