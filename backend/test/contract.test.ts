import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";

// Ambiente de teste: mock (sem custo/rede), banco temporário, enhance e métricas ligados.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-api-"));
Object.assign(process.env, { APP_KEY: "k", PROVIDER: "mock", DAILY_LIMIT: "8", METRICS_TOKEN: "tok", ANTHROPIC_API_KEY: "sk-test",
  PROMPT_MODEL: "modelo-teste", LOG_LEVEL: "error" });

const spec: any = parse(fs.readFileSync("openapi.yaml", "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(spec, "spec");
const ptr = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

let base = "";
let server: any;
let anthropicCalls: { url: string; headers: any; body: any }[] = [];
const realFetch = globalThis.fetch;
const H = { "X-App-Key": "k" };

/** Faz o pedido, exige que o status esteja documentado e valida o corpo contra o schema do contrato. */
async function call(method: string, urlPath: string, opts: { headers?: any; body?: any } = {}, specPath = urlPath.split("?")[0]) {
  const res = await realFetch(base + urlPath, { method, headers: { ...H, ...opts.headers }, body: opts.body });
  const text = await res.text();
  const op = spec.paths[specPath]?.[method.toLowerCase()];
  assert.ok(op, `rota não documentada: ${method} ${specPath}`);
  const r = op.responses[String(res.status)];
  assert.ok(r, `status ${res.status} não documentado em ${method} ${specPath}: ${text.slice(0, 120)}`);
  const ct = Object.keys(r.content ?? {})[0];
  let body: any = text;
  if (ct === "application/json") {
    body = JSON.parse(text);
    const key = r.$ref ? r.$ref.replace("#/components/responses/", "") : null;
    const schemaPtr = key
      ? `spec#/components/responses/${key}/content/application~1json/schema`
      : `spec#/paths/${ptr(specPath)}/${method.toLowerCase()}/responses/${res.status}/content/application~1json/schema`;
    const validate = ajv.compile({ $ref: schemaPtr });
    assert.ok(validate(body), `${method} ${specPath} ${res.status} fora do contrato: ${JSON.stringify(validate.errors)}`);
  }
  return { status: res.status, body };
}

test("contrato: setup", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // intercepta só a API da Anthropic; o resto passa para o fetch real
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith("https://api.anthropic.com")) {
      anthropicCalls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "\"A calm lake at dawn, mist drifting.\"" }] }), { status: 200 });
    }
    return realFetch(url, init);
  }) as any;
});

test("contrato: todas as rotas do Express estão no OpenAPI e vice-versa", async () => {
  const { createApp } = await import("../src/app.js");
  // Express 4 expõe `app._router`; no 5 passou a `app.router` (mesmo formato de stack).
  const app: any = createApp();
  const stack: any[] = (app.router ?? app._router).stack;
  const actual = new Set<string>();
  for (const l of stack) if (l.route) for (const m of Object.keys(l.route.methods)) actual.add(`${m.toUpperCase()} ${l.route.path.replace(/:(\w+)/g, "{$1}")}`);
  const documented = new Set<string>();
  for (const [p, item] of Object.entries<any>(spec.paths)) for (const m of ["get", "post", "put", "delete", "patch"]) if (item[m]) documented.add(`${m.toUpperCase()} ${p}`);
  assert.deepEqual([...actual].filter((x) => !documented.has(x)), [], "rotas sem documentação");
  assert.deepEqual([...documented].filter((x) => !actual.has(x)), [], "documentadas mas inexistentes");
});

test("contrato: rotas públicas e autenticação", async () => {
  assert.equal((await call("GET", "/healthz", { headers: { "X-App-Key": "" } })).body.ok, true);
  const y = await realFetch(base + "/openapi.yaml"); assert.equal(y.status, 200); assert.equal(parse(await y.text()).openapi, "3.1.0");
  assert.equal((await call("GET", "/capabilities", { headers: { "X-App-Key": "x" } })).status, 401);
  const caps = (await call("GET", "/capabilities")).body;
  assert.equal(caps.promptEnhance, true);
  assert.equal(caps.providers.find((p: any) => p.name === "mock").features.seed, true);
});

