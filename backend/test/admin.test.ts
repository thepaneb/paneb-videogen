import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-admin-"));
Object.assign(process.env, { APP_KEY: "k", PROVIDER: "mock", ADMIN_TOKEN: "adm", METRICS_TOKEN: "tok", LOG_LEVEL: "error" });

let base = "", server: any;
const H = { Authorization: "Bearer adm" };

test("admin: setup + sem header e token errado viram 401", async () => {
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/admin/worker/status")).status, 401); // sem header
  assert.equal((await fetch(base + "/admin/worker/status", { headers: { Authorization: "Bearer x" } })).status, 401); // token errado
  const s = await (await fetch(base + "/admin/worker/status", { headers: H })).json();
  assert.deepEqual([s.paused, s.depth, s.inFlight, s.stuck], [false, 0, [], []]);
});

test("admin: pause/resume/run-now + métrica + status com fila e stuck", async () => {
  const { insertJob } = await import("../src/db.js");
  const now = Date.now();
  const mk = (id: string, status: string, at: number) => insertJob({
    id, userId: "default", provider: "mock", providerJobId: id, status, locked: false, attempts: 0,
    createdAt: at, updatedAt: at,
    params: { prompt: "gato astronauta " + id, durationSec: 5, aspect: "9:16", quality: "std", hasImage: false, hasLastImage: false },
  } as any);
  mk("ativo-novo", "queued", now);
  mk("ativo-velho", "running", now - 20 * 60_000); // 20 min sem update → stuck (padrão 10 min)

  let s = await (await fetch(base + "/admin/worker/status", { headers: H })).json();
  assert.equal(s.depth, 2);
  assert.equal(s.stuck.length, 1);
  assert.deepEqual([s.stuck[0].id, s.stuck[0].provider], ["ativo-velho", "mock"]);
  assert.ok(s.stuck[0].stuckSec >= 19 * 60, `stuckSec: ${s.stuck[0].stuckSec}`);

  s = await (await fetch(base + "/admin/worker/pause", { method: "POST", headers: H })).json();
  assert.equal(s.paused, true);
  s = await (await fetch(base + "/admin/worker/resume", { method: "POST", headers: H })).json();
  assert.equal(s.paused, false);

  // run-now sem worker rodando: força uma rodada (mock falha jobs desconhecidos → terminam failed)
  const r = await (await fetch(base + "/admin/worker/run-now", { method: "POST", headers: H })).json();
  assert.equal(r.started, true);
  const deadline = Date.now() + 8000;
  while ((await (await fetch(base + "/admin/worker/status", { headers: H })).json()).depth > 0) {
    if (Date.now() > deadline) break;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  s = await (await fetch(base + "/admin/worker/status", { headers: H })).json();
  assert.equal(s.depth, 0, "run-now avançou a fila");

  // métrica do control plane conta as 3 ações
  const met = await (await fetch(base + "/metrics", { headers: { Authorization: "Bearer tok" } })).text();
  assert.match(met, /videogen_worker_admin_total\{action="pause"\} 1/);
  assert.match(met, /videogen_worker_admin_total\{action="resume"\} 1/);
  assert.match(met, /videogen_worker_admin_total\{action="run-now"\} 1/);
});

test("admin: stats por provedor (taxa, p50/p95) + topPrompts + days inválido", async () => {
  // jobs do teste anterior terminaram (failed); adiciona succeeded com durações conhecidas
  const { insertJob } = await import("../src/db.js");
  const now = Date.now();
  for (let i = 0; i < 4; i++) insertJob({
    id: `ok-${i}`, userId: "default", provider: "mock", providerJobId: `ok-${i}`, status: "succeeded",
    locked: false, attempts: 0, createdAt: now - 100_000 - i * 1000, updatedAt: now - i * 1000,
    output: { url: "/files/ok.mp4", mime: "video/mp4" },
    params: { prompt: "lago ao amanhecer", durationSec: 5, aspect: "9:16", quality: "std", hasImage: false, hasLastImage: false },
  } as any);

  const st = await (await fetch(base + "/admin/stats", { headers: H })).json();
  assert.equal(st.days, 30);
  const mock = st.providers.find((p: any) => p.provider === "mock");
  assert.ok(mock.jobs >= 6, `jobs: ${mock.jobs}`);
  assert.ok(mock.successRate > 0 && mock.successRate < 1, `taxa parcial: ${mock.successRate}`);
  assert.ok(typeof mock.p50Sec === "number" && mock.p50Sec >= 0, `p50: ${mock.p50Sec}`);
  assert.ok(mock.p95Sec >= mock.p50Sec, `p95 ${mock.p95Sec} >= p50 ${mock.p50Sec}`);
  const lago = st.topPrompts.find((t: any) => t.prefix.startsWith("lago ao amanhecer"));
  assert.equal(lago?.count, 4);
  assert.ok(st.topPrompts.every((t: any) => t.prefix.length <= 48), "só prefixo, sem texto completo");

  assert.equal((await fetch(base + "/admin/stats?days=0", { headers: H })).status, 400);
  assert.equal((await fetch(base + "/admin/stats?days=400", { headers: H })).status, 400);
});

test("admin: sem ADMIN_TOKEN as rotas somem (404)", async () => {
  delete process.env.ADMIN_TOKEN;
  const { createApp } = await import("../src/app.js");
  const app2 = createApp();
  const s2: any = app2.listen(0);
  try {
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    assert.equal((await fetch(b2 + "/admin/stats", { headers: H })).status, 404);
    assert.equal((await fetch(b2 + "/admin/worker/pause", { method: "POST", headers: H })).status, 404);
  } finally { s2.close(); s2.closeIdleConnections(); await new Promise((r) => s2.once("close", r)); }
});

test("admin: teardown", async () => { server.close(); server.closeIdleConnections(); await new Promise((r) => server.once("close", r)); });
