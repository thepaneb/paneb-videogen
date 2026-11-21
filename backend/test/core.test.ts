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

test("comfyui-wan: submit preenche placeholders, poll normaliza e exige imagem no I2V", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-wan-"));
  const t2v = path.join(dir, "wan2-t2v.api.json"), i2v = path.join(dir, "wan2-i2v.api.json");
  const base: any = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "w.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "u.safetensors", type: "wan", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "v.safetensors" } },
    "4": { class_type: "Wan22ImageToVideoLatent", inputs: { vae: ["3", 0], width: "{{width}}", height: "{{height}}", length: "{{frames}}", batch_size: 1 } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["2", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "{{negative}}", clip: ["2", 0] } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], seed: "{{seed}}", steps: 20, cfg: 5, sampler_name: "uni_pc", scheduler: "simple", positive: ["5", 0], negative: ["6", 0], latent_image: ["4", 0], denoise: 1 } },
    "8": { class_type: "CreateVideo", inputs: { images: ["7", 0], fps: "{{fps}}" } },
    "9": { class_type: "SaveVideo", inputs: { video: ["8", 0], filename_prefix: "{{prefix}}", format: "auto", codec: "auto" } },
  };
  fs.writeFileSync(t2v, JSON.stringify(base));
  const i2vWf = JSON.parse(JSON.stringify(base));
  i2vWf["10"] = { class_type: "LoadImage", inputs: { image: "{{image}}" } };
  i2vWf["4"].inputs.start_image = ["10", 0];
  fs.writeFileSync(i2v, JSON.stringify(i2vWf));
  process.env.COMFY_WORKFLOW_WAN = t2v;
  process.env.COMFY_WORKFLOW_WAN_I2V = i2v;
  let posted: any = null;
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.endsWith("/upload/image")) return new Response(JSON.stringify({ name: "j.png", subfolder: "" }), { status: 200 });
    if (u.endsWith("/prompt")) { posted = JSON.parse(String(init.body)); return new Response(JSON.stringify({ prompt_id: "p1" }), { status: 200 }); }
    if (u.includes("/history/")) return new Response(JSON.stringify({ p1: { outputs: { "9": { videos: [{ filename: "v.mp4", subfolder: "", type: "output" }] } }, status: { completed: true } } }), { status: 200 });
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
  }) as any;
  try {
    const { comfyWanProvider } = await import("../src/providers/comfyui-wan.js");
    assert.deepEqual([comfyWanProvider.caps.name, comfyWanProvider.caps.features.tune], ["comfyui-wan", []]);
    const p = { prompt: "gato", durationSec: 5, aspect: "16:9", quality: "std", negativePrompt: "borrado" } as any;
    const id = await comfyWanProvider.submit({ ...p, image: { buffer: Buffer.from("x"), mime: "image/png" } }, "job1");
    assert.equal(id, "p1");
    const g = posted.prompt;
    assert.deepEqual([g["4"].inputs.width, g["4"].inputs.height, g["4"].inputs.length], [960, 544, 121]);
    assert.deepEqual([g["5"].inputs.text, g["6"].inputs.text], ["gato", "borrado"]);
    assert.equal(typeof g["7"].inputs.seed, "number");
    assert.equal(g["9"].inputs.filename_prefix, "videogen/job1");
    const r = await comfyWanProvider.poll("p1");
    assert.equal(r.status, "succeeded");
    assert.match(r.remoteUrl!, /\/view\?filename=v\.mp4/);
    await comfyWanProvider.cancel!("p1");
    assert.ok(calls.some((c) => c.startsWith("POST ") && c.endsWith("/queue")));
    delete process.env.COMFY_WORKFLOW_WAN; // só resta o I2V: sem imagem tem que falhar
    await assert.rejects(comfyWanProvider.submit(p, "job2"), /exige uma imagem/);
  } finally { globalThis.fetch = orig; fs.rmSync(dir, { recursive: true, force: true }); }
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
