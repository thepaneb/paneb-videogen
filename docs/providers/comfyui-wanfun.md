# Provedor ComfyUI + Wan 2.1 Fun Camera 1.3B (imagem→vídeo com câmera dirigida)

Verificado em **2026-11-21**: render real neste projeto — **RTX 3060 12 GB**,
imagem→vídeo de 3 s em 384×384 (`low`, 1:1, `Zoom In`) em **~2 min** (20 passos, cfg 6),
e movimento por pedido validado (`camera=Pan Left`, ~2 min). Oficial:
[exemplo camera_image_to_video](https://github.com/comfyanonymous/ComfyUI_examples/tree/master/wan) ·
[modelos repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) ·
código [Wan-Video/Wan2.1](https://github.com/Wan-Video/Wan2.1) (Apache 2.0).

Proposta: dar vida a **uma foto com movimento de câmera** (zoom, pan, órbita) —
mesma classe leve do [1.3B texto→vídeo](comfyui-wan13.md), mas partindo de imagem.
Para imagem→vídeo sem câmera dirigida (ou clipes mais longos), use o
[Wan 2.2 5B](comfyui-wan.md); para só texto, o `comfyui-wan13`.

## 1. Modelos

De [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged)
(pasta `split_files/`). O encoder de texto e o VAE são os **mesmos** do Wan 2.1 1.3B —
se você já validou o guia [comfyui-wan13](comfyui-wan13.md), só faltam os dois primeiros:

| Arquivo | Pasta em `ComfyUI/models/` |
|---|---|
| `wan2.1_fun_camera_v1.1_1.3B_bf16.safetensors` (~3 GB, difusão Fun Camera 1.3B) | `diffusion_models/` |
| `clip_vision_h.safetensors` (~1 GB, visão para condicionar na imagem) | `clip_vision/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders/` (reaproveitado) |
| `wan_2.1_vae.safetensors` | `vae/` (reaproveitado) |

Confirme em `http://127.0.0.1:8188/models/diffusion_models` que o Fun aparece na lista.

## 2. Workflow pronto (formato API)

Este repo já traz `backend/workflows/wanfun-i2v.api.json`, derivado do exemplo oficial
`camera_image_to_video_wan_example.json`: mesmos nós (`UNETLoader` + `CLIPLoader` +
`VAELoader` + `CLIPVisionLoader`/`CLIPVisionEncode` + `WanCameraEmbedding` +
`WanCameraImageToVideo` + `ModelSamplingSD3` + `KSampler` + `VAEDecode` +
`CreateVideo` + `SaveVideo`), com placeholders:

| Placeholder | Preenchido com |
|---|---|
| `{{prompt}}` / `{{negative}}` | prompt e "o que evitar" |
| `{{image}}` | nome da imagem enviada ao ComfyUI (obrigatória — sem imagem o pedido falha com erro claro) |
| `{{motion}}` | movimento de câmera, de `COMFY_WANFUN_MOTION` (`Zoom In` padrão; opções: `Static`, `Pan Up`, `Pan Down`, `Pan Left`, `Pan Right`, `Zoom In`, `Zoom Out`, `Anti Clockwise (ACW)`, `ClockWise (CW)`) |
| `{{width}}` `{{height}}` | mesmas tabelas do 1.3B T2V (`low`: 512×320, 320×512, 384×384 · `std`: 832×480, 480×832, 512×512 · `pro`: 1024×576, 576×1024, 640×640) |
| `{{frames}}` `{{fps}}` | quadros `8n+1` a partir da duração e de `COMFY_FPS` (3 s → 73) |
| `{{seed}}` | inteiro aleatório |
| `{{prefix}}` | `videogen/<id do job>` (prefixo do arquivo salvo) |

Diferenças para o exemplo oficial (de propósito): 20 passos (o exemplo também usa 20;
cfg 6) e saída em `SaveVideo` (o exemplo salva WEBM; o provedor procura
`.mp4`/`.webm`/`.mov` no `/history`). O movimento de câmera pode ir **por pedido** (`camera`, `tune: ["camera"]`, validado contra as 9 opções do nó);
o padrão quando omitido vem de `COMFY_WANFUN_MOTION`.

## 3. Ligar na API do projeto

```ini
COMFY_WORKFLOW_WANFUN=workflows/wanfun-i2v.api.json
COMFY_WANFUN_DURATIONS=3,5   # clipes curtos: é provedor de foto com vida
COMFY_WANFUN_MOTION=Zoom In
```

Reinicie a API (`npm run start`); `GET /capabilities` deve listar `comfyui-wanfun`
(o registro só aparece quando o arquivo do workflow existe). Teste com imagem:
`-F provider=comfyui-wanfun -F duration=3 -F quality=low -F image=@foto.png`.

## 4. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `comfyui-wanfun` não aparece em `/capabilities` | `COMFY_WORKFLOW_WANFUN` aponta para arquivo inexistente | conferir caminho relativo à pasta `backend/` |
| `/prompt` → `Cannot find model` / `clip_vision` | `clip_vision_h.safetensors` fora de `clip_vision/` | baixar para a pasta certa (seção 1) |
| Pedido sem imagem falha | provedor exige imagem (`features.image: true`, sem T2V) | enviar `-F image=` ou usar `comfyui-wan13` |
| `COMFY_WANFUN_MOTION inválido` | nome fora da lista do nó `WanCameraEmbedding` | usar exatamente uma das 9 opções (seção 2) |
