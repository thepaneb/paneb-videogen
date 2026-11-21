import { VideoProvider } from "../model.js";

const SAMPLE = "https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4";
const started = new Map<string, number>();
const canceled = new Set<string>();

export const mockProvider: VideoProvider = {
  caps: {
    name: "mock", durations: [5, 10], aspects: ["9:16", "1:1", "16:9"], qualities: ["std", "pro"],
    features: { image: true, lastImage: true, negativePrompt: true, cancel: true, seed: true, tune: [] },
  },
  async submit() { const id = crypto.randomUUID(); started.set(id, Date.now()); return id; },
  async cancel(id) { started.delete(id); canceled.add(id); },
  async poll(id) {
    if (canceled.has(id)) return { status: "canceled" };
    const t = started.get(id);
    if (!t) return { status: "failed", error: "job desconhecido (servidor reiniciou?)" };
    const age = Date.now() - t;
    if (age < 4_000) return { status: "queued" };
    if (age < 15_000) return { status: "running" };
    return { status: "succeeded", remoteUrl: SAMPLE, durationSec: 5 };
  },
};
