import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FILES_DIR, deleteJob, listActive, listTerminalBefore, updateJob } from "./db.js";
import { removeInputs } from "./inputs.js";
import { Job, Status } from "./model.js";
import { log } from "./log.js";
import * as m from "./metrics.js";
import { registry } from "./providers/index.js";
import { pushJobFinished } from "./push.js";

const TIMEOUT_MS = (() => {
  const v = Number(process.env.JOB_TIMEOUT_MIN ?? 15);
  if (!Number.isFinite(v) || v <= 0) throw new Error("JOB_TIMEOUT_MIN inválido (esperado número > 0)");
  return v * 60_000;
})();
const MAX_ERRORS = 5;

// Limpeza automática: jobs terminais mais velhos que RETENTION_DAYS saem do banco
// junto com vídeo e imagens de entrada. Ativos (queued/running) nunca são tocados.
const RETENTION_MS = (() => {
  const v = Number(process.env.RETENTION_DAYS ?? 30);
  if (!Number.isFinite(v) || v < 1) throw new Error("RETENTION_DAYS inválido (esperado número >= 1)");
  return v * 86_400_000;
})();

/** Remove terminais anteriores ao corte; devolve quantos jobs e arquivos saíram. Exportado para testes. */
export function purgeOldJobs(now = Date.now()): { jobs: number; files: number } {
  let jobs = 0, files = 0;
  for (const j of listTerminalBefore(now - RETENTION_MS)) {
    try {
      if (j.output?.url.startsWith("/files/")) {
        const full = path.join(FILES_DIR, path.basename(j.output.url));
        if (fs.existsSync(full)) files++;
        fs.rmSync(full, { force: true });
      }
      files += removeInputs(j.params);
      deleteJob(j.id);
      jobs++;
      m.jobsPurged.inc({ status: j.status });
    } catch (e) { log.warn("falha ao limpar job antigo", { job: j.id, error: (e as Error).message }); }
  }
  if (jobs) log.info("limpeza automática", { jobs, files });
  return { jobs, files };
}

/** Copia o vídeo para o nosso storage (URLs de provedor expiram). Se falhar, usa a URL remota. */
const STORE_MAX_BYTES = 500 * 1024 * 1024;
async function store(jobId: string, remoteUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(remoteUrl); } catch { throw new Error("URL remota inválida"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL remota com esquema inválido");
  try {
    const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > STORE_MAX_BYTES) throw new Error(`vídeo grande demais (${len} bytes)`);
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (type && !type.startsWith("video/") && type !== "application/octet-stream") throw new Error(`content-type inesperado (${type})`);
    const ext = remoteUrl.match(/\.(mp4|webm|mov)(\?|&|$)/i)?.[1].toLowerCase() ?? "mp4";
    const file = `${jobId}.${ext}`, tmp = path.join(FILES_DIR, `${file}.tmp`), dest = path.join(FILES_DIR, file);
    let bytes = 0;
    const guard = new Transform({
      transform(chunk, _enc, cb) {
        bytes += (chunk as Buffer).length;
        if (bytes > STORE_MAX_BYTES) cb(new Error("vídeo excedeu 500 MB"));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as any), guard, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    return `/files/${file}`;
  } catch (e) {
    try { for (const f of fs.readdirSync(FILES_DIR)) if (f.startsWith(jobId) && f.endsWith(".tmp")) fs.rmSync(path.join(FILES_DIR, f), { force: true }); } catch { /* melhor esforço */ }
    log.warn("download falhou; usando URL remota", { job: jobId, error: (e as Error).message });
    return remoteUrl;
  }
}

const done = (job: Job, status: Status) => {
  m.recordFinish(job.provider, status, job.createdAt);
  log.info("job concluído", { job: job.id, provider: job.provider, status, seconds: Math.round((Date.now() - job.createdAt) / 1000) });
  void pushJobFinished(job.userId, job.id, status); // melhor esforço: nunca trava a fila
};

async function advance(job: Job) {
  log.debug("adv ini", { job: job.id.slice(0, 8), status: job.status });
  if (Date.now() - job.createdAt > TIMEOUT_MS) {
    try { registry()[job.provider]?.drop?.(job.providerJobId); } catch { /* melhor esforço */ }
    updateJob(job.id, { status: "failed", error: "tempo esgotado" }); return done(job, "failed");
  }
  const prov = registry()[job.provider];
  log.debug("adv prov", { job: job.id.slice(0, 8), prov: prov?.caps?.name ?? null });
  if (!prov) { updateJob(job.id, { status: "failed", error: `provedor ${job.provider} indisponível` }); return done(job, "failed"); }
  try {
    const r = await prov.poll(job.providerJobId);
    log.debug("adv poll ok", { job: job.id.slice(0, 8), st: r.status });
    if (r.status === "succeeded") {
      if (!r.remoteUrl) { updateJob(job.id, { status: "failed", error: "provedor não devolveu URL" }); return done(job, "failed"); }
      const url = await store(job.id, r.remoteUrl);
      updateJob(job.id, { status: "succeeded", attempts: 0, output: { url, durationSec: r.durationSec, mime: "video/mp4" } });
      done(job, "succeeded");
    } else if (r.status !== job.status || r.error) {
      updateJob(job.id, { status: r.status, error: r.error, attempts: 0 });
      if (r.status === "failed" || r.status === "canceled") done(job, r.status);
    }
  } catch (e) { // erro transitório de rede/API: só falha após várias tentativas seguidas
    m.providerErrors.inc({ provider: job.provider, op: "poll" });
    const attempts = job.attempts + 1;
    log.warn("erro ao consultar provedor", { job: job.id, provider: job.provider, attempts, error: (e as Error).message });
    if (attempts >= MAX_ERRORS) { updateJob(job.id, { status: "failed", error: (e as Error).message, attempts }); done(job, "failed"); }
    else updateJob(job.id, { attempts });
  }
}

/** Inicia o worker; devolve uma função que o para e espera a rodada em andamento terminar. */
export function startWorker(everyMs = 4000): () => Promise<void> {
  let current: Promise<void> | null = null;
  let roundStartedAt = 0;
  const timer = setInterval(() => {
    if (current) {
      // Alarme (não trava em silêncio): uma rodada nunca deveria exceder o pior caso
      // (poll 30s + download 120s). Se exceder, destrava para a próxima tentar.
      if (Date.now() - roundStartedAt > 180_000) {
        log.error("worker travado: rodada excedeu 180s; forçando destrave", { travadaHaMs: Date.now() - roundStartedAt });
        current = null;
      }
      return;
    }
    roundStartedAt = Date.now();
    // O finally é encadeado na promise atribuída (microtarefa: sempre roda DEPOIS da
    // atribuição). Um finally dentro do corpo rodaria antes dela quando a rodada não
    // tem nenhum await (fila vazia → conclusão síncrona), deixando `current` com uma
    // promise resolvida (truthy) para sempre e travando o worker até o watchdog (180s).
    const p = (async () => {
      try {
        purgeOldJobs(); // barato: consulta indexada; sem terminais velhos não faz nada
        for (const j of listActive()) await advance(j);
      } catch (e) { log.error("falha na rodada do worker", { error: (e as Error).message }); }
    })();
    current = p;
    void p.finally(() => { if (current === p) current = null; });
  }, everyMs);
  return async () => { clearInterval(timer); await current; };
}
