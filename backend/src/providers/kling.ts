// Provedor Kling — API "legada" (/v1/videos/*) com JWT (AccessKey + SecretKey).
// A Kling também opera um "novo padrão" (modelo no path, só API Key, consulta via GET /tasks) onde ficam os
// modelos mais novos (3.0 Turbo, 4.0). Ele ainda NÃO está implementado aqui: veja docs/providers/kling.md e docs/roadmap.md.
import jwt from "jsonwebtoken";
import { GenParams, PollResult, Status, VideoProvider } from "../model.js";

const BASE = process.env.KLING_BASE_URL ?? "https://api-singapore.klingai.com";
const MODEL = process.env.KLING_MODEL ?? "kling-v2-6";
type Kind = "image2video" | "text2video";

const token = () => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: process.env.KLING_ACCESS_KEY, exp: now + 1800, nbf: now - 5 },
    process.env.KLING_SECRET_KEY!, { algorithm: "HS256", header: { alg: "HS256", typ: "JWT" } });
};
async function call(path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) throw new Error(`Kling ${res.status} (code ${json.code ?? "?"}): ${json.message ?? "erro"}`);
  return json.data;
}
const STATUS: Record<string, Status> = { submitted: "queued", processing: "running", succeed: "succeeded", failed: "failed" };

// O endpoint de consulta depende do tipo; guardamos o tipo dentro do id para sobreviver a reinícios do servidor.
const encode = (k: Kind, id: string) => `${k}:${id}`;
const decode = (v: string): [Kind, string] => {
  const i = v.indexOf(":");
  return i < 0 ? ["text2video", v] : [v.slice(0, i) as Kind, v.slice(i + 1)];
};

export const klingProvider: VideoProvider = {
  caps: {
    name: "kling", durations: [5, 10], aspects: ["9:16", "1:1", "16:9"], qualities: ["std", "pro"],
    features: { image: true, lastImage: true, negativePrompt: true, cancel: false, seed: false, tune: [] },
  },
  async submit(p: GenParams, jobId: string) {
    const kind: Kind = p.image ? "image2video" : "text2video";
    const body: any = {
      model_name: MODEL, prompt: p.prompt, duration: String(p.durationSec), mode: p.quality,
      external_task_id: jobId, // reconciliação: o id do provedor fica ligado ao nosso id
    };
    if (p.negativePrompt) body.negative_prompt = p.negativePrompt;
    if (p.image) body.image = p.image.buffer.toString("base64"); // base64 puro, sem prefixo data:
    if (p.image && p.lastImage) body.image_tail = p.lastImage.buffer.toString("base64");
    if (!p.image) body.aspect_ratio = p.aspect; // no image2video a proporção vem da imagem
    const data = await call(`/v1/videos/${kind}`, body);
    return encode(kind, data.task_id);
  },
  async poll(providerJobId): Promise<PollResult> {
    const [kind, id] = decode(providerJobId);
    const d = await call(`/v1/videos/${kind}/${id}`);
    const status = STATUS[d.task_status] ?? "running";
    const v = d.task_result?.videos?.[0];
    return {
      status, remoteUrl: v?.url, durationSec: v?.duration ? Number(v.duration) : undefined,
      error: status === "failed" ? d.task_status_msg || "falhou" : undefined,
    };
  },
};
