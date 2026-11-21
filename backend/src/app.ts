import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { loadUsers, userFor } from "./auth.js";
import { signFile, verifyFile } from "./signing.js";
import { countActive, countSince, deleteJobFor, FILES_DIR, getByIdem, getJob, getJobFor, insertJob, listJobs, medianSucceededMs, updateJob } from "./db.js";
import { hasImageMagic, loadInput, removeInputs, saveInput } from "./inputs.js";
import { enhanceConfig, enhancePrompt } from "./enhance.js";
import { GenParams, Job, StoredParams, TERMINAL, VideoProvider } from "./model.js";
import { defaultProvider, registry } from "./providers/index.js";
import { log } from "./log.js";
import * as m from "./metrics.js";

const sha = (s: string) => createHash("sha256").update(s).digest();
const safeEq = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));
const randomSeed = () => randomInt(0, 2 ** 31 - 1);
// Corrida de idempotência: dois POSTs simultâneos passam do getByIdem e um deles viola o UNIQUE.
const isConstraint = (e: any) => /unique constraint|SQLITE_CONSTRAINT/i.test(String(e?.message ?? e ?? ""));
type Tune = { promptEnhance: boolean; cfg: number; imgStrength: number; steps: "low" | "std" | "high" };
// Ajustes finos do workflow (ComfyUI; outros provedores ignoram). Devolve os valores ou a mensagem de erro.
function parseTune(b: any): Tune | string {
  const promptEnhance = b?.promptEnhance === true || b?.promptEnhance === "true";
  const cfg = b?.cfg === undefined || b?.cfg === "" ? 1 : Number(b.cfg);
  if (!Number.isFinite(cfg) || cfg < 0 || cfg > 10) return "cfg inválido (0 a 10)";
  const imgStrength = b?.imgStrength === undefined || b?.imgStrength === "" ? 0.7 : Number(b.imgStrength);
  if (!Number.isFinite(imgStrength) || imgStrength < 0 || imgStrength > 1) return "imgStrength inválido (0 a 1)";
  const steps = (b?.steps === undefined || b?.steps === "" ? "std" : String(b.steps)) as "low" | "std" | "high";
  if (!["low", "std", "high"].includes(steps)) return "steps inválido (low|std|high)";
  return { promptEnhance, cfg, imgStrength, steps };
}
// Chute inicial (ms) para a previsão até o provedor ter histórico de jobs concluídos.
const FALLBACK_MS: Record<string, number> = { mock: 15_000, comfyui: 720_000, kling: 300_000 };

