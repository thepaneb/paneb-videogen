# Referência da API

**Fonte da verdade: [`backend/openapi.yaml`](../backend/openapi.yaml)** (também servido em `GET /openapi.yaml`).
O teste `backend/test/contract.test.ts` falha se uma rota existir sem estar no contrato (ou vice-versa) ou se uma
resposta real divergir do schema. Dá para gerar clientes/DTOs a partir dele (ex.: `openapi-generator`).

Base: `http://localhost:3000`. Autenticação: `X-App-Key: <chave>` (uma chave de `APP_KEY`/`APP_KEYS`; cada chave é um
usuário e só enxerga os próprios jobs, os de outros respondem `404`). Sem chave: `/healthz`, `/openapi.yaml`, `/files/*`
(link assinado) e `/metrics` (token próprio).

| Método e rota | Descrição |
|---|---|
| `GET /capabilities` | Provedores habilitados e o que cada um suporta; `promptEnhance` indica se o aprimorador está ligado; `push` indica se o push (FCM) está configurado |
| `POST /jobs` | Cria um job (`multipart`): `prompt`, `provider`, `negativePrompt`, `duration`, `aspect`, `quality`, `seed`, `image`, `lastImage`, `promptEnhance`, `cfg`, `imgStrength`, `steps` (`low`/`std`/`high`), `camera` (movimento de câmera, só provedores com `tune` `camera`). `Idempotency-Key` opcional |
| `GET /jobs` · `GET /jobs/:id` · `GET /jobs/:id/events` | Lista (`limit`, `before`) · um job · **event stream SSE** do job (`event: job` com o estado atual no abertura + cada mudança de estado; encerra quando o cliente fecha a conexão) |
| `POST /jobs/:id/repeat` | **Repete/varia** um job: `{ count (1..MAX_VARIATIONS), sameSeed, prompt, provider, duration, aspect, quality, negativePrompt, promptEnhance, cfg, imgStrength, steps, camera }` (só o que for enviado sobrescreve; `provider` troca o executor — rascunho→final). Reusa parâmetros e imagens guardadas |
| `POST /jobs/:id/cancel` · `DELETE /jobs/:id` | Cancela · remove job, vídeo e imagens de entrada (travado devolve `409`) |
| `POST /jobs/:id/lock` · `POST /jobs/:id/unlock` | Trava/destrava contra exclusão manual e limpeza automática |
| `POST /prompt/enhance` | `{ prompt, provider?, hasImage? }` → `{ enhanced }` ([guia](prompt-enhancement.md)) |
| `POST /push/tokens` · `DELETE /push/tokens` | Registra/remove o token FCM do aparelho (`{ token }`); o worker avisa ao concluir cada job |
| `GET /healthz` · `GET /metrics` | Saúde · métricas Prometheus ([observabilidade](observability.md)) |
| `GET /files/<arquivo>?exp=&sig=` | Vídeo (link assinado, com validade, Range) |

## Limites de taxa

- **`POST /jobs`** e **`POST /jobs/:id/repeat`**: no máximo `RATE_JOBS_PER_MINUTE` criações por usuário por minuto
  (padrão `10`; `0` desliga). Exceder o limite → **429** com cabeçalho `Retry-After` (segundos até tentar de novo).
- Junto com o teto diário (`DAILY_LIMIT`, existente). `GET`, `DELETE`, `POST /jobs/:id/cancel`, `lock` e `unlock`
  não são limitados — apenas as criações; um `repeat` com `count: N` consome N slots.
- Quando o uso de limite chega a 50%, é registrado um evento de alerta no log (`limite de taxa de criação de jobs
  a 50%: aproximando-se do teto`); a métrica `videogen_rate_limit_rejected_total` conta as 429 por rota (ver
  [observability](observability.md)).

## Control plane do worker (`ADMIN_TOKEN`)

Rotas `GET /admin/worker/status`, `POST /admin/worker/pause|resume|run-now` e `GET /admin/stats` exigem
`Authorization: Bearer <ADMIN_TOKEN>`; sem `ADMIN_TOKEN` no ambiente respondem **404** (mesmo padrão do `/metrics`).

- `GET /admin/worker/status` → `{ paused, depth, inFlight[], stuck[] }`: profundidade da fila (jobs ativos),
  ids sendo avançados na rodada atual e travados (`stuckSec` sem `updatedAt` há mais de `WORKER_STUCK_MIN`, padrão 10).
- `POST /admin/worker/pause` para o tick automático (rodadas manuais continuam); `resume` retoma.
- `POST /admin/worker/run-now` força uma rodada agora (vale mesmo pausado) → `{ started, paused, depth }`
  (`started: false` quando já há rodada em andamento).
- Cada ação incrementa `videogen_worker_admin_total{action}` (ver [observability](observability.md)).

## Painel de desempenho (`GET /admin/stats?days=30`)

Por provedor na janela (`days` 1–365): volume (`jobs`), terminais (`succeeded/failed/canceled`), `successRate`
e `p50Sec`/`p95Sec` de conclusão (só `succeeded`; `null` sem histórico) + `topPrompts` (10 mais frequentes,
só os primeiros 48 caracteres — sem texto completo).

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

## Eventos do job (SSE)

`GET /jobs/:id/events` — servidor abre o fluxo com o estado atual do job (`event: job`) e reenvia o mesmo
evento a cada mudança de estado. O evento traz o mesmo schema do `GET /jobs/:id` (`status`, `output`, `error`,
`progress`, `etaSec`). O cliente deve fechar o stream quando a conexão cair; para recuperar, refaz
`GET /jobs/:id` (estado atual).

> Útil em substituição ao polling de 4 s do app: o `queued → running → succeeded` chega quase em tempo real.

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
