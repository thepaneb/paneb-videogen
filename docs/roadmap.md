# Roadmap

## Feito
- [x] Modelo de dados unificado, SQLite com **migrações versionadas**, worker, idempotência, limite diário.
- [x] Chaves **por usuário** (`APP_KEYS`), isolamento de jobs e cota por usuário; servidor não inicia sem chave.
- [x] Vídeos por **links assinados com validade** (`/files`), com Range para o ExoPlayer.
- [x] Docker, Compose e Caddy (HTTPS) escritos — **ainda não executados** (ver [deployment.md](deployment.md)).
- [x] ComfyUI: workflows separados texto→vídeo / imagem→vídeo, durações configuráveis.
- [x] Testes: modelo, segurança, migração, **contrato OpenAPI**, métricas e encerramento limpo (sem rede, sem custo).
- [x] **OpenAPI** (`backend/openapi.yaml`) conferido contra o servidor; logs JSON, `/metrics` (Prometheus), `SIGTERM` limpo.
- [x] **Repetir/variar** (`POST /jobs/:id/repeat`), seed registrada e reproduzível, imagens de entrada persistidas.
- [x] **Aprimorador de prompt** (`POST /prompt/enhance`) com guias por provedor; botão no app.
- [ ] Validar o aprimorador com a API real (nome do modelo, qualidade dos prompts por provedor).

## Sugeridos (evolução a considerar depois)

Evoluções sugeridas na sessão atual, para implementar em ordem de valor/esforço. Itens em branco no segundo estado = implementar pela equipe.

### Backend/API e operação

- [ ] **Pool de workers (concorrência real de jobs)** — o worker avança `advance(job)` um a um (hoje sequencial: `for (const j of listActive()) await advance(j)`); alternativa: claims/leases por job + `WORKER_CONCURRENCY`.
- [ ] **Eventos em tempo real:** rota `GET /jobs/:id/events` (SSE): status, progresso e saída pushados ao cliente; substitui polling de 4 s do app.
- [ ] **Provedor agregador genérico (fal / Replicate / Civitai API):** provedor configurável por ambiente (URL, auth, endpoints de criação/status, mapping de id/status/URL do vídeo); funciona sem código novo por provedor.
- [ ] **Control plane do worker:** `POST /admin/worker/pause|resume|run-now` + status do queue (depth, stuck); útil para Docker/K8s.
- [x] **Rate limits por usuário:** `POST /jobs` e `POST /jobs/:id/repeat`: no máx. `RATE_JOBS_PER_MINUTE` criações/usuário/minuto (padrão 10; `0` desliga) com 429 + `Retry-After`; alerta (log) a 50% do teto; métrica `videogen_rate_limit_rejected_total`. Teto de cota montada.
- [ ] **Medidor de custo real:** kWh/GPU do worker local via `nvidia-smi` + `GET /usage` (jobs, minutos, kWh, custo estimado por mês/usuário).
- [ ] **API de usuários/quotas:** `GET /users`, `POST /users`, `GET/POST /users/:id/quota|usage`, revogação de chaves (por `idemKey`); dashboard de chaves.
- [ ] **Export histórico:** `GET /jobs?export=csv|json`; snapshots para auditoria/export GDPR.

### Provedores

- [ ] **Veo (Google Vertex AI):** primeiro provedor nativo de alta qualidade (720p/1080p, 8 s).
- [ ] **Kling novo padrão (3.0 Turbo/4.0):** `providers/kling-new.ts` (`POST /v1/tasks`, `GET /tasks?request_id=`); cadastrar fixtures reais; validar modelo da aprimorador.
- [ ] **Wan 2.5 + Wan 2.5-A14B:** geração com áudio (até 30 s); atenção às exigências oficiais (ex.: de 15 a 30 s de tela).
- [ ] **WAN 2.2 5B (local):** validar carregamento e VRAM (RTX 3060 12 GB, validado na 3060 12 GB em 2026-11-21); registrar como novo provedor.
- [ ] **WAN 5B GGUF Q4 (local):** runner dedicado via `node.cpp`; validação rigorosa de memória/velocidade antes de registrar.
- [ ] **Upgrade do SR:** álgebra espacial do LTX (latent x2 — deferido no roadmap, validar loader no Comfy); upscale de vídeo raw via ffmpeg/OpenCV.

### Produto e apps

