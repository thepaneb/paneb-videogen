import fs from "node:fs";
import { Aspect, Asset, GenParams, PollResult, VideoProvider } from "../model.js";
import { fill, framesFor } from "./comfyui.js";

const URL_ = (process.env.COMFY_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const FPS = Number(process.env.COMFY_FPS ?? 24);
// Durações curtas de propósito: o Fun 1.3B é para dar vida a uma foto; o final pode ir no comfyui-wan (5B).
const DURATIONS = (process.env.COMFY_WANFUN_DURATIONS ?? "3,5").split(",").map(Number).filter(Boolean);
// Movimento de câmera fixo por configuração (nó WanCameraEmbedding não tem equivalente nos outros provedores).
const MOTION = process.env.COMFY_WANFUN_MOTION ?? "Zoom In";
const MOTIONS = ["Static", "Pan Up", "Pan Down", "Pan Left", "Pan Right", "Zoom In", "Zoom Out", "Anti Clockwise (ACW)", "ClockWise (CW)"];
// Mesma família 1.3B do wan13 (mesmo VAE); tabelas em múltiplos de 16.
const SIZE_STD = { "9:16": [480, 832], "16:9": [832, 480], "1:1": [512, 512] } as const;
const SIZE_PRO = { "9:16": [576, 1024], "16:9": [1024, 576], "1:1": [640, 640] } as const;
const SIZE_LOW = { "9:16": [320, 512], "16:9": [512, 320], "1:1": [384, 384] } as const;
const sizeFor = (aspect: Aspect, quality: string) =>
  (quality === "pro" ? SIZE_PRO : quality === "low" ? SIZE_LOW : SIZE_STD)[aspect as keyof typeof SIZE_STD];

async function upload(a: Asset, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("image", new Blob([a.buffer as any], { type: a.mime }), name);
  fd.append("overwrite", "true");
  const r = await fetch(`${URL_}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`ComfyUI upload ${r.status}`);
  const j: any = await r.json();
  return j.subfolder ? `${j.subfolder}/${name}` : name;
}

// Timeout em todas as chamadas (sem isso um Comfy travado congela o worker, que só tem uma rodada por vez).
const post = (path: string, body: unknown) =>
  fetch(URL_ + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
const get = (path: string) => fetch(URL_ + path, { signal: AbortSignal.timeout(30_000) });

export const comfyWanfunProvider: VideoProvider = {
  caps: {
    name: "comfyui-wanfun", durations: DURATIONS, aspects: ["9:16", "1:1", "16:9"], qualities: ["low", "std", "pro"],
    // Só imagem→vídeo com câmera dirigida; sem imagem o pedido falha com erro claro.
    features: { image: true, lastImage: false, negativePrompt: true, cancel: true, seed: true, tune: ["camera"] },
  },
  async submit(p: GenParams, jobId: string) {
    if (!p.image) throw new Error("este provedor (imagem→vídeo com câmera) exige uma imagem; para só texto use comfyui-wan13");
    const motion = p.camera ?? MOTION; // por pedido; o padrão vem de COMFY_WANFUN_MOTION
    if (!MOTIONS.includes(MOTION)) throw new Error(`COMFY_WANFUN_MOTION inválido (opções: ${MOTIONS.join(", ")})`);
    if (!MOTIONS.includes(motion)) throw new Error(`camera inválida (opções: ${MOTIONS.join(", ")})`);
    if (!Number.isFinite(FPS) || FPS <= 0) throw new Error("COMFY_FPS inválido (esperado número > 0)");
    const file = process.env.COMFY_WORKFLOW_WANFUN;
    if (!file) throw new Error("nenhum workflow Fun Camera configurado (COMFY_WORKFLOW_WANFUN)");
    const raw = fs.readFileSync(file, "utf8");
    const wf = JSON.parse(raw);
    const [width, height] = sizeFor(p.aspect, p.quality);
    const vars: Record<string, unknown> = {
      prompt: p.prompt, negative: p.negativePrompt ?? "", seed: p.seed ?? Math.floor(Math.random() * 2 ** 31),
      width, height, frames: framesFor(p.durationSec, FPS), fps: FPS, duration: p.durationSec, prefix: `videogen/${jobId}`,
      motion, image: await upload(p.image, `${jobId}.png`),
    };
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
