// Provedor agregador genérico: qualquer API REST de texto→vídeo configurada por variáveis de ambiente,
// sem código de provedor novo por pé e sp é o documento.
//  - submit: POST <CREATE> (JSON de <CREATE_BODY> com {prompt} etc.) → id = <ID_FIELD> da resposta
//  - poll:   GET <POLL> ({id}) → status = <STATUS_FIELD> (mapeado por <STATUS_MAP>; padrão succeeded/completed/done/finished →
//            succeeded, failed/error → failed, canceled/cancelled → canceled; o resto → running) e URL do vídeo =
//            <VIDEO_FIELD> (ou url/uri do objeto)
//  - cancel: POST <CANCEL> ({id}) — quando configurado
import { GenParams, PollResult, Status, VideoProvider } from "../model.js";
import { log } from "../log.js";

function toUpperEnvName(s: string) { return s.replace(/[^A-Z0-9]+/gi, "_").toUpperCase(); }

function dot(obj: any, path: string): any {
  let cur = obj;
  for (const p of path.split(".")) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
function str(v: any): string | undefined { return typeof v === "string" && v.length > 0 ? v : undefined; }

/** Primeira string encontrada em `paths`; se o valor for objeto, usa `url` ou `uri`. */
function findFirst(obj: any, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = dot(obj, p);
    const s = str(v);
    if (s) return s;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const u = str(dot(v, "url")) ?? str(dot(v, "uri"));
      if (u) return u;
    }
  }
  return undefined;
}

// Mapa padrão (STATUS_MAP, se definido, substitui/acrescenta). Status não listados → "running".
const DEFAULT_STATUS_MAP: Record<string, Status> = {
  succeeded: "succeeded", completed: "succeeded", done: "succeeded", finished: "succeeded",
  failed: "failed", error: "failed", canceled: "canceled", cancelled: "canceled",
};

interface GConfig {
  name: string;
  url: string;
  create: string;
  createBody?: Record<string, unknown>;
  poll: string;
  cancel?: string;
  idField: string;
  statusField: string;
  statusMap: Record<string, Status>;
  videoFields: string[];
  durationFields: string[];
  authHeader?: string;
  authValue?: string;
  caps: VideoProvider["caps"];
}

/** Monta o provedor agregador de um nome de ambiente; null se config estiver incompleta. */
export function genericProvider(name: string): VideoProvider | null {
  const N = toUpperEnvName(name);
  const env = process.env;
  const url = env[`GENERIC_${N}_URL`];
  const create = env[`GENERIC_${N}_CREATE`];
  const poll = env[`GENERIC_${N}_POLL`];
  const cancel = env[`GENERIC_${N}_CANCEL`];
  const capsRaw = env[`GENERIC_${N}_CAPS`];
  if (!url || !create || !poll || !capsRaw) {
    log.warn("provedor agregador genérico incompleto (faltam variáveis)", { prov: `generic-${name}` });
    return null;
  }
  let caps: any;
  try { caps = JSON.parse(capsRaw); }
  catch { log.warn("CAPS do provedor agregador não é JSON válido", { prov: `generic-${name}` }); return null; }
  if (!caps || !Array.isArray(caps.durations) || !Array.isArray(caps.aspects) || !Array.isArray(caps.qualities)) {
    log.warn("CAPS do provedor agregador malformado", { prov: `generic-${name}` });
    return null;
  }
  const statusMap = { ...DEFAULT_STATUS_MAP, ...JSON.parse(env[`GENERIC_${N}_STATUS_MAP`] ?? "{}") } as Record<string, Status>;
  const cfg: GConfig = {
    name: `generic-${name}`,
    url, create, poll, cancel,
    idField: env[`GENERIC_${N}_ID_FIELD`] ?? "request_id",
    statusField: env[`GENERIC_${N}_STATUS_FIELD`] ?? "status",
    statusMap,
    videoFields: (env[`GENERIC_${N}_VIDEO_FIELD`] ?? "output").split("|").map((s) => s.trim()).filter(Boolean),
    durationFields: (env[`GENERIC_${N}_DURATION_FIELD`] ?? "duration_seconds").split("|").map((s) => s.trim()).filter(Boolean),
    authHeader: env[`GENERIC_${N}_AUTH_HEADER`],
    authValue: env[`GENERIC_${N}_AUTH_VALUE`],
    caps: {
      name: `generic-${name}`,
      durations: caps.durations,
      aspects: caps.aspects,
      qualities: caps.qualities,
      features: caps.features ??
        { image: false, lastImage: false, negativePrompt: false, cancel: !!cancel, seed: false, tune: [] },
    },
  };
  const full = (tpl: string, id?: string) => {
    const t = tpl.startsWith("http") ? tpl : cfg.url.replace(/\/$/, "") + "/" + tpl.replace(/^\/+/, "");
    return id !== undefined ? t.replace("{id}", encodeURIComponent(id)) : t;
  };
  const headers = () => (cfg.authHeader && cfg.authValue ? { [cfg.authHeader]: cfg.authValue } : {});
  const call = async (method: "POST" | "GET", tpl: string, body?: unknown, id?: string): Promise<any> => {
    const res = await fetch(full(tpl, id), {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", ...headers() } : headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`agregador HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  };
  const bodyOf = (p: GenParams): Record<string, unknown> => {
    const raw = env[`GENERIC_${N}_CREATE_BODY`];
    if (!raw) return {};
    let s = raw;
    for (const [k, v] of Object.entries({
      prompt: p.prompt, negativePrompt: p.negativePrompt, durationSec: p.durationSec, aspect: p.aspect, quality: p.quality, seed: p.seed,
    })) if (v !== undefined) s = s.split(`{${k}}`).join(String(v));
    return JSON.parse(s);
  };

  return {
    caps: cfg.caps,
    async submit(p: GenParams, _jobId: string) {
      const j = await call("POST", cfg.create, bodyOf(p));
      const id = str(dot(j, cfg.idField));
      if (!id) throw new Error("agregador não devolveu id do job");
      return id;
    },
    async poll(id: string): Promise<PollResult> {
      const j = await call("GET", cfg.poll, undefined, id);
      const st = (str(dot(j, cfg.statusField))?.toLowerCase() ?? "running").toLowerCase();
      const status = (cfg.statusMap[st] ?? "running") as Status;
      const err = status === "failed"
        ? str(dot(j, "status_message")) ?? str(dot(j, "error")) ?? str(dot(j, "message")) ?? "falhou"
        : undefined;
      const d = cfg.durationFields.map((p) => dot(j, p)).find((v) => v != null && v !== "");
      return { status, remoteUrl: findFirst(j, cfg.videoFields), durationSec: d != null ? Number(d) : undefined, error: err };
    },
    ...(cfg.cancel ? { async cancel(id: string) { await call("POST", cfg.cancel!, undefined, id); } } : {}),
  };
}