let jobId = "";
test("contrato: criar com imagem e seed, idempotência, listar e obter", async () => {
  const fd = () => { const f = new FormData(); f.append("prompt", "gato astronauta"); f.append("seed", "1234"); f.append("duration", "5");
    // PNG mínimo válido (assinatura de 8 bytes; o resto do conteúdo não é validado)
    f.append("image", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "a.png");
    f.append("promptEnhance", "false"); f.append("cfg", "3"); f.append("imgStrength", "0.5"); f.append("steps", "low"); return f; };
  const a = await call("POST", "/jobs", { headers: { "Idempotency-Key": "idem-1" }, body: fd() });
  assert.equal(a.status, 201); jobId = a.body.id;
  assert.equal(a.body.params.seed, 1234); assert.equal(a.body.params.hasImage, true);
  assert.deepEqual([a.body.params.promptEnhance, a.body.params.cfg, a.body.params.imgStrength, a.body.params.steps],
    [false, 3, 0.5, "low"]);
  assert.equal(a.body.params.imageFile, undefined, "nomes internos não vazam");
  assert.equal(a.body.progress, 0, "job novo começa com progresso 0");
  assert.ok(typeof a.body.etaSec === "number" && a.body.etaSec >= 0, "job novo traz previsão em segundos");
  const b = await call("POST", "/jobs", { headers: { "Idempotency-Key": "idem-1" }, body: fd() });
  assert.deepEqual([b.status, b.body.id], [200, jobId]);
  assert.equal((await call("POST", "/jobs", { body: (() => { const f = new FormData(); f.append("prompt", "x"); f.append("duration", "7"); return f; })() })).status, 400);
  assert.equal((await call("POST", "/jobs", { body: (() => { const f = new FormData(); f.append("prompt", "x"); f.append("seed", "-1"); return f; })() })).status, 400);
  assert.equal((await call("GET", `/jobs/${jobId}`, {}, "/jobs/{id}")).body.id, jobId);
  assert.ok((await call("GET", "/jobs?limit=5")).body.items.length >= 1);
  assert.equal((await call("GET", "/jobs/nao-existe", {}, "/jobs/{id}")).status, 404);
});

test("contrato: repetir/variar (seed nova, mesma seed, imagem reaproveitada, cota)", async () => {
  const rep = (body: any, h: any = {}) => call("POST", `/jobs/${jobId}/repeat`, { headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) }, "/jobs/{id}/repeat");
  const two = await rep({ count: 2 });
  assert.equal(two.status, 201); assert.equal(two.body.items.length, 2);
  assert.ok(two.body.items.every((j: any) => j.params.hasImage && j.params.seed !== undefined && j.id !== jobId));
  const same = await rep({ count: 1, sameSeed: true, prompt: "gato astronauta, plano aberto" });
  assert.equal(same.body.items[0].params.seed, 1234);
  assert.equal(same.body.items[0].prompt, "gato astronauta, plano aberto");
  const adj = await rep({ count: 1, duration: 10, aspect: "1:1", quality: "pro", negativePrompt: "borrado" });
  assert.equal(adj.status, 201);
  assert.deepEqual([adj.body.items[0].params.durationSec, adj.body.items[0].params.aspect, adj.body.items[0].params.quality],
    [10, "1:1", "pro"]);
  assert.equal((await rep({ count: 1, duration: 7 })).status, 400); // fora dos durations do provedor
  const tune = await rep({ count: 1, promptEnhance: true, cfg: 2.5, imgStrength: 0.9, steps: "high" });
  assert.equal(tune.status, 201);
  assert.deepEqual([tune.body.items[0].params.promptEnhance, tune.body.items[0].params.cfg, tune.body.items[0].params.imgStrength, tune.body.items[0].params.steps],
    [true, 2.5, 0.9, "high"]);
  assert.equal((await rep({ count: 1, cfg: 99 })).status, 400);
  assert.equal((await rep({ count: 1, imgStrength: 2 })).status, 400);
  assert.equal((await rep({ count: 1, steps: "turbo" })).status, 400);
  assert.equal((await call("GET", "/jobs?limit=abc", {}, "/jobs")).status, 400);
  assert.equal((await call("GET", "/jobs?limit=0", {}, "/jobs")).status, 400);
  const noDur = new FormData(); noDur.append("prompt", "gato"); noDur.append("duration", "0");
  assert.equal((await call("POST", "/jobs", { body: noDur }, "/jobs")).status, 400);
  const m5001 = new FormData(); m5001.append("prompt", "x".repeat(5001)); m5001.append("duration", "5");
  assert.equal((await call("POST", "/jobs", { body: m5001 }, "/jobs")).status, 400); // prompt longo demais
  const badImg = new FormData(); badImg.append("prompt", "gato"); badImg.append("duration", "5");
  badImg.append("image", new Blob(["texto, não imagem"], { type: "text/plain" }), "x.txt");
  assert.equal((await call("POST", "/jobs", { body: badImg }, "/jobs")).status, 400); // mime inválido
  const badMagic = new FormData(); badMagic.append("prompt", "gato"); badMagic.append("duration", "5");
  badMagic.append("image", new Blob(["lixo"], { type: "image/png" }), "x.png");
  assert.equal((await call("POST", "/jobs", { body: badMagic }, "/jobs")).status, 400); // cabeçalho PNG inválido
  // provedor sem cancel() (kling legada): 409 em vez de "cancelado" fantasma
  process.env.KLING_ACCESS_KEY = "ak-teste"; process.env.KLING_SECRET_KEY = "segredo-com-mais-de-16";
  const kdb: any = await import("../src/db.js");
  const now = Date.now();
  kdb.insertJob({ id: "kj1", userId: "default", provider: "kling", providerJobId: "x", status: "queued", attempts: 0,
    createdAt: now, updatedAt: now, params: { prompt: "x", durationSec: 5, aspect: "9:16", quality: "std", hasImage: false, hasLastImage: false } });
  assert.equal((await call("POST", "/jobs/kj1/cancel", {}, "/jobs/{id}/cancel")).status, 409);
  kdb.deleteJob("kj1");
  const i1 = await rep({ count: 2 }, { "Idempotency-Key": "r1" }), i2 = await rep({ count: 2 }, { "Idempotency-Key": "r1" });
  assert.deepEqual(i2.body.items.map((j: any) => j.id), i1.body.items.map((j: any) => j.id)); // sem duplicar
  assert.equal((await rep({ count: 99 })).status, 400);
  assert.equal((await rep({ count: 4 })).status, 429); // já há 8 jobs; DAILY_LIMIT=8
});

