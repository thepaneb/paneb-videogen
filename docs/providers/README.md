# Guias dos provedores

Verificado em **2026-11-17**. APIs de vídeo mudam rápido: antes de depender de preço, limite ou nome de modelo,
confirme na documentação oficial linkada em cada guia.

| | mock | kling | comfyui (LTX) |
|---|---|---|---|
| Custo | zero | pago por segundo gerado, via pacotes pré-pagos | zero por vídeo (energia, tempo, GPU) |
| Hardware | — | nenhum | GPU NVIDIA potente (oficial: 32 GB+ de VRAM) |
| Qualidade | vídeo de exemplo | alta, com opção de áudio nos modelos novos | alta com GPU grande; limitada em GPU pequena |
| Latência | ~15 s (simulada) | dezenas de segundos a alguns minutos | depende da GPU/resolução |
| Privacidade | local | prompts e imagens vão para a nuvem | tudo local |
| Setup | nenhum | conta + pacote + chave | instalar ComfyUI, modelos e workflow |

## Qual escolher

1. **Desenvolvendo o app/API:** `mock`.
2. **Quer resultado bom já, sem hardware:** `kling` (comece com o pacote de teste e clipes de 5 s).
3. **Tem GPU grande (≥ 24–32 GB) e quer custo marginal zero:** `comfyui`.
4. **GPU com menos de 24 GB:** o LTX local é "não oficial": pode funcionar com variantes quantizadas,
   resoluções baixas e clipes curtos, mas espere lentidão e testes. Alternativas: `kling`, ou alugar uma GPU na nuvem
   e apontar `COMFY_URL` para ela.

## Guias

- [mock](mock.md) · [Kling](kling.md) · [ComfyUI + LTX](comfyui-ltx.md)
- Outro provedor? [Como adicionar](../adding-a-provider.md)
