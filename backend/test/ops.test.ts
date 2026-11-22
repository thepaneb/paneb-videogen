import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Counter, Histogram } from "../src/metrics.js";

test("metrics: formato Prometheus (rótulos escapados, histograma cumulativo)", () => {
  const c = new Counter("t_total", "ajuda");
  c.inc({ a: 'x"y' }); c.inc({ a: 'x"y' }, 2);
  assert.match(c.render(), /# TYPE t_total counter\nt_total\{a="x\\"y"\} 3/);
  const h = new Histogram("t_seconds", "ajuda", [1, 10]);
  h.observe({ p: "m" }, 0.5); h.observe({ p: "m" }, 5); h.observe({ p: "m" }, 50);
  const out = h.render();
  assert.match(out, /t_seconds_bucket\{p="m",le="1"\} 1/);
  assert.match(out, /t_seconds_bucket\{p="m",le="10"\} 2/);
  assert.match(out, /t_seconds_bucket\{p="m",le="\+Inf"\} 3/);
  assert.match(out, /t_seconds_sum\{p="m"\} 55\.5/);
  assert.match(out, /t_seconds_count\{p="m"\} 3/);
});

// Windows não entrega SIGTERM com limpeza (TerminateProcess): só vale em POSIX.
test("encerramento limpo: SIGTERM fecha o servidor e sai com código 0",
  { skip: process.platform === "win32" ? "sem SIGTERM gracioso no Windows" : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-sd-"));
  const port = 3300 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), APP_KEY: "k", DATA_DIR: dir, PROVIDER: "mock" } });
  let logs = "";
  child.stdout.on("data", (d) => (logs += d));
  for (let i = 0; i < 60 && !logs.includes("API no ar"); i++) await new Promise((r) => setTimeout(r, 150));
  assert.ok(logs.includes("API no ar"), "servidor não subiu: " + logs);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  const exit = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  child.kill("SIGTERM");
  assert.equal(await Promise.race([exit, new Promise((r) => setTimeout(() => r("timeout"), 8000))]), 0);
  assert.ok(logs.includes("encerrado"), logs);
  assert.ok(logs.split("\n").filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), "todo log deve ser JSON");
});

test("servidor recusa iniciar sem APP_KEY/APP_KEYS", async () => {
  // Hermético: ignora um eventual backend/.env local (dotenv só lê o arquivo apontado).
  const noenv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "videogen-nk-")), ".env");
  const env = { ...process.env, DOTENV_CONFIG_PATH: noenv, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "videogen-nk-")), PORT: "3299" } as any;
  delete env.APP_KEY; delete env.APP_KEYS;
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: process.cwd(), env });
  let err = ""; child.stderr.on("data", (d) => (err += d));
  const code = await Promise.race([
    new Promise<number | null>((r) => child.on("exit", (c) => r(c))),
    new Promise<string>((r) => setTimeout(() => r("timeout"), 30_000)),
  ]);
  try { child.kill(); } catch { /* já saiu */ }
  assert.equal(code, 1); assert.match(err, /APP_KEY/);
});

// Regressão: rodada com a fila vazia concluía de forma síncrona e o `finally` interno
// limpava `current` antes da atribuição, deixando uma promise resolvida (truthy) para
// sempre — o worker só voltava a rodar no destrave do watchdog (180s). O teste deixa
// rodadas vazias passarem e exige que um job inserido depois seja concluído em segundos.
test("worker: rodada vazia não trava as seguintes", async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-wk-"));
  process.env.LOG_LEVEL = "error";
  const { insertJob, getJob } = await import("../src/db.js");
  const { startWorker } = await import("../src/worker.js");
  const stop = startWorker(50);
  try {
    await new Promise((r) => setTimeout(r, 300)); // rodadas vazias primeiro
    const now = Date.now();
    insertJob({ id: "wk1", userId: "default", provider: "mock", providerJobId: "inexistente",
      status: "queued", locked: false, attempts: 0, createdAt: now, updatedAt: now,
      params: { prompt: "x", durationSec: 5, aspect: "9:16", quality: "std", hasImage: false, hasLastImage: false } });
    let st = "queued";
    const deadline = Date.now() + 8000;
    while (st === "queued" || st === "running") {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
      st = getJob("wk1")!.status;
    }
    // mock sem estado em memória falha rápido ("job desconhecido"); o ponto é que a rodada rodou.
    assert.equal(st, "failed");
  } finally { await stop(); }
});

test("worker: limpeza remove terminais velhos com arquivos e preserva o resto", async () => {
  const db = await import("../src/db.js");
  const { purgeOldJobs } = await import("../src/worker.js");
  const { INPUTS_DIR } = await import("../src/inputs.js");
  const old = Date.now() - 40 * 86_400_000, now = Date.now();
  const base = { userId: "default", provider: "mock", providerJobId: "x", attempts: 0,
    params: { prompt: "x", durationSec: 5, aspect: "9:16", quality: "std", hasImage: true, hasLastImage: false, imageFile: "old-first.png" } };
  fs.writeFileSync(path.join(db.FILES_DIR, "old.mp4"), "video");
  fs.writeFileSync(path.join(INPUTS_DIR, "old-first.png"), "img");
  db.insertJob({ ...base, id: "old-ok", status: "succeeded", createdAt: old, updatedAt: old,
    output: { url: "/files/old.mp4", mime: "video/mp4" } } as any);
  db.insertJob({ ...base, id: "old-run", status: "running", createdAt: old, updatedAt: old } as any); // ativo: nunca sai
  db.insertJob({ ...base, id: "old-lock", status: "failed", locked: true, createdAt: old, updatedAt: old } as any); // travado: fica
  db.insertJob({ ...base, id: "new-ok", status: "succeeded", createdAt: now, updatedAt: now } as any); // recente: fica
  const r = purgeOldJobs(now);
  assert.deepEqual([r.jobs, r.files], [1, 2]);
  assert.equal(db.getJob("old-ok"), undefined);
  assert.ok(!fs.existsSync(path.join(db.FILES_DIR, "old.mp4")));
  assert.ok(!fs.existsSync(path.join(INPUTS_DIR, "old-first.png")));
  assert.notEqual(db.getJob("old-run"), undefined);
  assert.notEqual(db.getJob("old-lock"), undefined); // trava protege da limpeza
  assert.notEqual(db.getJob("new-ok"), undefined);
  db.deleteJob("old-run"); db.deleteJob("old-lock"); db.deleteJob("new-ok");
});
