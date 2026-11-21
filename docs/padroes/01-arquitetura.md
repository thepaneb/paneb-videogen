# Guia de arquitetura

## Visão do sistema

```
Android (Kotlin/Compose) ──HTTP──► API (Express) ──► ComfyUI local (+GPU) ── vídeo ──► storage local
   criar · histórico · player       fila SQLite · worker ──► Kling (nuvem, opcional)
                            links de vídeo assinados ──► mock (desenvolvimento)
```

Papéis: o **app** é só interface (monta a UI a partir de `GET /capabilities`); a **API** orquestra
(provedores, fila, cotas, arquivos); o **ComfyUI** executa a difusão; o **worker** avança jobs em
segundo plano e baixa o vídeo para `backend/data/videos`.

## Camadas (backend/`src`)

| Arquivo | Papel (não acumula outro) |
|---|---|
| `model.ts` | **Fonte única** de tipos, estados e do contrato `VideoProvider` |
| `providers/*.ts` | Tradução de/para o modelo unificado (`submit`/`poll`/`cancel?`). Sem persistência, sem download |
| `worker.ts` | Avança jobs ativos, copia vídeos (`store`), aplica timeout e retentativas |
| `db.ts` | SQLite + migrações versionadas; consultas sempre escopadas por usuário |
| `auth.ts`, `signing.ts` | Chaves → usuário (SHA-256); links HMAC com expiração para `/files` |
| `app.ts` | `createApp()`: rotas, validação contra `capabilities`, idempotência, cota |
| `server.ts` | Processo: sobe app + worker, encerramento limpo (SIGTERM/SIGINT) |
| `enhance.ts` | Aprimorador de prompt (Anthropic; só texto, nunca imagens de usuários) |

Regras de dependência: rotas dependem de provedores via `registry()`; provedores **não** importam
`db.ts` nem escrevem disco (exceção: leitura do workflow em `COMFY_WORKFLOW`); worker depende de
provedores + `db.ts`; trabalho de fundo só é iniciado por `server.ts` (`startWorker()`; o `setInterval`
do polling vive em `worker.ts`).

## Fluxo de um job

1. `POST /jobs` valida contra `capabilities` (duração, proporção, qualidade, seed) → `submit` no provedor → grava `queued`.
2. A cada 4 s o worker chama `poll(providerJobId)`; erro transitório conta tentativa (máx. 5), estado terminal ou timeout (`JOB_TIMEOUT_MIN`) fecha o job.
3. No `succeeded`, o worker baixa o vídeo (`store`; fallback para URL remota) e grava `output.url` **sem assinatura**; a assinatura HMAC (`exp`+`sig`) é aplicada só no DTO de saída.
4. O app lê `GET /jobs` (com `progress`/`etaSec` calculados — estimativa, não medição) e toca via `/files`.

## Contratos entre camadas

- **OpenAPI** (`backend/openapi.yaml`) é o contrato app↔API; `test/contract.test.ts` quebra se rota, status ou schema divergir.
- **Capacidades** (`GET /capabilities`) dirigem a UI: recurso novo = campo em `Capabilities` + validação em `server.ts`/`app.ts` + UI condicional no Android.

## Aderência verificada (2026-11-21)

- Conforme: separação provedores/worker/db/app; contrato OpenAPI testado; idempotência (`Idempotency-Key`); validação contra capabilities; sem persistência em provedores.
- Parcial: o worker é em-processo com trava simples (promise da rodada em andamento) + watchdog de
  180 s com alarme; em 2026-11-21 achou-se e corrigiu-se a causa dos alarmes repetidos com a fila
  vazia (rodada sem `await` concluía de forma síncrona e o `finally` interno limpava a trava antes da
  atribuição — ver `worker.ts` e o teste de regressão em `test/ops.test.ts`). Para um único usuário
  local é adequado; multiusuário/fila maior pediria worker dedicado (ex.: processo separado).
- Assumido: sem migrations fora de `db.ts`, sem ORM, sem dependências além do enxuto (`express`, `multer`, `tsx`, `dotenv` + tipos).
