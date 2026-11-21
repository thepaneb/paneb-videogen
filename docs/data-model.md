# Modelo de dados

Fonte única: [`backend/src/model.ts`](../backend/src/model.ts). Derivado dos esquemas públicos de Kling, ComfyUI
e Veo (este último só como referência de projeto; **não implementado**). Verificado em 2026-11-17.

## Entidades

- **Status:** `queued | running | succeeded | failed | canceled` (terminais: os três últimos).
- **GenParams:** `prompt`, `negativePrompt?`, `durationSec`, `aspect` (`9:16|1:1|16:9`), `quality` (`low|std|pro`),
  `seed?` (só provedores com `features.seed`), `image?` (primeiro quadro), `lastImage?` (último quadro). Ajustes do
  ComfyUI: `promptEnhance?` (bool), `cfg?` (0–10), `imgStrength?` (0–1), `steps?` (`low|std|high`). As imagens são guardadas em
  `data/inputs/<jobId>-first|last.<ext>` (nomes internos em `imageFile/lastImageFile`, **não** expostos pela API) para permitir
  repetir/variar o job; são apagadas junto com o job.
- **Job:** `id`, `provider`, `providerJobId`, `status`, `params`, `output?`, `error?`, `attempts`, `idemKey?`, datas (ms).
- **Output:** `url` (`/files/<id>.mp4` ou URL remota de fallback), `durationSec?`, `mime`.
- **Capabilities** (por provedor): `durations[]`, `aspects[]`, `qualities[]`, `features{image,lastImage,negativePrompt,cancel,seed,tune[]}` (`tune` lista ajustes finos suportados, ex. ComfyUI: `promptEnhance,cfg,imgStrength,steps`).

## Mapeamento entre provedores

| Unificado | Kling (API legada) | ComfyUI | Veo (referência) |
|---|---|---|---|
| id no provedor | `data.task_id` (guardado como `<tipo>:<id>`) | `prompt_id` | `operation.name` |
| nosso id | `external_task_id` | `client_id` | — |
| estado | `task_status`: `submitted→queued`, `processing→running`, `succeed→succeeded`, `failed→failed` (+ `task_status_msg`) | `/history/{id}` vazio = `running`; `status.status_str` `success`/`error` | operação concluída/erro |
| vídeo | `task_result.videos[].url` (+ `duration`) | `outputs.<nó>.<images\|videos\|gifs>[]` → `/view?filename&subfolder&type` | vídeo gerado (URI/bytes) |
| duração | `duration` `"5"`/`"10"` | quadros `8n+1` (`{{frames}}`) | 4/6/8 s (Veo 3.x) |
| proporção | `aspect_ratio` (só text2video) | `{{width}}/{{height}}` | `aspectRatio` `16:9`/`9:16` |
| qualidade | `mode`: `std`/`pro` | definida no workflow | `resolution` |
| imagem inicial | `image` (base64 puro) | `POST /upload/image` + `{{image}}` | `image` |
| imagem final | `image_tail` | template First/Last Frame | `last_frame` |
| negativo | `negative_prompt` | `{{negative}}` | — |
| cancelar | não suportado | `POST /queue {delete}` + `POST /interrupt` | cancelar operação |

> A Kling tem também um **novo padrão de API** com vocabulário próprio (status `succeeded`, consulta `GET /tasks`).
> Ver [providers/kling.md](providers/kling.md). Quando for implementado, ele também será traduzido para este modelo.

## Esquema SQLite (`backend/data/videogen.db`, versão 2)

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL, provider_job_id TEXT NOT NULL,
  status TEXT NOT NULL, params TEXT NOT NULL,      -- JSON (StoredParams)
  output TEXT, error TEXT,                          -- JSON (Output); output.url guardado SEM assinatura
  attempts INTEGER NOT NULL DEFAULT 0,              -- erros transitórios seguidos
  idem_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, idem_key)                        -- idempotência é por usuário
);
```
**Migrações:** `backend/src/db.ts` mantém uma lista versionada aplicada na inicialização (`PRAGMA user_version`),
cada uma numa transação. Nunca edite uma migração antiga; acrescente a próxima. Há teste com banco v1
(`test/migration.test.ts`). `Job.userId` identifica o dono (chave de API → usuário; veja [deployment.md](deployment.md)).
