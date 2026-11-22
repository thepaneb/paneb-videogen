// Modelo unificado, derivado dos esquemas de Kling (task_status/task_result), ComfyUI (prompt_id + /history)
// e Veo (operação de longa duração). Cada provedor traduz de/para este formato.
export type Status = "queued" | "running" | "succeeded" | "failed" | "canceled";
export const TERMINAL: ReadonlySet<Status> = new Set<Status>(["succeeded", "failed", "canceled"]);
export type Aspect = "9:16" | "1:1" | "16:9";
export type Quality = "low" | "std" | "pro";

export interface Asset { buffer: Buffer; mime: string }
export interface GenParams {
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  aspect: Aspect;
  quality: Quality;
  image?: Asset;      // primeiro quadro (image-to-video)
  lastImage?: Asset;  // último quadro (Kling: image_tail, Veo: last_frame)
  seed?: number;      // só em provedores com features.seed
  // Ajustes do workflow ComfyUI (ignorados por outros provedores):
  promptEnhance?: boolean; // expansor de prompt do LTX (padrão: false)
  cfg?: number;            // aderência ao prompt (padrão: 1)
  imgStrength?: number;    // força da imagem 0..1 (padrão: 0.7)
  steps?: "low" | "std" | "high"; // cronograma do sampler (padrão: std)
  camera?: string;         // movimento de câmera (só provedores com tune "camera", ex. comfyui-wanfun)
}
export type StoredParams = Omit<GenParams, "image" | "lastImage"> & {
  hasImage: boolean; hasLastImage: boolean;
  imageFile?: string; lastImageFile?: string; // cópias das entradas em data/inputs (permitem repetir o job)
};

export interface Output { url: string; durationSec?: number; mime: string }
export interface Job {
  id: string; userId: string; provider: string; providerJobId: string; status: Status;
  locked: boolean; // protegido contra exclusão manual e limpeza automática
  params: StoredParams; output?: Output; error?: string;
  attempts: number; idemKey?: string; createdAt: number; updatedAt: number;
}

export interface Capabilities {
  name: string; durations: number[]; aspects: Aspect[]; qualities: Quality[];
  features: { image: boolean; lastImage: boolean; negativePrompt: boolean; cancel: boolean; seed: boolean;
    tune: string[] };
}
export interface PollResult { status: Status; remoteUrl?: string; durationSec?: number; error?: string }
export interface VideoProvider {
  caps: Capabilities;
  submit(p: GenParams, jobId: string): Promise<string>;
  poll(providerJobId: string): Promise<PollResult>;
  cancel?(providerJobId: string): Promise<void>;
  /** Fração concluída 0..1 em tempo real (ex.: passos do sampler via WebSocket do ComfyUI); null = sem dado. */
  progress?(providerJobId: string): number | null;
  /** Libera recursos de acompanhamento (ex.: WebSocket) sem tocar na execução. */
  drop?(providerJobId: string): void;
  /** Fração concluída 0..1 em tempo real (ex.: passos do sampler via WebSocket do ComfyUI); null = sem dado. */
  progress?(providerJobId: string): number | null;
}
