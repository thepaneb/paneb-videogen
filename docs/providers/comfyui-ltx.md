# Provedor ComfyUI + LTX (local)

Verificado em **2026-11-17**. Oficial: [LTX no ComfyUI](https://docs.ltx.io/open-source-model/integration-tools/comfy-ui) ·
[requisitos de sistema](https://docs.ltx.io/open-source-model/getting-started/system-requirements) ·
[ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) · [modelos no Hugging Face](https://huggingface.co/Lightricks/LTX-2.5) ·
[download do ComfyUI](https://www.comfy.org/download) · [API do servidor ComfyUI](https://docs.comfy.org/development/comfyui-server/api-examples).

## 1. Requisitos (leia antes)

Oficial (LTX-2.5): GPU NVIDIA com **32 GB+ de VRAM** (mais é melhor), 32 GB de RAM, **100 GB livres**, CUDA 12.7+,
**Python 3.12+**. Recomendado: A100 80 GB/H100, 64 GB+ de RAM, SSD de 200 GB+.

Versões de menor VRAM existem, mas **fora do mínimo oficial**:

| Opção | Onde | Observação |
|---|---|---|
| INT8 ConvRot (destilado) | arquivos oficiais "lower-VRAM" (seção 3) | rota oficial para menos VRAM; a documentação não informa um piso de VRAM |
| FP8 (comunidade/Kijai) | Hugging Face | quantização FP8 costuma exigir GPU NVIDIA série 40 ou mais nova (terceiros) |
| NVFP4 | arquivo oficial | só GPUs Blackwell (FP4) |
| Referência de tamanho (LTX-2, 19B — artigo da RunPod) | — | 16 GB: fp8/destilado em ~540p, clipes curtos · 24 GB: fp8/destilado em 720p · 48 GB: bf16 em 720p |

Se sua GPU tem menos de 24 GB: teste com o **template oficial** primeiro, resolução baixa (480×720) e poucos quadros
(41–81, como a doc recomenda). Se não rodar bem, use [Kling](kling.md) ou alugue uma GPU na nuvem (ex.: pod RunPod com o
template oficial do ComfyUI) e aponte `COMFY_URL` para ela.

## 2. Instalar ComfyUI e os nós do LTX

1. Instale o ComfyUI (app desktop em comfy.org/download, ou a versão *portable*) e atualize para a última versão.
2. **Caminho fácil:** abra **Templates**, procure **"LTX-2.5"**, escolha *Text to Video* ou *Image to Video* e clique
   **Download all** (baixa os modelos). Reinicie o ComfyUI.
3. **Manual:**
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/Lightricks/ComfyUI-LTXVideo.git
   cd ComfyUI-LTXVideo && pip install -r requirements.txt
   # portable (Windows): .\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\ComfyUI-LTXVideo\requirements.txt
   ```
   Reinicie. Verifique em *Add Node → LTXVideo* (loaders, samplers, conditioning, utils).
4. Se aparecer "missing nodes", use *Install Missing Custom Nodes* (ComfyUI Manager) e reinicie.

## 3. Modelos (instalação manual)

> **Nota (2026-11-21):** o provedor usa dois workflows 2.3 (2 estágios):
> `ltx2-t2v.api.json` (texto→vídeo, validado: 3 s em 640×352 `low` numa 3060 12 GB
> em **~7 min**) e `ltx2-i2v.api.json` (imagem→vídeo, validado: job de ~23 min
> numa 3060 12 GB). Arquivos usados, todos íntegros no Comfy (`checkpoints/`,
> `latent_upscale_models/`, `text_encoders/`, `loras/` — checkpoint de 29.145.431.166
> bytes, igual ao oficial `Lightricks/LTX-2.3-fp8`):
> `ltx-2.3-22b-dev-fp8.safetensors`,
> `ltx-2.3-spatial-upscaler-x2-1.1.safetensors`,
> `gemma_3_12B_it_fp4_mixed.safetensors`,
> `ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors` e
> `gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors`.
> O T2V usa prompt cru (sem `promptEnhance` de imagem). Para texto→vídeo rápido,
> prefira `comfyui-wan13` (~3 min).

Do repositório [Lightricks/LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5):

| Arquivo | Pasta em `ComfyUI/models/` |
|---|---|
| `ltx-2.5-22b-distilled-transformer-bf16.safetensors` | `diffusion_models/` |
| `gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` (encoder de texto) | `text_encoders/` |
| `gemma4_e2b_it_bf16.safetensors` (aprimorador de prompt; vem de `Comfy-Org/gemma-4`) | `text_encoders/` |
| `ltx-2.5-video-vae-bf16.safetensors` e `ltx-2.5-audio-vae-bf16.safetensors` | `vae/` |
| `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` (templates de 2 estágios) | `latent_upscale_models/` |

**Menor VRAM (3 arquivos que substituem transformer, encoder e VAE de vídeo acima):**
`ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` → `diffusion_models/` ·
`gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` → `text_encoders/` ·
`ltx-2.5-video-vae-conv-bf16.safetensors` → `vae/`.

## 4. Gerar um vídeo à mão primeiro

Templates oficiais do ComfyUI: `video_ltx2_5_t2v` (texto→vídeo, 2 estágios), `video_ltx2_5_i2v` (imagem→vídeo, 2 estágios)
e `video_ltx2_5_flf2v` (primeiro/último quadro, 1 estágio). Carregue um, clique **Queue Prompt** (Ctrl+Enter) e confirme
que sai um vídeo em `ComfyUI/output/`. Os templates vêm com *Prompt Enhance* ligado (reescreve seu prompt); desligue se
quiser resultado previsível. Só siga adiante quando isso funcionar sem a nossa API.

Dica de VRAM: `python main.py --reserve-vram 5` (valor em GB) deixa folga para o sistema.

## 5. Exportar o workflow para a API

1. No ComfyUI: *Workflow → Export (API)* / *Save (API Format)* (o nome varia por versão). **O JSON normal do editor
   não serve** (dá `node_errors`).
2. Salve em `backend/workflows/ltx2.api.json` (para imagem→vídeo, um segundo arquivo, ex. `ltx2-i2v.api.json`).
3. Descubra os campos: `cd backend && npm run comfy:inspect -- workflows/ltx2.api.json` lista prompt, imagem,
   largura/altura, quadros, seed e prefixo do arquivo.
4. Troque **o valor inteiro** do campo por um placeholder (string exata):

| Placeholder | Preenchido com |
|---|---|
| `{{prompt}}` / `{{negative}}` | prompt e "o que evitar" |
| `{{image}}` | nome da imagem enviada ao ComfyUI (`/upload/image`) |
| `{{width}}` `{{height}}` | `low`: 384×672 (9:16), 640×352 (16:9), 512×512 (1:1) · `std`: 576×1024, 960×540, 768×768 · `pro`: 704×1280, 1280×704, 1024×1024 — ajuste em `comfyui.ts` |
| `{{frames}}` `{{fps}}` | quadros `8n+1` a partir da duração e de `COMFY_FPS` |
| `{{duration}}` | duração em segundos (workflows LTX 2.x que usam `duration` em vez de `frames`, ex. template oficial I2V) |
| `{{seed}}` | inteiro aleatório |
| `{{promptEnhance}}` | `true`/`false`: expansor de prompt do LTX (desligado por padrão para resultado previsível) |
| `{{cfg}}` | aderência ao prompt (padrão 1; 0–10) |
| `{{imgStrength}}` | força da imagem no estágio final 0–1 (padrão 0,7) |
| `{{sigmas1}}` / `{{sigmas2}}` | cronogramas do sampler por preset (`low`/`std`/`high`; `std` = template intacto) |
| `{{prefix}}` | `videogen/<id do job>` (prefixo do arquivo salvo) |

   Exemplo: `"width": 768` → `"width": "{{width}}"`. O tipo é preservado (número continua número).
5. O workflow precisa terminar num nó que **salva vídeo** (`.mp4`/`.webm`/`.mov`); o provedor procura a saída em
   `images`, `videos` ou `gifs` do `/history`.

## 6. Ligar na API do projeto

```ini
PROVIDER=comfyui
COMFY_URL=http://127.0.0.1:8188
COMFY_WORKFLOW=workflows/ltx2-t2v.api.json     # texto→vídeo (derivado do I2V validado; sem enhance de imagem)
COMFY_WORKFLOW_I2V=workflows/ltx2-i2v.api.json # imagem→vídeo: usado quando o pedido traz imagem
COMFY_FPS=24
COMFY_DURATIONS=5,10                           # em GPU pequena, ex.: 3,5
```
Inicie o ComfyUI, depois `npm run dev`; `GET /capabilities` deve listar `comfyui`. Teste com `-F provider=comfyui -F duration=5`.
Um workflow com `{{image}}` sem imagem no pedido retorna erro claro (`502`).

## 7. ComfyUI em outra máquina ou na nuvem

- Inicie com `--listen 0.0.0.0` e aponte `COMFY_URL=http://IP:8188`. **O ComfyUI não tem autenticação:** nunca exponha
  à internet; use rede privada (Tailscale/WireGuard) ou túnel com acesso restrito.
- O **ComfyUI Cloud** usa outro formato de API (`/api/...`, `X-API-Key`, `/api/history_v2`) e **não é suportado** por
  este provedor ainda (veja o [roadmap](../roadmap.md)).

## 8. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `/prompt` → `node_errors` | workflow não está em API Format, ou nó/modelo ausente | reexportar; instalar nós faltantes; conferir pastas dos modelos |
| Nós LTXVideo não aparecem | dependências não instaladas | `pip install -r requirements.txt` na pasta do nó; Python 3.12+; reiniciar |
| Falha de memória (OOM) | resolução/duração altas para sua VRAM | menor resolução, `COMFY_DURATIONS=3,5`, modelos INT8, `--reserve-vram` |
| Job `failed: workflow terminou sem vídeo` | falta nó de salvar vídeo ou extensão inesperada | conferir o nó de saída |
| Job fica `running` para sempre | ComfyUI parado/fila longa | ver console do ComfyUI; `JOB_TIMEOUT_MIN` encerra o job |
| Cancelar derrubou outro job | `/interrupt` afeta o job em execução | evitar jobs simultâneos no mesmo ComfyUI |
| Resultado diferente do manual | *Prompt Enhance* ligado ou seed diferente | desligar o aprimorador; fixar seed no workflow para testar |
