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

## Depende de você (precisa de chave, hardware ou SDK)
- [ ] **Provedor Kling no padrão novo** (modelos 3.0 Turbo e 4.0): capturar uma resposta real (3 s, 720p) e salvar como
      fixture em `backend/test/fixtures/`; então escrever `providers/kling-new.ts` (auth por API Key, `POST /text-to-video/<modelo>`,
      `GET /tasks`), traduzir `submitted/processing/succeeded/failed` e atualizar o guia.
- [ ] Validar o provedor Kling legado com credenciais reais (5 s, `std`) e registrar custo/latência no guia.
- [ ] Validar o provedor ComfyUI com um workflow LTX real; commitar um exemplo em `backend/workflows/`.
- [x] Commitar o Gradle wrapper (`gradle wrapper --gradle-version 8.9` em `android/`) e confirmar o build no CI.
- [x] **Upgrade do toolchain Android** (AGP 8.5.2→9.5.2, Gradle 8.9→9.9.1, compileSdk 34→37, okhttp 4→5.5.1, retrofit 3.0):
      o AGP 9 embute o Kotlin (removido `org.jetbrains.kotlin.android`; `compilerOptions` vai no padrão do `compileOptions`);
      CI usa o wrapper (`./gradlew`); `targetSdk` segue em 34 (sem mudança de comportamento em runtime).
- [ ] Rodar `docker compose up` num servidor real e ajustar o que aparecer.

## Produto (próximos passos)
- [ ] Limpeza automática de vídeos/jobs antigos (`RETENTION_DAYS`) e teto de espaço por usuário.
- [ ] Custo estimado por job e teto mensal em dinheiro por usuário/provedor.
- [ ] Manifests Kubernetes (Deployment, PVC, Ingress) e dashboard Grafana de exemplo.
- [ ] Gerar os DTOs do Android a partir do `openapi.yaml`.
- [ ] Notificação ao concluir (FCM): exige projeto Firebase (`google-services.json`) e um endpoint de registro de token.
- [ ] WorkManager e histórico offline (Room) no app.
- [ ] Login por senha/OAuth, em vez de chaves estáticas, se o serviço ficar público.
- [ ] Webhooks dos provedores que suportam (em vez de polling); Veo e agregadores (fal, Replicate) como provedores.
- [ ] Storage S3/R2 e Postgres para mais de uma instância.
- [ ] Provedor ComfyUI Cloud (caminhos `/api/...`, `X-API-Key`, `history_v2`).
