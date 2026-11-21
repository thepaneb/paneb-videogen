import fs from "node:fs";
import { Aspect, Asset, GenParams, PollResult, VideoProvider } from "../model.js";
import { fill, framesFor } from "./comfyui.js";

const URL_ = (process.env.COMFY_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const FPS = Number(process.env.COMFY_FPS ?? 24);
// Durações oferecidas ao app. 5 s a 24 fps = 121 quadros, igual ao template oficial.
const DURATIONS = (process.env.COMFY_WAN_DURATIONS ?? "5,10").split(",").map(Number).filter(Boolean);
/** Workflow por modo: com imagem usa COMFY_WORKFLOW_WAN_I2V (se existir), sem imagem usa COMFY_WORKFLOW_WAN. */
export const wanWorkflowFor = (hasImage: boolean) => {
  const t2v = process.env.COMFY_WORKFLOW_WAN, i2v = process.env.COMFY_WORKFLOW_WAN_I2V;
  return hasImage ? (i2v || t2v) : (t2v || i2v);
};
// Wan aceita múltiplos de 16 (VAE 8x; 16 dá margem). Template oficial: 1280x704.
const SIZE_STD = { "9:16": [544, 960], "16:9": [960, 544], "1:1": [544, 544] } as const;
// pro = template oficial, bem mais pesado (em 12 GB, prefira clipes curtos)
const SIZE_PRO = { "9:16": [704, 1280], "16:9": [1280, 704], "1:1": [768, 768] } as const;
// low = rápido e leve, ideal para testar a ideia antes de gastar GPU na versão final
const SIZE_LOW = { "9:16": [384, 640], "16:9": [640, 384], "1:1": [384, 384] } as const;
const sizeFor = (aspect: Aspect, quality: string) =>
  (quality === "pro" ? SIZE_PRO : quality === "low" ? SIZE_LOW : SIZE_STD)[aspect as keyof typeof SIZE_STD];

async function upload(a: Asset, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("image", new Blob([a.buffer as any], { type: a.mime }), name);
  fd.append("overwrite", "true");
  const r = await fetch(`${URL_}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`ComfyUI upload ${r.status}`);
  const j: any = await r.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

// Timeout em todas as chamadas (sem isso um Comfy travado congela o worker, que só tem uma rodada por vez).
const post = (path: string, body: unknown) =>
  fetch(URL_ + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
const get = (path: string) => fetch(URL_ + path, { signal: AbortSignal.timeout(30_000) });

export const comfyWanProvider: VideoProvider = {
  caps: {
    name: "comfyui-wan", durations: DURATIONS, aspects: ["9:16", "1:1", "16:9"], qualities: ["low", "std", "pro"],
    // Sem knobs: o template oficial manda (cfg 5, 20 passos, denoise 1.0). Seed, imagem e negativo funcionam.
    features: { image: true, lastImage: false, negativePrompt: true, cancel: true, seed: true, tune: [] },
  },
  async submit(p: GenParams, jobId: string) {
    if (!Number.isFinite(FPS) || FPS <= 0) throw new Error("COMFY_FPS inválido (esperado número > 0)");
    const file = wanWorkflowFor(!!p.image);
    if (!file) throw new Error("nenhum workflow Wan configurado (COMFY_WORKFLOW_WAN / COMFY_WORKFLOW_WAN_I2V)");
    const raw = fs.readFileSync(file, "utf8");
    if (raw.includes("{{image}}") && !p.image) throw new Error("este workflow (image-to-video) exige uma imagem");
    const wf = JSON.parse(raw);
    const [width, height] = sizeFor(p.aspect, p.quality);
    const vars: Record<string, unknown> = {
      prompt: p.prompt, negative: p.negativePrompt ?? "", seed: p.seed ?? Math.floor(Math.random() * 2 ** 31),
      width, height, frames: framesFor(p.durationSec, FPS), fps: FPS, duration: p.durationSec, prefix: `videogen/${jobId}`,
    };
    if (p.image) vars.image = await upload(p.image, `${jobId}.png`);
    const r = await post("/prompt", { prompt: fill(wf, vars), client_id: jobId });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`ComfyUI /prompt ${r.status}: ${JSON.stringify(j.node_errors ?? j.error ?? j)}`);
    return j.prompt_id as string;
  },
  async poll(id): Promise<PollResult> {
    const r = await get(`/history/${id}`);
    if (!r.ok) throw new Error(`ComfyUI /history ${r.status}`);
    const entry = ((await r.json()) as any)[id];
    if (!entry) return { status: "running" }; // ainda na fila ou executando
    if (entry.status?.status_str === "error") return { status: "failed", error: "erro de execução no ComfyUI" };
    for (const out of Object.values<any>(entry.outputs ?? {}))
      for (const key of ["videos", "gifs", "images"])
        for (const f of out[key] ?? [])
          if (/\.(mp4|webm|mov)$/i.test(f.filename)) {
            const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
            return { status: "succeeded", remoteUrl: `${URL_}/view?${q}` };
          }
    if (entry.status?.completed) return { status: "failed", error: "workflow terminou sem vídeo" };
    return { status: "running" };
  },
  async cancel(id) {
    await post("/queue", { delete: [id] }); // remove se ainda estiver pendente
    try {
      const q: any = await (await get("/queue")).json().catch(() => ({}));
      const running = (q.queue_running ?? []).some((e: any) => e?.[1] === id);
      // /interrupt é global (derruba o job em execução, mesmo de outro usuário): só use se o nosso estiver rodando.
      if (running) await post("/interrupt", {});
    } catch { /* melhor esforço: a remoção da fila já foi pedida */ }
  },
};
