# Guia de engenharia (backend)

## Provedores (`src/providers/`)

Um arquivo por provedor + `index.ts` (registro). Contrato (`model.ts`):

- `submit(params, jobId) -> providerJobId`: o id devolvido precisa bastar para `poll` **depois de reiniciar o servidor**.
- `poll(id) -> {status, remoteUrl?, ...}`: `running` enquanto não termina; terminal só com `succeeded`/`failed` (+ `error` claro).
- `cancel?(id)` opcional; ComfyUI usa `/queue` + `/interrupt` (atenção: o interrupt afeta o job em execução, não necessariamente o seu).
- Placeholders de workflow ComfyUI em **API Format** (nunca o JSON do editor): `{{prompt}} {{negative}} {{image}} {{seed}} {{width}} {{height}} {{frames}} {{fps}} {{duration}} {{prefix}}` (+ `{{cfg}} {{imgStrength}} {{sigmas1}} {{sigmas2}} {{promptEnhance}}` no template LTX 2.3). Tipos preservados pelo `fill()`.

## Worker e robustez

- Polling a cada 4 s, uma rodada por vez (`current`); erro de rede conta tentativa (máx. 5) sem falhar o job.
- Toda chamada ao ComfyUI tem timeout (`AbortSignal.timeout`: 30 s API, 60 s upload, 120 s download) para um Comfy travado não congelar a fila.
- Watchdog de 180 s: se uma rodada exceder o pior caso (poll + download), loga erro e destrava para a próxima tentar. Alarmes repetidos com a fila vazia eram a race da trava síncrona (corrigida em 2026-11-21, com regressão em `test/ops.test.ts`); se o alarme voltar, investigue o provedor/rede antes de mexer no worker.
- `drop(id)` libera o WebSocket de progresso ao expirar/cancelar/deletar um job (sem derrubar a execução no Comfy).
- Download atômico: `.tmp` + `rename`, teto de 500 MB (corta no `content-length` e no corpo) e recusa de `content-type` não-vídeo (com fallback para URL remota).
- Timeout de job (`JOB_TIMEOUT_MIN`, padrão 15, validado na subida junto com `DAILY_LIMIT`, `FILES_TTL_MIN`, `MAX_VARIATIONS` e `COMFY_FPS` — valor inválido derruba o boot em vez de desligar proteções).
- Idempotência à prova de corrida: `UNIQUE(user_id,idem_key)` violado retorna `200` com o job existente em vez de 502.

## Validação e erros

- Toda entrada passa por validação contra `capabilities` (duração/proporção/qualidade/seed/intervalos); erro de cliente = `400` com mensagem em português; falha de provedor = `502`.
- Uploads: `multer.memoryStorage()` com `limits.fileSize = 10 MB` e `fields([image, lastImage], maxCount 1)` — nada além disso é aceito.
- Nunca logue query string, chaves ou tokens (a query carrega a assinatura). Use `log.*`, nunca `console.*` (JSON, uma linha por evento) — única exceção: erro fatal de boot em `server.ts`, que vai para stderr via `console.error` antes do `exit(1)` (comportamento coberto por teste).

## Testes (`backend/test/`, `node:test`, sem rede nem provedores pagos)

- `contract.test.ts`: rotas, autenticação, idempotência, repeat/variações, cota, links assinados — espelha o OpenAPI.
- `core.test.ts`: `fill`, `framesFor` (8n+1), `wsProgress`, mediana, ciclo de vida do `db`, Kling (mockado).
- `ops.test.ts`: métricas Prometheus, encerramento limpo (pulado no Windows — sem SIGTERM gracioso lá), recusa sem `APP_KEY` (hermético via `DOTENV_CONFIG_PATH`).
- `security.test.ts`, `migration.test.ts`: auth/assinaturas e migrações de banco.
- Definição de pronto: `npm run check && npm test` verdes · docs afetadas · nenhum segredo no diff.

## Convenções

- TypeScript estrito (`tsc --noEmit` limpo); sem `any` novo salvo em fronteiras (I/O, JSON externo).
- Nomes em inglês no código; mensagens de erro/log e docs em português.
- Mudança de comportamento = teste que a cubra; mudança de contrato = `openapi.yaml` + DTOs Android + docs.

## Aderência verificada (2026-11-21)

- Conforme: contrato de provedor respeitado (sem persistência/download em provedores); validação completa incl. knobs (`cfg`, `imgStrength`, `steps`, `promptEnhance` com faixas); idempotência; testes herméticos (sem `.env` local).
- Parcial: `mock` guarda estado em memória (não sobrevive a restart — aceito: só desenvolvimento).
- Assumido: `jsonwebtoken` está nas dependências mas sem uso no código — candidato a remoção futura (ver guia de segurança).
