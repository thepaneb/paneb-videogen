import fs from "node:fs";
import { Aspect, Asset, GenParams, PollResult, VideoProvider } from "../model.js";

const URL_ = (process.env.COMFY_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const FPS = Number(process.env.COMFY_FPS ?? 24);
// Durações oferecidas ao app; reduza em GPUs com pouca VRAM (ex.: COMFY_DURATIONS=3,5)
const DURATIONS = (process.env.COMFY_DURATIONS ?? "5,10").split(",").map(Number).filter(Boolean);
/** Workflow por modo: com imagem usa COMFY_WORKFLOW_I2V (se existir), sem imagem usa COMFY_WORKFLOW (texto→vídeo). */
export const workflowFor = (hasImage: boolean) => {
  const t2v = process.env.COMFY_WORKFLOW, i2v = process.env.COMFY_WORKFLOW_I2V;
  return hasImage ? (i2v || t2v) : (t2v || i2v);
};
// LTX exige dimensões múltiplas de 32 (ajuste conforme sua VRAM)
const SIZE_STD = { "9:16": [576, 1024], "16:9": [960, 540], "1:1": [768, 768] } as const;
// pro = mais detalhe, bem mais lento e com mais VRAM (em 12 GB, prefira clipes curtos)
// low = rápido e leve, ideal para testar a ideia antes de gastar GPU na versão final
const SIZE_PRO = { "9:16": [704, 1280], "16:9": [1280, 704], "1:1": [1024, 1024] } as const;
const SIZE_LOW = { "9:16": [384, 672], "16:9": [640, 352], "1:1": [512, 512] } as const;
const sizeFor = (aspect: Aspect, quality: string) =>
  (quality === "pro" ? SIZE_PRO : quality === "low" ? SIZE_LOW : SIZE_STD)[aspect as keyof typeof SIZE_STD];

/** Substitui valores que sejam exatamente "{{nome}}" no workflow (mantém o tipo: número, texto...). */
export function fill(n: any, vars: Record<string, unknown>): any {
  if (typeof n === "string") { const m = n.match(/^\{\{(\w+)\}\}$/); return m && m[1] in vars ? vars[m[1]] : n; }
  if (Array.isArray(n)) return n.map((x) => fill(x, vars));
  if (n && typeof n === "object") return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, fill(v, vars)]));
  return n;
}
async function upload(a: Asset, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("image", new Blob([a.buffer as any], { type: a.mime }), name);
  fd.append("overwrite", "true");
  const r = await fetch(`${URL_}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`ComfyUI upload ${r.status}`);
  const j: any = await r.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}
/** LTX exige 8n+1 quadros. */
export const framesFor = (durationSec: number, fps: number) => Math.round((durationSec * fps) / 8) * 8 + 1;
// Cronogramas de ruído por preset (interpolados a partir do template oficial; std = template intacto).
const mid = (a: number[]) => { const o = [a[0]]; for (let i = 1; i < a.length; i++) o.push((a[i - 1] + a[i]) / 2, a[i]); return o; };
const drop = (a: number[]) => a.filter((_, i) => i % 2 === 0 || i === a.length - 1);
const S1 = [0.85, 0.725, 0.4219, 0.0], S2 = [1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0];
const STEPS: Record<string, { s1: string; s2: string }> = {
  low: { s1: drop(S1).join(", "), s2: drop(S2).join(", ") },
  std: { s1: S1.join(", "), s2: S2.join(", ") },
  high: { s1: mid(S1).join(", "), s2: mid(S2).join(", ") },
};
// Timeout em todas as chamadas (sem isso um Comfy travado congela o worker, que só tem uma rodada por vez).
const post = (path: string, body: unknown) =>
  fetch(URL_ + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
const get = (path: string) => fetch(URL_ + path, { signal: AbortSignal.timeout(30_000) });

/** Extrai fração concluída das mensagens `progress` do WebSocket do ComfyUI (a mesma fonte da barra do próprio ComfyUI). */
export function wsProgress(msg: any): { promptId: string; frac: number } | null {
  if (!msg || msg.type !== "progress") return null;
  const d = msg.data ?? {};
  if (typeof d.value !== "number" || typeof d.max !== "number" || !(d.max > 0)) return null;
  return { promptId: String(d.prompt_id ?? ""), frac: Math.min(0.99, Math.max(0, d.value / d.max)) };
}

// Um WebSocket por job ativo (inscrito no client_id do submit); fecha ao terminar/cancelar.
const wsByPrompt = new Map<string, { ws: WebSocket; frac: number }>();
function track(promptId: string, clientId: string) {
  closeTrack(promptId);
  if (wsByPrompt.size >= 20) closeTrack(wsByPrompt.keys().next().value!);
  try {
    const ws = new WebSocket(`${URL_.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`);
    const st = { ws, frac: 0 };
    wsByPrompt.set(promptId, st);
    ws.addEventListener("message", (ev: any) => {
      const p = wsProgress(JSON.parse(String(ev.data)));
      if (p && p.promptId === promptId) st.frac = p.frac;
    });
    const drop = () => { if (wsByPrompt.get(promptId) === st) wsByPrompt.delete(promptId); try { ws.close(); } catch { /* já fechado */ } };
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
  } catch { /* sem progresso ao vivo; o poll HTTP continua valendo */ }
}
function closeTrack(promptId: string) {
  const s = wsByPrompt.get(promptId);
  if (s) { wsByPrompt.delete(promptId); try { s.ws.close(); } catch { /* já fechado */ } }
}

export const comfyProvider: VideoProvider = {
  caps: {
    name: "comfyui", durations: DURATIONS, aspects: ["9:16", "1:1", "16:9"], qualities: ["low", "std", "pro"],
    features: { image: true, lastImage: false, negativePrompt: true, cancel: true, seed: true,
      tune: ["promptEnhance", "cfg", "imgStrength", "steps"] },
  },
  async submit(p: GenParams, jobId: string) {
    if (!Number.isFinite(FPS) || FPS <= 0) throw new Error("COMFY_FPS inválido (esperado número > 0)");
    const file = workflowFor(!!p.image);
    if (!file) throw new Error("nenhum workflow configurado (COMFY_WORKFLOW / COMFY_WORKFLOW_I2V)");
    const raw = fs.readFileSync(file, "utf8");
    if (raw.includes("{{image}}") && !p.image) throw new Error("este workflow (image-to-video) exige uma imagem");
    const wf = JSON.parse(raw);
    const [width, height] = sizeFor(p.aspect, p.quality);
    const frames = framesFor(p.durationSec, FPS);
    const sig = STEPS[p.steps ?? "std"] ?? STEPS.std;
    const vars: Record<string, unknown> = {
      prompt: p.prompt, negative: p.negativePrompt ?? "", seed: p.seed ?? Math.floor(Math.random() * 2 ** 31),
      width, height, frames, fps: FPS, duration: p.durationSec, prefix: `videogen/${jobId}`,
      promptEnhance: p.promptEnhance ?? false, cfg: p.cfg ?? 1, imgStrength: p.imgStrength ?? 0.7,
      sigmas1: sig.s1, sigmas2: sig.s2,
    };
    if (p.image) vars.image = await upload(p.image, `${jobId}.png`);
    const r = await post("/prompt", { prompt: fill(wf, vars), client_id: jobId });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`ComfyUI /prompt ${r.status}: ${JSON.stringify(j.node_errors ?? j.error ?? j)}`);
    track(j.prompt_id as string, jobId); // progresso ao vivo via WebSocket (mesma fonte da barra do ComfyUI)
    return j.prompt_id as string;
  },
  progress(id): number | null {
    const s = wsByPrompt.get(id);
    return s && s.frac > 0 ? s.frac : null;
  },
  drop(id) { closeTrack(id); },
  async poll(id): Promise<PollResult> {
    const r = await get(`/history/${id}`);
    if (!r.ok) throw new Error(`ComfyUI /history ${r.status}`);
    const entry = ((await r.json()) as any)[id];
    if (!entry) return { status: "running" }; // ainda na fila ou executando
    if (entry.status?.status_str === "error") { closeTrack(id); return { status: "failed", error: "erro de execução no ComfyUI" }; }
    for (const out of Object.values<any>(entry.outputs ?? {}))
      for (const key of ["videos", "gifs", "images"])
        for (const f of out[key] ?? [])
          if (/\.(mp4|webm|mov)$/i.test(f.filename)) {
            closeTrack(id);
            const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
            return { status: "succeeded", remoteUrl: `${URL_}/view?${q}` };
          }
    if (entry.status?.completed) { closeTrack(id); return { status: "failed", error: "workflow terminou sem vídeo" }; }
    return { status: "running" };
  },
  async cancel(id) {
    closeTrack(id);
    await post("/queue", { delete: [id] }); // remove se ainda estiver pendente
    try {
      const q: any = await (await get("/queue")).json().catch(() => ({}));
      const running = (q.queue_running ?? []).some((e: any) => e?.[1] === id);
      // /interrupt é global (derruba o job em execução, mesmo de outro usuário): só use se o nosso estiver rodando.
      if (running) await post("/interrupt", {});
    } catch { /* melhor esforço: a remoção da fila já foi pedida */ }
  },
};
