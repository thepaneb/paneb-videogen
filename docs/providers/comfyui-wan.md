# Provedor ComfyUI + Wan 2.2 5B (local)

Verificado em **2026-11-22**. Oficial: [tutorial Wan 2.2 no ComfyUI](https://docs.comfy.org/tutorials/video/wan/wan2_2) ·
[templates oficiais (UI)](https://github.com/Comfy-Org/workflow_templates) · [modelos repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_repackaged) ·
licença Apache 2.0 (uso comercial permitido).

Diferente do [LTX](comfyui-ltx.md) (que pede 32 GB+ de VRAM no oficial), o Wan 2.2 5B foi feito para
hardware modesto: a doc oficial indica que **roda com 8 GB de VRAM** (com offloading).

Render real validado neste projeto: **RTX 3060 12 GB** — texto→vídeo de 5 s em 384×640 (`low`)
em ~3,5 min; imagem→vídeo de 5 s em 544×960 (`std`, foto 1200×1600) em ~8 min.
Só texto e sem áudio; template oficial intacto (cfg 5, 20 passos, denoise 1.0).

## 1. Requisitos

- ComfyUI atualizado (nós nativos `Wan22ImageToVideoLatent`, `ModelSamplingSD3` — sem custom nodes).
- ~20 GB livres em disco para os 3 arquivos abaixo.

## 2. Modelos

De [Comfy-Org/Wan_2.2_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_repackaged)
(encoder do [Wan_2.1 repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged)):

| Arquivo (~tamanho) | Pasta em `ComfyUI/models/` |
|---|---|
| `wan2.2_ti2v_5B_fp16.safetensors` (~10 GB, difusão híbrida texto+imagem) | `diffusion_models/` |
| `wan2.2_vae.safetensors` (~1 GB, VAE) | `vae/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` (~6 GB, encoder de texto em FP8) | `text_encoders/` |

Com GPU menor que 8 GB: procure variantes GGUF do 5B (nó `ComfyUI-GGUF`) ou o CogVideoX-2B —
o workflow deste guia assume os arquivos acima com os nomes exatos.

## 3. Gerar um vídeo à mão primeiro

No ComfyUI: **Templates → "Wan 2.2 5B Video Generation"** (híbrido: texto→vídeo direto;
para imagem→vídeo, habilite o nó `Load Image` com Ctrl+B). Clique **Queue Prompt** e
confirme que sai um vídeo em `ComfyUI/output/`. Só siga adiante quando isso funcionar.

Dica de VRAM: `python main.py --reserve-vram 2` (GB livres para o sistema) ajuda em 12 GB.

## 4. Workflows prontos (formato API)

Este repo já traz os dois, convertidos do template oficial para API Format com placeholders
(`backend/workflows/wan2-t2v.api.json` e `wan2-i2v.api.json`):

| Placeholder | Preenchido com |
|---|---|
| `{{prompt}}` / `{{negative}}` | prompt e "o que evitar" |
| `{{image}}` | nome da imagem enviada ao ComfyUI (só no I2V) |
| `{{width}}` `{{height}}` | `low`: 640×384 (16:9), 384×640 (9:16), 384×384 (1:1) · `std`: 960×544, 544×960, 544×544 · `pro`: 1280×704, 704×1280, 768×768 (múltiplos de 16; ajuste em `comfyui-wan.ts`) |
| `{{frames}}` `{{fps}}` | quadros `8n+1` a partir da duração e de `COMFY_FPS` (5 s → 121, igual ao template) |
| `{{seed}}` | inteiro aleatório |
| `{{prefix}}` | `videogen/<id do job>` (prefixo do arquivo salvo) |

Diferenças para o provedor LTX (de propósito): **sem ajustes finos** (`features.tune` vazio —
o template manda: cfg 5, 20 passos, denoise 1.0; knobs virão depois) e **sem progresso
ao vivo** (a previsão usa a mediana de concluídos; o LTX tem barra em tempo real via WebSocket).

## 5. Ligar na API do projeto

```ini
PROVIDER=comfyui-wan
COMFY_URL=http://127.0.0.1:8188
COMFY_WORKFLOW_WAN=workflows/wan2-t2v.api.json
COMFY_WORKFLOW_WAN_I2V=workflows/wan2-i2v.api.json # opcional: usado quando o pedido traz imagem
COMFY_WAN_DURATIONS=5,10
```

Inicie o ComfyUI, depois `npm run dev`; `GET /capabilities` deve listar `comfyui-wan`.
Teste com `-F provider=comfyui-wan -F duration=5`. Um workflow com `{{image}}` sem
imagem no pedido retorna erro claro (`502`).

Pode rodar lado a lado com o `comfyui` (LTX): são provedores independentes no mesmo servidor.

## 6. ComfyUI em outra máquina ou na nuvem

Vale o mesmo do guia LTX ([seção 7](comfyui-ltx.md#7-comfyui-em-outra-máquina-ou-na-nuvem)):
`--listen 0.0.0.0` + rede privada, nunca exponha sem autenticação. Cloud (formato `/api/...`)
não é suportado por este provedor (ver [roadmap](../roadmap.md)).

## 7. Variante GGUF Q4 (preparada, ainda não validada)

Para `pro`/clipes longos em 12 GB, este repo traz `backend/workflows/wan2-t2v-gguf.api.json`:
igual ao T2V, mas com `UNetLoaderGGUF` + `Wan2.2-TI2V-5B-Q4_K_S.gguf` (3,1 GB, de
[QuantStack/Wan2.2-TI2V-5B-GGUF](https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF),
conversão do 5B oficial). Passos pendentes (manuais, exigem reiniciar o Comfy):

1. Instalar o custom node [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) (Manager → *Install via Git URL*),
   reiniciar o ComfyUI e confirmar `UNetLoaderGGUF` em `http://127.0.0.1:8188/object_info/UNetLoaderGGUF`.
2. Baixar o `.gguf` para `ComfyUI/models/diffusion_models/`.
3. Apontar `COMFY_WORKFLOW_WAN=workflows/wan2-t2v-gguf.api.json`, reiniciar a API e validar 1 render.

Não registrado como provedor separado de propósito: sem o nó instalado, o submit falharia
para todo job. Quando validado, vira seção própria como os demais provedores.

## 8. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `/prompt` → `node_errors` | workflow não está em API Format, ou nó/modelo ausente | usar os arquivos prontos; conferir nomes em 2; atualizar o ComfyUI |
| `Cannot find model` | nome de arquivo diferente | renomear exatamente como na seção 2 |
| Falha de memória (OOM) | resolução/duração altas para sua VRAM | `quality=low`, `COMFY_WAN_DURATIONS=5`, `--reserve-vram` |
| Job `failed: workflow terminou sem vídeo` | falta nó de salvar vídeo ou extensão inesperada | conferir nó de saída |
| Job fica `running` para sempre | ComfyUI parado/fila longa | ver console do ComfyUI; `JOB_TIMEOUT_MIN` encerra o job |
| Lento (minutos por clipe) | esperado em GPU média | normal: gere rascunho em `low`, final em `pro` |
