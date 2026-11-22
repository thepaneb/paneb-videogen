# Provedor agregador genérico

> Verificado em **2026-11-22**.

Permite usar qualquer API REST de texto→vídeo como provedor **sem escrever código nenhum**. Cada entrada em
`GENERIC_PROVIDERS` vira um provedor chamado `generic-<nome>` (ex.: `generic-replicate`).

## Como ligar

```bash
PROVIDER=generic-replicate
GENERIC_PROVIDERS=replicate
GENERIC_REPLICATE_URL=https://api.replicate.com
GENERIC_REPLICATE_CREATE=/v1/predictions
GENERIC_REPLICATE_POLL=/v1/predictions/{id}
GENERIC_REPLICATE_AUTH_HEADER=Authorization
GENERIC_REPLICATE_AUTH_VALUE=Token <sua-chave>
GENERIC_REPLICATE_CAPS={"durations":[5,10],"aspects":["9:16","1:1","16:9"],"qualities":["standard","hd"]}
```

O app/API mostra o nome `generic-replicate` na tela de seleção (quando há mais de um provedor).

## Variáveis (por provedor; NAME = nome do provedor em MAIÚSCULO, ex.: `REPLICATE`)

- `GENERIC_<NAME>_URL` (obrigatório): base da API; caminhos relativos (`/...`) saem dele.
- `GENERIC_<NAME>_CREATE` (obrigatório): POST path de criação do job (ou URL absoluta).
- `GENERIC_<NAME>_POLL` (obrigatório): GET path de consulta, com `{id}` substituído pelo id do provedor.
- `GENERIC_<NAME>_ID_FIELD`: caminho pontoado do id no JSON de criação (padrão `request_id`).
- `GENERIC_<NAME>_STATUS_FIELD`: campo de status no JSON de consulta (padrão `status`).
- `GENERIC_<NAME>_STATUS_MAP`: JSON personalizado, ex.: `{"processing": "running"}`. Códigos não listados → `running`;
  use chaves/valores `succeeded`/`failed`/`canceled` nos valores finais.
- `GENERIC_<NAME>_VIDEO_FIELD`: alternativas separadas por `|` (padrão `output`); se o valor for objeto,
  usa `url` ou `uri`. Em Replicate, `output` só vem no JSON de consulta (bem-sucedida).
- `GENERIC_<NAME>_DURATION_FIELD`: caminho pontoado opcional do `durationSec` retornado.
- `GENERIC_<NAME>_CREATE_BODY`: JSON enviado no POST de criação, com substituições de `{prompt}`, `{negativePrompt}`,
  `{durationSec}`, `{aspect}`, `{quality}`, `{seed}` (vazio por padrão: alguns providers mapeiam a entrada direto).
- `GENERIC_<NAME>_AUTH_HEADER` + `GENERIC_<NAME>_AUTH_VALUE`: cabeçalho e valor enviados em todas as chamadas
  (ex.: `Authorization` + `Bearer <chave>`; vazio = sem auth).
- `GENERIC_<NAME>_CANCEL`: POST path de cancelamento com `{id}` (opcional; sem ele o `cancel` dá erro).
- `GENERIC_<NAME>_CAPS`: JSON `{ "durations": [5, 10], "aspects": ["9:16", "16:9"], "qualities": ["standard", "hd"], "features": {...} }`
  (obrigatório) — as quotas e limites anunciados à interface são os da API do provider.

## Exemplos

### Replicate

```bash
GENERIC_PROVIDERS=replicate
GENERIC_REPLICATE_URL=https://api.replicate.com
GENERIC_REPLICATE_CREATE=/v1/predictions
GENERIC_REPLICATE_POLL=/v1/predictions/{id}
GENERIC_REPLICATE_AUTH_HEADER=Authorization
GENERIC_REPLICATE_AUTH_VALUE=Token <sua-chave>
GENERIC_REPLICATE_CAPS={"durations":[5,10],"aspects":["9:16","1:1","16:9"],"qualities":["standard","hd"]}
```

`create` devolve `id` (`ID_FIELD`); `poll` devolve `status: "succeeded"` e a URL em `output`; quando falha, `error` do `message`.

### Fal

```bash
GENERIC_PROVIDERS=fal
GENERIC_FAL_URL=https://fal.ai
GENERIC_FAL_CREATE=/v1/requests
GENERIC_FAL_POLL=/v1/requests/{id}/status
GENERIC_FAL_VIDEO_FIELD=video|url        # em ESTADO_SUCCESSO a URL está em video.url
GENERIC_FAL_AUTH_HEADER=Authorization
GENERIC_FAL_AUTH_VALUE=Bearer <sua-chave>
GENERIC_FAL_CAPS={"durations":[5,10],"aspects":["9:16","1:1","16:9"],"qualities":["std","pro"]}
```

`poll` trata `status: "COMPLETED"` como sucesso (mapa padrão).

## Como funciona

- `POST` de criação → id pela `ID_FIELD`.
- `GET` de consulta → status pela `STATUS_FIELD` (mapeado por `STATUS_MAP`, padrão `succeeded/completed/done/finished`
  → sucesso, `failed/error` → falha, `canceled/cancelled` → cancelado, o resto → em execução) + `remoteUrl` pela `VIDEO_FIELD`.
- Cancelagem (se `CANCEL` estiver configurado) → `POST` com `{id}`; sem endpoint, `cancel` apenas avisa que não é suportado.

## Limitações (v1)

- Primeira versão do provedor: `features.image=false`, `features.seed=false`, sem `cancel` a menos que endpoint configurado.
- Consultas de status usam um `GET` por rodada do worker (4 s); a adaptação por agregador segue, sem ser interactive-time.
- Timeout fixo de 30 s por chamada (`AbortSignal.timeout`); sem retentativa nativa (o worker já retentra).

## Erros

- HTTP ≠ 2xx no create/poll: erro com status `502` do worker (`agregador HTTP <status>`).
- JSON não parseável no poll: vazio de dados → job segue em execução (rever a resposta).
- Id inexistente no create response: erro claro.
