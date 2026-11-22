# Provedor ComfyUI + Wan 2.1 1.3B texto→vídeo (rascunho rápido local)

Verificado em **2026-11-21**: render real neste projeto — **RTX 3060 12 GB**,
texto→vídeo de 3 s em 512×320 (`low`, 16:9) em **~3 min** (20 passos, cfg 6).
Oficial: [tutorial Wan 2.1 no ComfyUI](https://comfyanonymous.github.io/ComfyUI_examples/wan) ·
[tutorial Wan 2.1 no ComfyUI](https://comfyanonymous.github.io/ComfyUI_examples/wan) ·
[modelos repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) ·
código [Wan-Video/Wan2.1](https://github.com/Wan-Video/Wan2.1) (Apache 2.0).

Proposta: o **rascunho barato** antes do final no [Wan 2.2 5B](comfyui-wan.md).
O 1.3B gera texto→vídeo em 480p com poucos GB de VRAM (roda folgado numa RTX 3060 12 GB)
e é 2–3× mais rápido que o 5B. Limite consciente: **só texto→vídeo** — o imagem→vídeo
do Wan 2.1 oficial exige o 14B (`wan2.1_i2v_480p_14B_fp16` + `clip_vision_h`), pesado
demais para a proposta; para imagem→vídeo use o `comfyui-wan` (5B).

## 1. Modelos (~3,5 GB no total)

De [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged)
(pasta `split_files/`). O encoder de texto é o **mesmo** do Wan 2.2 5B — se você já
rodou o guia [comfyui-wan](comfyui-wan.md), só faltam os dois primeiros:

| Arquivo | Pasta em `ComfyUI/models/` |
|---|---|
| `wan2.1_t2v_1.3B_fp16.safetensors` (~3 GB, difusão T2V 1.3B) | `diffusion_models/` |
| `wan_2.1_vae.safetensors` (~500 MB, VAE) | `vae/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (~6 GB, encoder de texto em FP8) | `text_encoders/` (reaproveitado do 5B) |

No ComfyUI Desktop os modelos ficam em `D:\Comfy-Desktop\ComfyUI-Shared\models\...`
(ver `instance-model-paths` do app). Confirme em `http://127.0.0.1:8188/models/diffusion_models`
que `wan2.1_t2v_1.3B_fp16.safetensors` aparece na lista.

## 2. Workflow pronto (formato API)

Este repo já traz `backend/workflows/wan21-t2v.api.json`, derivado do exemplo oficial
`text_to_video_wan.json` ([fonte](https://github.com/comfyanonymous/ComfyUI_examples/tree/master/wan)):
mesmos nós (`UNETLoader` + `CLIPLoader` + `VAELoader` + `EmptyHunyuanLatentVideo` +
`ModelSamplingSD3` + `KSampler` + `VAEDecode` + `CreateVideo` + `SaveVideo`),
com placeholders:

| Placeholder | Preenchido com |
|---|---|
| `{{prompt}}` / `{{negative}}` | prompt e "o que evitar" |
| `{{width}}` `{{height}}` | `low`: 512×320 (16:9), 320×512 (9:16), 384×384 (1:1) · `std` (nativo 480p): 832×480, 480×832, 512×512 · `pro`: 1024×576, 576×1024, 640×640 (múltiplos de 16; ajuste em `comfyui-wan13.ts`) |
| `{{frames}}` `{{fps}}` | quadros `8n+1` a partir da duração e de `COMFY_FPS` (5 s → 121, igual ao 5B) |
| `{{seed}}` | inteiro aleatório |
| `{{prefix}}` | `videogen/<id do job>` (prefixo do arquivo salvo) |

Diferenças para o exemplo oficial (de propósito): 20 passos em vez de 30 (validação
mais rápida; suba editando o workflow se quiser o template intacto) e saída em
`SaveVideo` (o exemplo salva WEBP/WEBM; o provedor procura `.mp4`/`.webm`/`.mov`
no `/history`).

## 3. Ligar na API do projeto

```ini
COMFY_WORKFLOW_WAN13=workflows/wan21-t2v.api.json
COMFY_WAN13_DURATIONS=3,5   # clipes curtos: é provedor de rascunho
```

Reinicie a API (`npm run dev`); `GET /capabilities` deve listar `comfyui-wan13`
(o registro só aparece quando o arquivo do workflow existe). Teste com
`-F provider=comfyui-wan13 -F duration=3 -F quality=low`.

## 4. Fluxo sugerido

1. Rascunho barato: `comfyui-wan13`, `low`, 3 s.
2. Aprovou a ideia? Final: `comfyui-wan` (5B), `std`/`pro`, 5–10 s.
3. Precisa de imagem→vídeo? `comfyui-wan` com imagem (o 1.3B não aceita imagem —
   o pedido falha com erro claro `400`/`502`).
4. Rascunho→final sem reenviar nada: `POST /jobs/:id/repeat` com `provider`
   (o app mostra "Refazendo com X (original: Y)" ao trocar de provedor no ajuste).

## 5. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `comfyui-wan13` não aparece em `/capabilities` | `COMFY_WORKFLOW_WAN13` aponta para arquivo inexistente | conferir caminho relativo à pasta `backend/` |
| `/prompt` → `node_errors` / `Cannot find model` | nome de arquivo diferente | renomear exatamente como na seção 1 |
| Pedido com imagem falha | provedor é só texto→vídeo (`features.image: false`) | usar `comfyui-wan` para imagem→vídeo |
