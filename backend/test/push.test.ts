import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

// Hermético: banco temporário, FCM simulado (conta fake + fetch interceptado).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-push-"));
Object.assign(process.env, { APP_KEY: "k", PROVIDER: "mock", LOG_LEVEL: "error" });
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FCM_PROJECT_ID = "proj-teste";
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: "proj-teste", client_email: "x@y.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});

const calls: { url: string; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  let body: any = null;
  if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body as any);
  else if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  calls.push({ url: String(url), body });
  if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
  if (body?.message?.token === "ruim")
    return new Response(JSON.stringify({ error: { status: "NOT_FOUND", message: "Requested entity was not found." } }), { status: 404 });
  return new Response(JSON.stringify({ name: "projects/proj-teste/messages/1" }), { status: 200 });
}) as any;

test("push: envia para tokens válidos e remove os mortos", async () => {
  const { addPushToken, listPushTokens } = await import("../src/db.js");
  const { pushAvailable, pushJobFinished } = await import("../src/push.js");
  assert.equal(pushAvailable(), true);
  addPushToken("default", "bom-12345678901234567890");
  addPushToken("default", "ruim");
  await pushJobFinished("default", "job1", "succeeded");
  assert.deepEqual(listPushTokens("default"), ["bom-12345678901234567890"]);
  const send = calls.find((c) => c.url.includes("messages:send"));
  assert.equal(send?.body.message.data.jobId, "job1");
  assert.equal(send?.body.message.data.status, "succeeded");
  assert.ok(calls.some((c) => c.url.includes("oauth2")), "busca access token OAuth2");
  globalThis.fetch = realFetch;
});
