import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-rate-"));
Object.assign(process.env, { APP_KEYS: "alice:k1,bob:k2", PROVIDER: "mock", RATE_JOBS_PER_MINUTE: "2", LOG_LEVEL: "error" });

let base = "", server: any;
const postJobs = (key: string) => fetch(base + "/jobs", {
  method: "POST",
  headers: { "X-App-Key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "teste" }),
});
const closeServer = async (s: any) => { s.close(); s.closeIdleConnections(); await new Promise((r) => s.once("close", r)); };

test("rate: POST /jobs limita 2/min/usuário; 429 + Retry-After; outros usuários e GET não se afetam", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    const st: number[] = [];
    for (let i = 0; i < 3; i++) st.push((await postJobs("k1")).status);
    assert.deepEqual(st, [201, 201, 429], `esperado [201, 201, 429], mas veio ${st}`);

    const r429 = await postJobs("k1");
    assert.equal(r429.status, 429);
    const ra = Number(r429.headers.get("Retry-After"));
    assert.ok(Number.isFinite(ra) && ra >= 1 && ra <= 60, `Retry-After inválido: ${ra}`);

    // outro usuário (k2) não é afetado pelo uso do alice
    assert.equal((await postJobs("k2")).status, 201);
    // GET /jobs não conta nem é limitado
    assert.equal((await fetch(base + "/jobs", { headers: { "X-App-Key": "k1" } })).status, 200);
  } finally { await closeServer(server); }
});

test("rate: RATE_JOBS_PER_MINUTE=0 desliga o limite", async () => {
  process.env.RATE_JOBS_PER_MINUTE = "0";
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const server2: any = app.listen(0);
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    for (let i = 0; i < 4; i++) {
      const r = await fetch(base2 + "/jobs", {
        method: "POST", headers: { "X-App-Key": "k1", "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "teste" }),
      });
      assert.equal(r.status, 201);
    }
  } finally { await closeServer(server2); }
});
