import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-"));

test("comfyui: fill troca só placeholders exatos e preserva tipos", async () => {
  const { fill } = await import("../src/providers/comfyui.js");
  const out = fill({ a: { w: "{{width}}", t: "{{prompt}}", keep: "{{desconhecido}}", n: 3, arr: ["{{seed}}"] } },
    { width: 1024, prompt: "gato", seed: 7 });
  assert.deepEqual(out, { a: { w: 1024, t: "gato", keep: "{{desconhecido}}", n: 3, arr: [7] } });
});

test("comfyui: quantidade de quadros segue 8n+1", async () => {
  const { framesFor } = await import("../src/providers/comfyui.js");
  for (const d of [5, 10]) assert.equal((framesFor(d, 24) - 1) % 8, 0);
  assert.equal(framesFor(5, 24), 121);
});

test("comfyui: progresso do websocket vira fração 0..1 (só mensagens progress)", async () => {
  const { wsProgress } = await import("../src/providers/comfyui.js");
  assert.deepEqual(wsProgress({ type: "progress", data: { value: 24, max: 97, prompt_id: "p1" } }), { promptId: "p1", frac: 24 / 97 });
  assert.equal(wsProgress({ type: "executing", data: { node: "3" } }), null);
  assert.equal(wsProgress({ type: "progress", data: { value: 1, max: 0 } }), null);
  assert.equal(wsProgress(null), null);
});

test("db: mediana ignora valores extremos (jobs presos não distorcem a previsão)", async () => {
  const db = await import("../src/db.js");
  const now = Date.now();
  const mk = (id: string, ms: number) => db.insertJob({ id, userId: "u9", provider: "mock", providerJobId: id, status: "succeeded", attempts: 0, createdAt: now - ms, updatedAt: now,
    params: { prompt: "x", durationSec: 5, aspect: "1:1", quality: "std", hasImage: false, hasLastImage: false } });
  mk("m1", 10_000); mk("m2", 15_000); mk("m3", 3_600_000); // m3 ficou preso: média daria ~20 min, mediana 15 s
  assert.equal(db.medianSucceededMs("mock", 5), 15_000);
  for (const id of ["m1", "m2", "m3"]) db.deleteJob(id);
});

test("db: ciclo de vida, idempotência e jobs ativos", async () => {
  const db = await import("../src/db.js");
  const now = Date.now();
  db.insertJob({ id: "j1", userId: "u1", provider: "mock", providerJobId: "p1", status: "queued", attempts: 0, idemKey: "k1", createdAt: now, updatedAt: now,
    params: { prompt: "x", durationSec: 5, aspect: "9:16", quality: "std", hasImage: false, hasLastImage: false } });
  assert.equal(db.getByIdem("u1", "k1")?.id, "j1");
  assert.equal(db.getByIdem("u2", "k1"), undefined); // idempotência é por usuário
  assert.equal(db.listJobs("u2", 10, now + 1).length, 0);
  assert.equal(db.listActive().length, 1);
  db.updateJob("j1", { status: "succeeded", output: { url: "/files/j1.mp4", mime: "video/mp4" } });
  assert.equal(db.getJob("j1")?.output?.url, "/files/j1.mp4");
  assert.equal(db.listActive().length, 0);
  assert.equal(db.countSince("u1", now - 1000), 1);
  assert.equal(db.countSince("u2", now - 1000), 0);
  db.deleteJob("j1");
  assert.equal(db.getJob("j1"), undefined);
});

test("kling: id do job carrega o tipo e poll normaliza o status", async () => {
  process.env.KLING_ACCESS_KEY = "ak"; process.env.KLING_SECRET_KEY = "secret";
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push(`${init?.method} ${url}`);
    const body = init?.method === "POST" ? { code: 0, data: { task_id: "T1" } }
      : { code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: "https://x/v.mp4", duration: "5.1" }] } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as any;
  try {
    const { klingProvider } = await import("../src/providers/kling.js");
    const id = await klingProvider.submit({ prompt: "p", durationSec: 5, aspect: "9:16", quality: "std",
      image: { buffer: Buffer.from("x"), mime: "image/png" } }, "job1");
    assert.equal(id, "image2video:T1");
    const r = await klingProvider.poll(id);
    assert.deepEqual([r.status, r.remoteUrl, r.durationSec], ["succeeded", "https://x/v.mp4", 5.1]);
    assert.match(calls[1], /GET .*\/v1\/videos\/image2video\/T1$/);
  } finally { globalThis.fetch = orig; }
});
