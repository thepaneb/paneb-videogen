# Guias dos provedores

Verificado em **2026-11-17**. APIs de vídeo mudam rápido: antes de depender de preço, limite ou nome de modelo,
confirme na documentação oficial linkada em cada guia.

| | mock | kling | comfyui (LTX) | comfyui-wan (Wan 2.2 5B) | comfyui-wan13 (Wan 2.1 1.3B) | comfyui-wanfun (Fun Camera 1.3B) |
|---|---|---|---|---|---|---|
| Custo | zero | pago por segundo gerado, via pacotes pré-pagos | zero por vídeo (energia, tempo, GPU) | zero por vídeo (energia, tempo, GPU) | zero por vídeo (energia, tempo, GPU) | zero por vídeo (energia, tempo, GPU) |
| Hardware | — | nenhum | GPU NVIDIA potente (oficial: 32 GB+ de VRAM) | GPU NVIDIA 8 GB+ (5B com offloading; testado em 12 GB) | GPU modesta (T2V 480p; 2–3× mais rápido que o 5B) | GPU modesta (I2V com câmera; mesma classe 1.3B) |
| Qualidade | vídeo de exemplo | alta, com opção de áudio nos modelos novos | alta com GPU grande; limitada em GPU pequena | boa em 480–720p; 14B só com GPU grande | rascunho em 480p; final no 5B | foto com movimento de câmera, 480p |
| Latência | ~15 s (simulada) | dezenas de segundos a alguns minutos | depende da GPU/resolução | minutos por clipe em GPU média | ~3 min (3 s, low) na RTX 3060 12 GB | ~2 min (3 s, low) na RTX 3060 12 GB |
| Privacidade | local | prompts e imagens vão para a nuvem | tudo local | tudo local | tudo local | tudo local |
| Setup | nenhum | conta + pacote + chave | instalar ComfyUI, modelos e workflow | instalar ComfyUI, 3 modelos e workflow | instalar ComfyUI, 2 modelos (+ encoder do 5B) e workflow | instalar ComfyUI, Fun + clip_vision (+ base 2.1) e workflow |

## Qual escolher

1. **Desenvolvendo o app/API:** `mock`.
2. **Quer resultado bom já, sem hardware:** `kling` (comece com o pacote de teste e clipes de 5 s).
3. **Tem GPU grande (≥ 24–32 GB) e quer custo marginal zero:** `comfyui`.
4. **Tem GPU média (8–16 GB) e quer grátis:** `comfyui-wan` (Wan 2.2 5B; qualidade melhor que LTX em GPU pequena).
    Rascunho ainda mais rápido/barato: `comfyui-wan13` (Wan 2.1 1.3B, só texto→vídeo).
5. **GPU com menos de 24 GB (LTX):** o LTX local é "não oficial": pode funcionar com variantes quantizadas,
   resoluções baixas e clipes curtos, mas espere lentidão e testes. Alternativas: `kling`, ou alugar uma GPU na nuvem
   e apontar `COMFY_URL` para ela.

## Guias

- [mock](mock.md) · [Kling](kling.md) · [ComfyUI + LTX](comfyui-ltx.md) · [ComfyUI + Wan 2.2 5B](comfyui-wan.md) · [ComfyUI + Wan 2.1 1.3B (rascunho)](comfyui-wan13.md) · [ComfyUI + Fun Camera 1.3B](comfyui-wanfun.md)
- Outro provedor? [Como adicionar](../adding-a-provider.md)
