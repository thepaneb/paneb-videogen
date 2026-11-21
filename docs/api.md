# Referência da API

**Fonte da verdade: [`backend/openapi.yaml`](../backend/openapi.yaml)** (também servido em `GET /openapi.yaml`).
O teste `backend/test/contract.test.ts` falha se uma rota existir sem estar no contrato (ou vice-versa) ou se uma
resposta real divergir do schema. Dá para gerar clientes/DTOs a partir dele (ex.: `openapi-generator`).

Base: `http://localhost:3000`. Autenticação: `X-App-Key: <chave>` (uma chave de `APP_KEY`/`APP_KEYS`; cada chave é um
usuário e só enxerga os próprios jobs, os de outros respondem `404`). Sem chave: `/healthz`, `/openapi.yaml`, `/files/*`
(link assinado) e `/metrics` (token próprio).

| Método e rota | Descrição |
|---|---|
| `GET /capabilities` | Provedores habilitados e o que cada um suporta; `promptEnhance` indica se o aprimorador está ligado |
| `POST /jobs` | Cria um job (`multipart`): `prompt`, `provider`, `negativePrompt`, `duration`, `aspect`, `quality`, `seed`, `image`, `lastImage`, `promptEnhance`, `cfg`, `imgStrength`, `steps` (`low`/`std`/`high`). `Idempotency-Key` opcional |
| `GET /jobs` · `GET /jobs/:id` | Lista (`limit`, `before`) · um job |
| `POST /jobs/:id/repeat` | **Repete/varia** um job: `{ count (1..MAX_VARIATIONS), sameSeed, prompt, duration, aspect, quality, negativePrompt, promptEnhance, cfg, imgStrength, steps }` (só o que for enviado sobrescreve). Reusa parâmetros e imagens guardadas |
| `POST /jobs/:id/cancel` · `DELETE /jobs/:id` | Cancela · remove job, vídeo e imagens de entrada |
| `POST /prompt/enhance` | `{ prompt, provider?, hasImage? }` → `{ enhanced }` ([guia](prompt-enhancement.md)) |
| `GET /healthz` · `GET /metrics` | Saúde · métricas Prometheus ([observabilidade](observability.md)) |
| `GET /files/<arquivo>?exp=&sig=` | Vídeo (link assinado, com validade, Range) |

## Previsão de conclusão (`progress`, `etaSec`)

Todo `Job` traz `progress` (0 na fila; rodando: fração ao vivo do provedor — passos do sampler via
WebSocket do ComfyUI — ou ~tempo decorrido/mediana; 1 pronto; `null` em `failed`/`canceled`)
e `etaSec` (segundos estimados até concluir; `null` em `failed`/`canceled`). A mediana usa os jobs concluídos do
mesmo provedor e duração (últimos 20); sem histórico, usa um palpite (mock 15 s, ComfyUI 12 min, Kling 5 min).
É estimativa, não medição do ComfyUI: use para barra de progresso e "≈ N min restantes".

## Seed, variações e repetição

- Em provedores com `features.seed` (ComfyUI, mock) a API **sempre registra a seed efetiva** em `params.seed`, mesmo que
  você não envie uma. Enviar `seed` reproduz o mesmo ponto de partida; sem `features.seed` (Kling legado) ela é ignorada.
- `POST /jobs/:id/repeat` com `count: 3` cria 3 jobs novos, cada um com **seed nova**; com `sameSeed: true` reaproveita a
  seed original (reprodução). Passe `prompt` para variar o texto mantendo o resto.
- As imagens de entrada ficam em `data/inputs/` enquanto o job existir; sem elas (`409`) não dá para repetir um job de
  imagem→vídeo. Com `Idempotency-Key`, cada item usa `<chave>#<índice>` e uma retentativa não duplica nem gasta cota.
- Sucesso parcial: se o 2º de 3 pedidos falhar no provedor, a resposta é `201` com os itens criados e um campo `error`.

## Erros (`{ "error": "mensagem" }`)

`400` validação · `401` chave ausente/errada · `403` (só `/files`) link inválido/expirado · `404` inexistente ou de outro usuário ·
`409` imagem de origem ausente · `429` cota diária atingida · `501` recurso não configurado (aprimorador) · `502` o provedor falhou.

```bash
H='X-App-Key: dev'
curl -H "$H" localhost:3000/capabilities
curl -H "$H" -F prompt="um gato astronauta" -F duration=5 -F seed=42 localhost:3000/jobs
curl -H "$H" -H 'Content-Type: application/json' -d '{"count":3}' localhost:3000/jobs/<id>/repeat
curl -H "$H" -H 'Content-Type: application/json' -d '{"prompt":"lago ao amanhecer"}' localhost:3000/prompt/enhance
```
