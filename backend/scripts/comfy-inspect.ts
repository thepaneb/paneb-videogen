// Uso: npm run comfy:inspect -- caminho/do/workflow.api.json
// Lista os campos do workflow (formato API) que costumam virar placeholders {{...}}.
// Mantido em sincronia manual com as chaves de vars em src/providers/comfyui.ts (submit).
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("uso: npm run comfy:inspect -- <workflow.api.json>"); process.exit(1); }
const wf = JSON.parse(fs.readFileSync(file, "utf8"));
const KEYS = /^(text|prompt|negative.*|image|width|height|length|duration|value|frames?|frame_rate|fps|seed|noise_seed|cfg|strength|filename_prefix|ckpt_name|lora_name|model_name|text_encoder|upscale_model)$/i;

for (const [id, node] of Object.entries<any>(wf)) {
  for (const [k, v] of Object.entries<any>(node.inputs ?? {})) {
    if (Array.isArray(v)) continue; // ligação entre nós
    if (KEYS.test(k)) console.log(`nó ${id.padEnd(5)} ${String(node.class_type).padEnd(28)} ${k} = ${JSON.stringify(v).slice(0, 70)}`);
  }
}
console.log("\nPlaceholders aceitos: {{prompt}} {{negative}} {{image}} {{seed}} {{width}} {{height}} {{frames}} {{fps}} {{duration}} {{prefix}} {{promptEnhance}} {{cfg}} {{imgStrength}} {{sigmas1}} {{sigmas2}}");