/** Monta a aplicação Express (sem abrir porta nem iniciar o worker). Lê a configuração do ambiente. */
export function createApp() {
  const users = loadUsers();
  if (users.size === 0) throw new Error("Defina APP_KEY ou APP_KEYS no .env");

  // Fail-fast: número inválido desligaria a proteção em silêncio (NaN nunca atinge limite).
  const numEnv = (name: string, def: number, min: number): number => {
    const v = Number(process.env[name] ?? def);
    if (!Number.isFinite(v) || v < min) throw new Error(`${name} inválido (esperado número >= ${min})`);
    return v;
  };
  const DAILY_LIMIT = numEnv("DAILY_LIMIT", 20, 1);                    // jobs por usuário em 24h
  const MAX_VARIATIONS = Math.floor(numEnv("MAX_VARIATIONS", 4, 1));
  const ENHANCE_LIMIT = numEnv("ENHANCE_DAILY_LIMIT", 100, 1);        // por usuário/dia, em memória
  const FILES_SECRET = process.env.FILES_SECRET ||
    createHash("sha256").update("files:" + (process.env.APP_KEYS ?? "") + (process.env.APP_KEY ?? "")).digest("hex");
  const FILES_TTL_MS = numEnv("FILES_TTL_MIN", 1440, 1) * 60_000;
  if ((process.env.KLING_ACCESS_KEY || process.env.KLING_SECRET_KEY) &&
      (!process.env.KLING_ACCESS_KEY || (process.env.KLING_SECRET_KEY?.length ?? 0) < 16))
    throw new Error("Kling configurado de forma incompleta (access key e secret com 16+ caracteres)");
  const enhanceUse = new Map<string, { start: number; n: number }>();

  const app = express();
  app.disable("x-powered-by"); // não anunciar framework/versão nos cabeçalhos
  app.set("trust proxy", "loopback"); // atrás do Caddy/Nginx, req.ip continua sendo o cliente real
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
    .fields([{ name: "image", maxCount: 1 }, { name: "lastImage", maxCount: 1 }]);

  // Log de acesso + métrica. Só `req.path` (sem query: ela carrega a assinatura dos links de vídeo).
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const rid = (req.header("X-Request-Id") || randomUUID()).slice(0, 64);
    res.setHeader("X-Request-Id", rid);
    res.on("finish", () => {
      const route = req.route?.path ?? "unmatched";
      m.httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
      if (req.path !== "/healthz" && req.path !== "/metrics")
        log.info("http", { rid, method: req.method, path: req.path, status: res.statusCode,
          ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6), user: res.locals.user });
    });
    next();
  });

  // ---- rotas sem X-App-Key ----
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/openapi.yaml", (_req, res) => res.type("application/yaml").sendFile(path.resolve(__dirname, "../openapi.yaml")));
  app.get("/metrics", (req, res) => { // desabilitado sem METRICS_TOKEN
    const tok = process.env.METRICS_TOKEN;
    if (!tok) return res.status(404).json({ error: "não encontrado" });
    if (!safeEq((req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""), tok)) return res.status(401).json({ error: "não autorizado" });
    res.type("text/plain; version=0.0.4").send(m.render(countActive()));
  });
  // Vídeos: link assinado e com validade (?exp&sig), gerado nas respostas autenticadas; suporta Range (ExoPlayer).
  app.get("/files/:name", (req, res) => {
    const name = req.params.name;
    if (name !== path.basename(name) || !verifyFile(name, String(req.query.exp), String(req.query.sig), FILES_SECRET))
      return res.status(403).json({ error: "link inválido ou expirado" });
    const file = path.resolve(FILES_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "não encontrado" });
    res.sendFile(file, { maxAge: "1h" });
  });

  // ---- autenticação ----
  app.use((req, res, next) => {
    const user = userFor(users, req.header("X-App-Key"));
    if (!user) return res.status(401).json({ error: "não autorizado" });
    res.locals.user = user;
    next();
  });
  app.use(express.json({ limit: "50kb" }));

  const me = (res: express.Response) => res.locals.user as string;
  const owned = (res: express.Response, id: string) => getJobFor(me(res), id);
  const fail = (res: express.Response, code: number, error: string) => res.status(code).json({ error });

  const dto = (j: Job) => {
    const { imageFile: _a, lastImageFile: _b, ...params } = j.params; // nomes internos não vão para o cliente
    return {
      id: j.id, provider: j.provider, status: j.status, prompt: j.params.prompt, params,
      output: j.output && { ...j.output, url: j.output.url.startsWith("/files/")
        ? signFile(path.basename(j.output.url), FILES_SECRET, FILES_TTL_MS) : j.output.url },
      error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
      ...estimate(j),
    };
  };

  /** Previsão de conclusão: fração ao vivo do provedor (WebSocket do ComfyUI) quando há;
   * senão, mediana do provedor; sem histórico, usa um palpite por provedor. */
  function estimate(j: Job): { progress: number | null; etaSec: number | null } {
    if (j.status === "succeeded") return { progress: 1, etaSec: 0 };
    if (j.status !== "queued" && j.status !== "running") return { progress: null, etaSec: null };
    const avg = medianSucceededMs(j.provider, j.params.durationSec) ?? FALLBACK_MS[j.provider] ?? 300_000;
    const el = Date.now() - j.createdAt;
    const live = j.status === "running" ? registry()[j.provider]?.progress?.(j.providerJobId) ?? null : null;
    if (live != null && live > 0.02) { // ritmo real: extrapola o total
      const total = el / live;
      return { progress: Math.min(0.99, Math.round(live * 100) / 100), etaSec: Math.max(0, Math.round((total - el) / 1000)) };
    }
    return {
      progress: j.status === "queued" ? 0 : Math.min(0.99, Math.round((el / avg) * 100) / 100),
      etaSec: Math.max(0, Math.round((j.status === "queued" ? avg : avg - el) / 1000)),
    };
  }

  /** Envia ao provedor, guarda as entradas e grava o job. */
  async function createJob(user: string, prov: VideoProvider, p: GenParams, idemKey?: string): Promise<Job> {
    const id = randomUUID();
    let providerJobId: string;
    try { providerJobId = await prov.submit(p, id); }
    catch (e) { m.providerErrors.inc({ provider: prov.caps.name, op: "submit" }); throw e; }
    const params: StoredParams = {
      prompt: p.prompt, negativePrompt: p.negativePrompt, durationSec: p.durationSec, aspect: p.aspect, quality: p.quality, seed: p.seed,
      promptEnhance: p.promptEnhance, cfg: p.cfg, imgStrength: p.imgStrength, steps: p.steps,
      hasImage: !!p.image, hasLastImage: !!p.lastImage,
      imageFile: p.image && saveInput(id, "first", p.image), lastImageFile: p.lastImage && saveInput(id, "last", p.lastImage),
    };
    const now = Date.now();
    const job: Job = { id, userId: user, provider: prov.caps.name, providerJobId, status: "queued", params, attempts: 0, idemKey, createdAt: now, updatedAt: now };
    try {
      insertJob(job);
    } catch (e) {
      // Falha após o submit: tenta não deixar job órfão no provedor (pago) nem arquivo órfão em disco.
      try { await prov.cancel?.(providerJobId); } catch { /* melhor esforço */ }
      removeInputs(params);
      throw e;
    }
    m.jobsCreated.inc({ provider: prov.caps.name });
    log.info("job criado", { job: id, provider: prov.caps.name, user, seed: p.seed, i2v: !!p.image });
    return job;
  }

  app.get("/capabilities", (_req, res) =>
    res.json({ default: defaultProvider(), promptEnhance: !!enhanceConfig(), providers: Object.values(registry()).map((p) => p.caps) }));

  app.post("/jobs", upload, async (req, res) => {
    try {
      const idemKey = req.header("Idempotency-Key") || undefined;
      if (idemKey) { const prev = getByIdem(me(res), idemKey); if (prev) return res.status(200).json(dto(prev)); }

      const prov = registry()[String(req.body.provider || defaultProvider())];
      if (!prov) return fail(res, 400, "provedor inválido");
      const prompt = String(req.body.prompt ?? "").trim();
      if (!prompt) return fail(res, 400, "prompt obrigatório");
      if (prompt.length > 5000) return fail(res, 400, "prompt muito longo (máx. 5000 caracteres)");
      const durationSec = Number(req.body.duration ?? prov.caps.durations[0]);
      const aspect = String(req.body.aspect ?? prov.caps.aspects[0]) as any;
      const quality = String(req.body.quality ?? prov.caps.qualities[0]) as any;
      if (!prov.caps.durations.includes(durationSec)) return fail(res, 400, `duração inválida (${prov.caps.durations})`);
      if (!prov.caps.aspects.includes(aspect)) return fail(res, 400, "proporção inválida");
      if (!prov.caps.qualities.includes(quality)) return fail(res, 400, "qualidade inválida");

      let seed: number | undefined;
      if (req.body.seed !== undefined && req.body.seed !== "") {
        seed = Number(req.body.seed);
        if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) return fail(res, 400, "seed inválida (inteiro entre 0 e 2147483647)");
      }
      seed = prov.caps.features.seed ? (seed ?? randomSeed()) : undefined; // sempre registramos a seed efetiva
      const tune = parseTune(req.body);
      if (typeof tune === "string") return fail(res, 400, tune);

      if (countSince(me(res), Date.now() - 86_400_000) >= DAILY_LIMIT) return fail(res, 429, "limite diário atingido");

      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const asset = (f?: Express.Multer.File) => (f ? { buffer: f.buffer, mime: f.mimetype } : undefined);
      const f = prov.caps.features;
      const uploads = [...(files.image ?? []), ...(files.lastImage ?? [])];
      const badMime = uploads.find((x) => !["image/png", "image/jpeg", "image/webp"].includes(x.mimetype));
      if (badMime) return fail(res, 400, "imagem precisa ser PNG, JPEG ou WebP");
      const badMagic = uploads.find((x) => !hasImageMagic(x.buffer, x.mimetype));
      if (badMagic) return fail(res, 400, "arquivo de imagem inválido ou corrompido");
      if (files.image?.length && !f.image) return fail(res, 400, "este provedor não aceita imagem inicial");
      if (files.lastImage?.length && !f.lastImage) return fail(res, 400, "este provedor não aceita imagem final");
      let job: Job;
      try {
        job = await createJob(me(res), prov, {
          prompt, durationSec, aspect, quality, seed, ...tune,
          negativePrompt: f.negativePrompt ? String(req.body.negativePrompt ?? "").trim() || undefined : undefined,
          image: f.image ? asset(files.image?.[0]) : undefined,
          lastImage: f.lastImage ? asset(files.lastImage?.[0]) : undefined,
        }, idemKey);
      } catch (e: any) {
        // Corrida de idempotência: o outro request inseriu primeiro; devolve o existente como 200.
        if (idemKey && isConstraint(e)) {
          const prev = getByIdem(me(res), idemKey);
          if (prev) return res.status(200).json(dto(prev));
        }
        throw e;
      }
      res.status(201).json(dto(job));
    } catch (e: any) { log.warn("falha ao criar job", { error: e.message }); fail(res, 502, e.message); }
  });

  // Repetir/variar a partir de um job existente (reusa prompt, parâmetros e imagens guardadas).
  app.post("/jobs/:id/repeat", async (req, res) => {
    const src = owned(res, req.params.id);
    if (!src) return fail(res, 404, "não encontrado");
    const count = req.body?.count === undefined ? 1 : Number(req.body.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_VARIATIONS) return fail(res, 400, `count deve ser de 1 a ${MAX_VARIATIONS}`);
    const prov = registry()[src.provider];
    if (!prov) return fail(res, 400, `provedor ${src.provider} indisponível`);
    const prompt = req.body?.prompt === undefined ? src.params.prompt : String(req.body.prompt).trim();
    if (!prompt || prompt.length > 5000) return fail(res, 400, "prompt inválido");
    // Ajustes opcionais (o app usa em "ajustar e refazer"); o resto vem do job original.
    const durationSec = req.body?.duration === undefined ? src.params.durationSec : Number(req.body.duration);
    if (!prov.caps.durations.includes(durationSec)) return fail(res, 400, `duração inválida (${prov.caps.durations})`);
    const aspect = (req.body?.aspect === undefined ? src.params.aspect : String(req.body.aspect)) as any;
    if (!prov.caps.aspects.includes(aspect)) return fail(res, 400, "proporção inválida");
    const quality = (req.body?.quality === undefined ? src.params.quality : String(req.body.quality)) as any;
    if (!prov.caps.qualities.includes(quality)) return fail(res, 400, "qualidade inválida");
    const negativePrompt = req.body?.negativePrompt === undefined ? src.params.negativePrompt : String(req.body.negativePrompt).trim() || undefined;
    const srcTune = src.params as Partial<Tune>;
    const tune = parseTune({
      promptEnhance: req.body?.promptEnhance ?? srcTune.promptEnhance,
      cfg: req.body?.cfg ?? srcTune.cfg,
      imgStrength: req.body?.imgStrength ?? srcTune.imgStrength,
      steps: req.body?.steps ?? srcTune.steps,
    });
    if (typeof tune === "string") return fail(res, 400, tune);
    const image = loadInput(src.params.imageFile), lastImage = loadInput(src.params.lastImageFile);
    if ((src.params.hasImage && !image) || (src.params.hasLastImage && !lastImage)) return fail(res, 409, "imagem de origem não está mais disponível");
    const idemBase = req.header("Idempotency-Key") || undefined;
    // Retentativa idempotente não gasta cota: só contam os itens que ainda não existem.
    const already = idemBase ? Array.from({ length: count }, (_, i) => getByIdem(me(res), `${idemBase}#${i}`)).filter(Boolean).length : 0;
    if (countSince(me(res), Date.now() - 86_400_000) + (count - already) > DAILY_LIMIT) return fail(res, 429, "limite diário atingido");

    const items: Job[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const key = idemBase && `${idemBase}#${i}`;
        const prev = key ? getByIdem(me(res), key) : undefined;
        if (prev) { items.push(prev); continue; }
        const seed = !prov.caps.features.seed ? undefined
          : req.body?.sameSeed === true && src.params.seed !== undefined ? src.params.seed : randomSeed();
        try {
          items.push(await createJob(me(res), prov, {
            prompt, negativePrompt: prov.caps.features.negativePrompt ? negativePrompt : undefined,
            durationSec, aspect, quality, seed, image, lastImage, ...tune,
          }, key));
        } catch (e: any) {
          // Corrida de idempotência: reaproveita o item criado pelo outro request.
          if (key && isConstraint(e)) {
            const raced = getByIdem(me(res), key);
            if (raced) { items.push(raced); continue; }
          }
          throw e;
        }
      }
    } catch (e: any) {
      log.warn("falha ao repetir job", { job: src.id, error: e.message });
      if (items.length === 0) return fail(res, 502, e.message);
      return res.status(201).json({ items: items.map(dto), error: e.message }); // sucesso parcial
    }
    res.status(201).json({ items: items.map(dto) });
  });

  app.get("/jobs", (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    if (!Number.isFinite(limit) || limit < 1) return fail(res, 400, "limit inválido (1 a 100)");
    const before = Number(req.query.before ?? Date.now() + 1);
    if (!Number.isFinite(before) || before < 0) return fail(res, 400, "before inválido (ms desde 1970)");
    res.json({ items: listJobs(me(res), Math.min(Math.floor(limit), 100), before).map(dto) });
  });
  app.get("/jobs/:id", (req, res) => { const j = owned(res, req.params.id); j ? res.json(dto(j)) : fail(res, 404, "não encontrado"); });

  app.post("/jobs/:id/cancel", async (req, res) => {
    const j = owned(res, req.params.id);
    if (!j) return fail(res, 404, "não encontrado");
    if (TERMINAL.has(j.status)) return res.json(dto(j));
    const prov = registry()[j.provider];
    if (!prov?.cancel) return fail(res, 409, "este provedor não suporta cancelamento");
    try { await prov.cancel(j.providerJobId); } catch (e: any) { log.warn("falha ao cancelar no provedor", { job: j.id, error: e.message }); }
    updateJob(j.id, { status: "canceled" });
    m.recordFinish(j.provider, "canceled", j.createdAt);
    res.json(dto(getJob(j.id)!));
  });

  app.delete("/jobs/:id", async (req, res) => {
    const j = owned(res, req.params.id);
    if (!j) return fail(res, 404, "não encontrado");
    if (!TERMINAL.has(j.status)) {
      try { await registry()[j.provider]?.cancel?.(j.providerJobId); }
      catch (e: any) { log.warn("falha ao cancelar no provedor", { job: j.id, error: e.message }); }
    }
    if (j.output?.url.startsWith("/files/")) fs.rmSync(path.join(FILES_DIR, path.basename(j.output.url)), { force: true });
    removeInputs(j.params);
    deleteJobFor(me(res), j.id);
    res.status(204).end();
  });

  app.post("/prompt/enhance", async (req, res) => {
    const cfg = enhanceConfig();
    if (!cfg) return fail(res, 501, "aprimorador de prompt não configurado (ANTHROPIC_API_KEY)");
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (prompt.length < 3 || prompt.length > 2000) return fail(res, 400, "prompt deve ter de 3 a 2000 caracteres");
    const provider = String(req.body?.provider || defaultProvider());
    if (!registry()[provider]) return fail(res, 400, "provedor inválido");
    const nowMs = Date.now(), windowMs = 86_400_000; // janela móvel de 24h, igual à cota de jobs
    for (const [k, v] of enhanceUse) if (nowMs - v.start >= windowMs) enhanceUse.delete(k); // poda janelas expiradas
    const u = enhanceUse.get(me(res));
    const used = u ? u.n : 0;
    if (used >= ENHANCE_LIMIT) { m.enhanceTotal.inc({ outcome: "limit" }); return fail(res, 429, "limite de aprimoramentos atingido (tente mais tarde)"); }
    enhanceUse.set(me(res), { start: u?.start ?? nowMs, n: used + 1 });
    try {
      const enhanced = await enhancePrompt(prompt, provider, req.body?.hasImage === true, cfg);
      m.enhanceTotal.inc({ outcome: "ok" });
      res.json({ original: prompt, enhanced, provider, model: cfg.model });
    } catch (e: any) {
      m.enhanceTotal.inc({ outcome: "error" });
      fail(res, 502, `falha ao aprimorar o prompt: ${e.message}`);
    }
  });

  return app;
}
