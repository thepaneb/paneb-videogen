import test from "node:test";
import assert from "node:assert/strict";

const ENV = [
  "GENERIC_REPLICATE_URL", "GENERIC_REPLICATE_CREATE", "GENERIC_REPLICATE_POLL", "GENERIC_REPLICATE_CAPS",
  "GENERIC_REPLICATE_AUTH_HEADER", "GENERIC_REPLICATE_AUTH_VALUE", "GENERIC_REPLICATE_VIDEO_FIELD",
  "GENERIC_REPLICATE_DURATION_FIELD", "GENERIC_REPLICATE_ID_FIELD",
  "GENERIC_FAL_URL", "GENERIC_FAL_CREATE", "GENERIC_FAL_POLL", "GENERIC_FAL_CAPS", "GENERIC_FAL_CANCEL",
  "GENERIC_FAL_VIDEO_FIELD",
];
const clean = () => { for (const n of ENV) delete process.env[n]; };

test("generic: sem configuração vira null; provedor funciona sem rede, com fetch mock", async () => {
  clean();
  const { genericProvider } = await import("../src/providers/generic.js");
  assert.equal(genericProvider("replicate"), null, "sem URL/CREATE/POLL/CAPS não liga");

  // Replicate-like
  process.env.GENERIC_REPLICATE_URL = "https://api.replicate.com";
  process.env.GENERIC_REPLICATE_CREATE = "/v1/predictions";
  process.env.GENERIC_REPLICATE_POLL = "/v1/predictions/{id}";
  process.env.GENERIC_REPLICATE_CAPS = JSON.stringify({ durations: [5, 10], aspects: ["9:16", "16:9"], qualities: ["standard", "hd"] });
  process.env.GENERIC_REPLICATE_AUTH_HEADER = "Authorization";
  process.env.GENERIC_REPLICATE_AUTH_VALUE = "Token tkn";
  process.env.GENERIC_REPLICATE_ID_FIELD = "id";

  const calls: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    assert.ok(init?.headers?.Authorization === "Token tkn", "header de autenticação enviado");
    return new Response(JSON.stringify({ id: "abc-123", status: "succeeded", output: "https://cdn.example/v1.mp4", duration_seconds: 8 }),
      { status: 200 });
  }) as any;

  try {
    const prov = genericProvider("replicate");
    assert.ok(prov, "provedor liga com env completo");
    assert.equal(prov!.caps.name, "generic-replicate");
    assert.deepEqual(prov!.caps.durations, [5, 10]);

    const id = await prov!.submit({
      prompt: "gato astronauta", durationSec: 5, aspect: "9:16", quality: "standard",
      negativePrompt: "borrado", seed: 42,
    } as any, "job-x");
    assert.equal(id, "abc-123");
    assert.equal(calls[0].url, "https://api.replicate.com/v1/predictions");
    assert.deepEqual(JSON.parse(calls[0].init.body), {}, "sem CREATE_BODY → corpo vazio (padrão)");

    // CREATE_BODY com substituições de {prompt} {negativePrompt} {durationSec} {aspect} {quality} {seed}
    process.env.GENERIC_REPLICATE_CREATE_BODY = JSON.stringify({
      prompt: "{prompt}", negative_prompt: "{negativePrompt}", duration_seconds: "{durationSec}",
      aspect: "{aspect}", quality: "{quality}", seed: "{seed}",
    });
    const id2 = await prov!.submit({
      prompt: "gato astronauta", durationSec: 5, aspect: "9:16", quality: "standard", negativePrompt: "borrado", seed: 42,
    } as any, "job-x");
    assert.equal(id2, "abc-123");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      prompt: "gato astronauta", negative_prompt: "borrado", duration_seconds: "5", aspect: "9:16", quality: "standard", seed: "42",
    });

    const r = await prov!.poll("abc-123");
    assert.equal(r.status, "succeeded");
    assert.equal(r.remoteUrl, "https://cdn.example/v1.mp4");
    assert.equal(r.durationSec, 8);
    assert.equal(calls[2].url, "https://api.replicate.com/v1/predictions/abc-123");
  } finally {
    globalThis.fetch = realFetch;
    clean();
  }
});

test("generic: fal-like — mapa padrão COMPLETED/completed, status_message, cancel POSTa", async () => {
  // Fal: status "COMPLETED", video.url no objeto, sem auth header declarado.
  process.env.GENERIC_FAL_URL = "https://fal.ai";
  process.env.GENERIC_FAL_CREATE = "/v1/requests";
  process.env.GENERIC_FAL_POLL = "/v1/requests/{id}/status";
  process.env.GENERIC_FAL_VIDEO_FIELD = "video|url";
  process.env.GENERIC_FAL_CAPS = JSON.stringify({ durations: [5, 10], aspects: ["9:16", "1:1", "16:9"], qualities: ["std", "pro"] });
  process.env.GENERIC_FAL_CANCEL = "/v1/requests/{id}/cancel";

  const calls: { url: string; init: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    if (init?.method === "POST" && String(url).endsWith("/cancel")) return new Response(JSON.stringify({}), { status: 200 });
    return new Response(JSON.stringify({
      request_id: "fal-1",
      status: "COMPLETED",
      video: { url: "https://fal-cdn.example/out.mp4" },
      duration_seconds: 7,
    }), { status: 200 });
  }) as any;

  try {
    const { genericProvider } = await import("../src/providers/generic.js");
    const prov = genericProvider("fal");
    assert.ok(prov);
    const id = await prov!.submit({ prompt: "x", durationSec: 5, aspect: "9:16", quality: "std" } as any, "j");
    assert.equal(id, "fal-1");
    const r = await prov!.poll("fal-1");
    assert.equal(r.status, "succeeded", "status COMPLETED mapeado por o mapa padrão");
    assert.equal(r.remoteUrl, "https://fal-cdn.example/out.mp4", "URL do objeto video.url");
    assert.equal(r.durationSec, 7);
    await prov!.cancel?.("fal-1");
    assert.equal(calls.at(-1)!.url, "https://fal.ai/v1/requests/fal-1/cancel");
    assert.equal(calls.at(-1)!.init.method, "POST");
  } finally {
    globalThis.fetch = realFetch;
    clean();
  }
});

test("generic: features padrão — image/lastImage/seed/negative false; cancel true quando há endpoint", async () => {
  process.env.GENERIC_FAL_URL = "https://fal.ai";
  process.env.GENERIC_FAL_CREATE = "/v1/requests";
  process.env.GENERIC_FAL_POLL = "/v1/requests/{id}/status";
  process.env.GENERIC_FAL_CAPS = JSON.stringify({ durations: [5], aspects: ["9:16"], qualities: ["std"] });
  process.env.GENERIC_FAL_CANCEL = "/v1/requests/{id}/cancel";
  const { genericProvider } = await import("../src/providers/generic.js");
  const prov = genericProvider("fal");
  assert.ok(prov);
  assert.deepEqual(prov!.caps.features, { image: false, lastImage: false, negativePrompt: false, cancel: true, seed: false, tune: [] });
  clean();
});