- [ ] **Trilhe de edição de vídeo:** OpenCV + ffmpeg: corte, concat, overlay, upscale, compressão; UI com JobType "edição".
- [ ] **Legendas automáticas (Whisper.cpp):** transcrever saída e burnar SRT/VTT; exportar legendas.
- [ ] **Áudio/fala (TTS):** Kokoro/Dia via API ou local: diálogo com timing em vídeo.
- [ ] **SDKs públicos:** `@videogen/client` (npm) + `videogen` (pip); `wait(jobId)`, download por link assinado (Range OK).
- [ ] **MCP server `videogen`:** tools: `create_job`, `list_jobs`, `get_job`, `await_job`, `list_providers` — para outros agents (OpenCode, Claude Code).
- [ ] **Histórico offline no app + sincronia:** Room com job local primeiro, upload em background, retry pendente, bulk generate (10 jobs no toque).
- [ ] **Agendamento de geração no app:** AlarmManager/WorkManager — "do dia" (8 jobs com Idempotency-Key).
- [ ] **Board de desempenho:** p50/p95/taxa de sucesso por provider (SQL histórico); top prompts (sem texto completo); painel próprio ou Grafana.
- [ ] **Alertas de qualidade:** p95 de duração acima do esperado; queue presa > 15 min; fallback de URLs expiradas; reensaio de uploads inválidos.
- [ ] **Timbre/branding (UI):** glassmorphism/cores por provider; tamanho/spacing tuning por device.
- [ ] **Preview animado:** miniaturas animadas dos 2–3 frames do vídeo durante a geração.
- [ ] **Backup automático:** dump do SQLite + compressão do `data/` (cron no Docker); restore + teste.

## Depende de você (precisa de chave, hardware ou SDK)
- [ ] **Provedor Kling no padrão novo** (modelos 3.0 Turbo e 4.0): capturar uma resposta real (3 s, 720p) e salvar como
      fixture em `backend/test/fixtures/`; então escrever `providers/kling-new.ts` (auth por API Key, `POST /text-to-video/<modelo>`,
      `GET /tasks`), traduzir `submitted/processing/succeeded/failed` e atualizar o guia.
- [ ] Validar o provedor Kling legado com credenciais reais (5 s, `std`) e registrar custo/latência no guia.
- [x] Validar o provedor ComfyUI com workflows LTX reais; commitados `ltx2-t2v.api.json` e `ltx2-i2v.api.json` (validados na RTX 3060 12 GB em 2026-11-21).
- [x] Commitar o Gradle wrapper (`gradle wrapper --gradle-version 8.9` em `android/`) e confirmar o build no CI.
- [x] **Upgrade do toolchain Android** (AGP 8.5.2→9.5.2, Gradle 8.9→9.9.1, compileSdk 34→37, okhttp 4→5.5.1, retrofit 3.0):
      o AGP 9 embute o Kotlin (removido `org.jetbrains.kotlin.android`; `compilerOptions` vai no padrão do `compileOptions`);
      CI usa o wrapper (`./gradlew`); `targetSdk` segue em 34 (sem mudança de comportamento em runtime).
- [ ] Rodar `docker compose up` num servidor real e ajustar o que aparecer.
- [ ] Validar a variante **Wan 5B em GGUF Q4** (`backend/workflows/wan2-t2v-gguf.api.json`, ver seção 7 do guia Wan): instalar o custom node ComfyUI-GGUF, baixar o `.gguf` e fazer 1 render; então registrar como provedor.
- [ ] Verificar se os MP4 do LTX saem **com áudio** (o workflow gera trilha; checar com `ffprobe` e documentar no guia).

## Produto (próximos passos)
- [x] Limpeza automática de vídeos/jobs antigos (`RETENTION_DAYS`, padrão 30; roda a cada rodada do worker, só terminais) e métrica `videogen_jobs_purged_total`. Teto de espaço por usuário segue pendente.
- [ ] Custo estimado por job e teto mensal em dinheiro por usuário/provedor.
- [ ] Manifests Kubernetes (Deployment, PVC, Ingress) e dashboard Grafana de exemplo.
- [ ] Gerar os DTOs do Android a partir do `openapi.yaml`.
- [x] Notificação ao concluir (FCM): o worker avisa (`pushJobFinished`, melhor esforço) e o app mostra
      notificação via `PushService` (sem plugin `google-services`: chaves `videogen.fcm*` em `local.properties`,
      conta de serviço em `FIREBASE_SERVICE_ACCOUNT`); validado com projeto real em 2026-11-21
      (notificação recebida no aparelho).
- [ ] WorkManager e histórico offline (Room) no app.
- [ ] Login por senha/OAuth, em vez de chaves estáticas, se o serviço ficar público.
- [ ] Webhooks dos provedores que suportam (em vez de polling); Veo e agregadores (fal, Replicate) como provedores.
- [ ] Storage S3/R2 e Postgres para mais de uma instância.
- [ ] Provedor ComfyUI Cloud (caminhos `/api/...`, `X-API-Key`, `history_v2`).
- [ ] Primeira imagem via **Z-Image Turbo no servidor** (T2I→I2V encadeado): investigado em 2026-11-21 e **adiado de propósito** — o `z_image_turbo` (11,7 GB) está no disco mas sem loader dedicado neste Comfy, e exigiria provedor de imagem + orquestração em duas etapas no worker (mudança arquitetural). Reavaliar se surgir loader nativo.
