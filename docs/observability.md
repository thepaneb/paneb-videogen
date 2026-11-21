# Observabilidade

## Logs
Uma linha JSON por evento em `stdout` (`ts`, `level`, `msg` + campos). `LOG_LEVEL=debug|info|warn|error`. Cada resposta traz
`X-Request-Id` (reaproveita o do cliente, se vier). **Nunca** são registrados chaves, tokens nem a query string (ela carrega a
assinatura dos links de vídeo); `/healthz` e `/metrics` não geram log de acesso.

Eventos úteis: `http`, `job criado`, `job concluído` (com segundos), `erro ao consultar provedor`, `download falhou; usando URL remota`,
`encerrando`/`encerrado`.

## Métricas (`GET /metrics`, formato Prometheus)
Desabilitado (404) até você definir `METRICS_TOKEN`; então exige `Authorization: Bearer <token>`.

| Métrica | Tipo | Rótulos |
|---|---|---|
| `videogen_jobs_created_total` | counter | `provider` |
| `videogen_jobs_finished_total` | counter | `provider`, `status` (succeeded/failed/canceled) |
| `videogen_job_duration_seconds` | histogram | `provider` (do pedido ao fim; buckets 10 s … 900 s) |
| `videogen_provider_errors_total` | counter | `provider`, `op` (submit/poll) |
| `videogen_http_requests_total` | counter | `method`, `route` (padrão da rota, sem ids), `status` |
| `videogen_prompt_enhance_total` | counter | `outcome` (ok/error/limit) |
| `videogen_jobs_active` | gauge | `status` (queued/running) |
| `process_uptime_seconds`, `process_resident_memory_bytes` | gauge | — |

As métricas são **por processo** e zeram ao reiniciar (use `rate()`/`increase()` no Prometheus).

```yaml
# prometheus.yml
scrape_configs:
  - job_name: videogen
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["videogen.exemplo.com"] }]
```
Alertas sugeridos: taxa de `failed` alta, `videogen_job_duration_seconds` p95 acima do esperado, `videogen_jobs_active{status="running"}`
parado por muito tempo, crescimento de `videogen_provider_errors_total`.

## Encerramento limpo
`SIGTERM`/`SIGINT`: para de aceitar conexões, espera a rodada do worker terminar, fecha o SQLite e sai com código 0 (limite de 10 s).
Jobs em andamento **continuam** no provedor e são retomados pelo worker na próxima subida.

Kubernetes/Docker: `livenessProbe`/`readinessProbe` em `GET /healthz`; `terminationGracePeriodSeconds: 15`.
