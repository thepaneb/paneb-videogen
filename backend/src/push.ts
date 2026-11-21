import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { listPushTokens, removePushTokenEverywhere } from "./db.js";
import { log } from "./log.js";

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

// Conta de serviço: JSON inline em FIREBASE_SERVICE_ACCOUNT ou caminho do arquivo;
// o projeto pode vir de FCM_PROJECT_ID (mesmo valor do app).
function loadAccount(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const j = (raw.trim().startsWith("{") ? JSON.parse(raw) : JSON.parse(readFileSync(raw, "utf8"))) as ServiceAccount;
    const projectId = process.env.FCM_PROJECT_ID ?? j.project_id;
    if (!projectId || !j.client_email || !j.private_key) return null;
    return { projectId, clientEmail: j.client_email, privateKey: j.private_key };
  } catch { return null; }
}

/** true quando o envio de push está configurado (projeto + conta de serviço). */
export const pushAvailable = () => loadAccount() !== null;

let cached: { token: string; exp: number } | null = null;

// OAuth2 (googleapis) com JWT RS256 assinado: sem dependência externa.
async function accessToken(projectId: string, clientEmail: string, privateKey: string): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64(JSON.stringify({
    iss: clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(createPrivateKey(privateKey), "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`token OAuth ${res.status}`);
  const j: any = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function sendOne(projectId: string, at: string, token: string, data: Record<string, string>): Promise<"ok" | "invalid"> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return "ok";
  const err = await res.text();
  if (res.status === 404 || (/UNREGISTERED|INVALID_ARGUMENT/i.test(err))) return "invalid"; // token morto: descadastra
  throw new Error(`FCM ${res.status}`);
}

/** Avisa os aparelhos do usuário que o job terminou (mensagem só com jobId+status).
 *  Nunca falha o job: erro de rede/config só é logado; tokens mortos são removidos. */
export async function pushJobFinished(userId: string, jobId: string, status: string): Promise<void> {
  try {
    const acct = loadAccount();
    if (!acct) return;
    const tokens = listPushTokens(userId);
    if (!tokens.length) return;
    const at = await accessToken(acct.projectId, acct.clientEmail, acct.privateKey);
    for (const t of tokens) {
      try {
        if ((await sendOne(acct.projectId, at, t, { jobId, status })) === "invalid") removePushTokenEverywhere(t);
      } catch (e) { log.warn("falha ao enviar push", { job: jobId, error: (e as Error).message }); }
    }
  } catch (e) { log.warn("push indisponível", { error: (e as Error).message }); }
}