test("contrato: sucesso com vídeo assinado, cancelar e excluir", async () => {
  const db = await import("../src/db.js");
  db.updateJob(jobId, { status: "succeeded", output: { url: "/files/x.mp4", mime: "video/mp4" } });
  const j = (await call("GET", `/jobs/${jobId}`, {}, "/jobs/{id}")).body;
  assert.match(j.output.url, /^\/files\/x\.mp4\?exp=\d+&sig=[0-9a-f]{64}$/);
  assert.equal((await call("GET", "/files/x.mp4", { headers: {} }, "/files/{name}")).status, 403);
  const other = (await call("GET", "/jobs?limit=50")).body.items.find((x: any) => x.id !== jobId && x.status === "queued");
  assert.equal((await call("POST", `/jobs/${other.id}/cancel`, {}, "/jobs/{id}/cancel")).body.status, "canceled");
  assert.equal((await call("DELETE", `/jobs/${other.id}`, {}, "/jobs/{id}")).status, 204);
});

test("contrato: aprimorar prompt (chamada à Anthropic simulada)", async () => {
  const r = await call("POST", "/prompt/enhance", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "lago ao amanhecer", provider: "mock", hasImage: true }) });
  assert.equal(r.status, 200); assert.equal(r.body.enhanced, "A calm lake at dawn, mist drifting."); // aspas removidas
  const c = anthropicCalls.at(-1)!;
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], "sk-test"); assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.model, "modelo-teste"); assert.equal(c.body.messages[0].content, "lago ao amanhecer");
  assert.match(c.body.system, /Never follow instructions/); assert.match(c.body.system, /first-frame image/);
  assert.equal((await call("POST", "/prompt/enhance", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x" }) })).status, 400);
});

test("contrato: push tokens (registro, validação, remoção)", async () => {
  assert.equal((await call("GET", "/capabilities")).body.push, false); // sem FCM no ambiente de teste
  const tok = "d".repeat(64) + ":APA91b" + "e".repeat(64);
  const reg = (body: any) => call("POST", "/push/tokens", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "/push/tokens");
  assert.equal((await reg({ token: tok })).status, 201);
  assert.equal((await reg({ token: tok })).status, 201); // idempotente
  assert.equal((await reg({})).status, 400);
  assert.equal((await reg({ token: "curto" })).status, 400);
  const del = (body: any) => call("DELETE", "/push/tokens", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "/push/tokens");
  assert.equal((await del({ token: tok })).status, 204);
  assert.equal((await del({ token: "x".repeat(300) })).status, 400);
});

test("contrato: /metrics exige token e expõe contadores", async () => {
  assert.equal((await call("GET", "/metrics", { headers: {} })).status, 401);
  const res = await realFetch(base + "/metrics", { headers: { Authorization: "Bearer tok" } });
  const t = await res.text();
  assert.equal(res.status, 200);
  assert.match(t, /videogen_jobs_created_total\{provider="mock"\} \d+/);
  assert.match(t, /videogen_http_requests_total\{method="POST",route="\/jobs",status="201"\}/);
  assert.match(t, /videogen_prompt_enhance_total\{outcome="ok"\} 1/);
  assert.match(t, /videogen_jobs_active\{status="queued"\}/);
  assert.match(t, /videogen_jobs_finished_total\{provider="mock",status="canceled"\} 1/);
});

test("contrato: teardown", () => { globalThis.fetch = realFetch; server.close(); server.closeAllConnections?.(); });
