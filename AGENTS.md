# AGENTS.md

Instruções para agentes de código e colaboradores. Idioma: documentação e commits em **português**; código e
identificadores em **inglês**.

## O que é este projeto

Monorepo: `backend/` (API Node/TypeScript que orquestra provedores de vídeo generativo) e `android/` (app Kotlin
+ Compose que consome a API). Fluxo: o app envia prompt/imagens → API cria um *job* num provedor → um worker
consulta o estado, baixa o vídeo para `backend/data/videos` → o app lista e toca.

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `backend/src/model.ts` | **Fonte única** do modelo de dados (tipos, estados, capacidades, contrato `VideoProvider`) |
| `backend/src/providers/` | Um arquivo por provedor + `index.ts` (registro). Veja `docs/adding-a-provider.md` |
| `backend/src/worker.ts` | Avança jobs ativos, copia vídeos, aplica timeout/retentativas |
| `backend/src/db.ts` | SQLite (`node:sqlite`) com migrações versionadas; consultas escopadas por usuário |
| `backend/src/auth.ts`, `signing.ts` | Chaves → usuário (hash SHA-256); links assinados HMAC para `/files` |
| `backend/src/app.ts` | `createApp()`: rotas HTTP, validação contra `capabilities`, idempotência, cota, repeat, enhance (não abre porta) |
| `backend/src/server.ts` | Processo: sobe app + worker e faz o encerramento limpo (SIGTERM) |
| `backend/openapi.yaml` | **Contrato da API**; `test/contract.test.ts` o confere contra o servidor |
| `backend/src/enhance.ts` | Aprimorador de prompt (API da Anthropic; guias por provedor) |
| `backend/src/log.ts`, `metrics.ts`, `inputs.ts` | Log JSON; métricas Prometheus; imagens de entrada em disco |
| `backend/test/` | Testes (`node:test`); nunca tocam rede nem provedores pagos |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile` | Implantação com HTTPS (ver `docs/deployment.md`; ainda não executados) |
| `backend/scripts/comfy-inspect.ts` | Ajuda a achar campos para placeholders num workflow do ComfyUI |
| `android/app/src/main/java/com/example/videogen/` | `Api.kt` (Retrofit/DTOs), `VideoViewModel.kt` (estado), `MainActivity.kt` (UI) |
| `docs/` | Documentação; os guias de provedores têm data de verificação no topo |

## Comandos

```bash
# backend (Node >= 22.13)
cd backend && npm ci && npm run check && npm test
PROVIDER=mock APP_KEY=dev npm run dev        # servidor local
# android (precisa do Android Studio/SDK; wrapper do Gradle ainda não commitado)
gradle -p android :app:assembleDebug
```

## Regras

1. **Custo e segredos.** Testes, CI e exemplos usam **somente `mock`** ou respostas simuladas. Nunca chame Kling
   real em teste. Nunca commite `.env`, chaves, `local.properties` ou `backend/data/`.
2. **`model.ts` manda.** Mudou um tipo/estado/capacidade? Atualize, no mesmo PR: provedores, `server.ts`, DTOs do
   Android (`Api.kt`), `docs/data-model.md` e `docs/api.md`.
3. **Contrato de provedor.** Um provedor só traduz de/para o modelo unificado (`submit`, `poll`, `cancel?`).
   Ele **não** persiste nada nem baixa arquivos (isso é do worker). O id devolvido por `submit` precisa bastar
   para `poll` **depois de reiniciar o servidor** (ex.: Kling embute o tipo no id).
4. **Estados.** `queued|running|succeeded|failed|canceled`. Erro transitório não falha o job (o worker conta
   tentativas); só estados terminais do provedor ou timeout fecham o job.
5. **Capacidades.** O app monta a UI a partir de `GET /capabilities`. Recurso novo = campo em `Capabilities` +
   validação em `server.ts` + UI condicional no Android.
6. **Docs de provedor envelhecem.** APIs de vídeo mudam rápido (a Kling já tem dois padrões de API). Ao mexer num
   provedor, reconfira a documentação oficial e atualize a data "Verificado em" do guia. Não afirme preços,
   limites ou nomes de modelo sem fonte.
7. **Android.** Segredos/URLs vêm de `android/local.properties` (`videogen.apiBaseUrl`, `videogen.appKey`).
   HTTP em texto puro só no build `debug`. Sem SDK disponível, diga que o build **não foi verificado**.
8. **Mudanças pequenas e verificáveis.** Rode `npm run check && npm test` antes de concluir. Não adicione
   dependência sem necessidade (o backend é enxuto de propósito).

## Armadilhas conhecidas

- `node:sqlite` é experimental: exige Node >= 22.13 e imprime um aviso (esperado).
- Workflow do ComfyUI precisa estar em **API Format**; o formato normal do editor dá `node_errors`.
- `/interrupt` do ComfyUI interrompe o job **em execução**, não necessariamente o seu (ver `comfyui.ts`).
- O ComfyUI Cloud usa outros caminhos (`/api/...`, `/api/history_v2`, `X-API-Key`); o provedor atual é para
  ComfyUI **local/self-hosted**.
- Kling: URLs de saída expiram; o worker copia o vídeo para o storage local. Falha de download cai para a URL remota.
- `/files/*` exige link assinado (`exp`+`sig`), gerado em `dto()`; o banco guarda `output.url` **sem** assinatura. Não
  devolva `output.url` cru numa rota nova: passe por `dto()`.
- Toda rota de job deve checar o dono (`owned()`); consultas novas no `db.ts` recebem `userId`.
- Esquema do banco: só por **nova migração** em `db.ts` (+ teste). Nunca edite uma antiga.
- **Rota nova = atualizar `openapi.yaml`** (o teste de contrato falha se faltar rota, status ou schema). Mudou o JSON? Atualize
  o schema e os DTOs do Android (`Api.kt`).
- Nunca registre em log a query string, chaves ou tokens (a query tem a assinatura dos links). Use `log.*`, não `console.*`.
- Métrica nova: registre em `metrics.ts` (e na tabela de `docs/observability.md`); evite rótulos de alta cardinalidade (ids, prompts).
- O aprimorador envia o prompt a um terceiro (Anthropic): não envie imagens nem dados de outros usuários.
- Seed: a API grava a seed efetiva em `params.seed`; provedor sem `features.seed` não deve receber/expor seed.
- Se não houver `APP_KEY`/`APP_KEYS`, o servidor deve recusar iniciar (teste de segurança cobre `loadUsers`).

## Definição de pronto

`npm run check` e `npm test` passam · docs afetadas atualizadas · nenhum segredo no diff · mudança de API/modelo
refletida em `docs/` e no Android · limitações não verificadas declaradas no PR.
