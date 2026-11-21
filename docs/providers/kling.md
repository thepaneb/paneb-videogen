# Provedor Kling

Verificado em **2026-11-17**. Oficial: [console e documentação do desenvolvedor](https://app.klingai.com/global/dev/document-api/quickStart/userManual) ·
[página de chaves de API](https://kling.ai/dev/api-key).

> **Fontes.** Não consegui abrir a documentação oficial diretamente. Este guia consolida o que dois projetos
> independentes (que fotografam a documentação do fabricante e testaram a API de verdade) afirmam:
> [aself101/kling-api](https://github.com/aself101/kling-api) (testes ao vivo em 2026-09) e o
> [PR #412 do vibeframe](https://github.com/vericontext/vibeframe/pull/412), além de artigos de preço de terceiros.
> Trate números de preço como **estimativas** e confirme no console.

## 1. Duas APIs convivendo (importante)

| | **Legada** (implementada aqui) | **Nova** (ainda não implementada — [roadmap](../roadmap.md)) |
|---|---|---|
| Credencial | par **AccessKey + SecretKey** → JWT HS256 (validade ≤ 30 min) | **API Key** única |
| Criar | `POST /v1/videos/text2video` · `/image2video` (modelo em `model_name`) | `POST /text-to-video/<modelo>` (modelo no caminho) |
| Consultar | `GET /v1/videos/<tipo>/{task_id}` | `GET /tasks?task_ids=…` |
| Status | `submitted · processing · succeed · failed` | `submitted · processing · succeeded · failed` |
| Modelos (segundo os projetos acima) | v3, v2.6, v2.5 Turbo (+ extensão de vídeo) | **3.0 Turbo e 4.0 (GA 2026-10-28) existem só aqui**; também 3.0/omni |

### O que já está confirmado sobre o padrão novo (fontes: documentação oficial parcial + PR #412 do vibeframe, 2026-10-31)

- **Host:** os dois padrões usam `https://api-singapore.klingai.com` (o host antigo foi renomeado).
- **Texto→vídeo:** `POST /text-to-video/<modelo>` (ex.: `/text-to-video/kling-3.0`) com corpo `prompt` + `settings`
  (duração, proporção, áudio, multi-shot). **Imagem→vídeo e omni** usam `contents` tipados (`prompt`, `first_frame`, `last_frame`…).
- **Consulta:** `GET /tasks?task_ids=…` ou `?external_task_ids=…`; criação aceita `external_task_id`.
- **Modelos/preços** (vibeframe, 2026-10-31): `kling-4.0` 3–30 s, US$ 0,157/s (720p) e 0,235/s (1080p); `kling-3.0-turbo` 3–15 s,
  US$ 0,112/s (720p) e 0,14/s (1080p). Pedidos que o padrão novo não aceita (negative prompt, seed, referências,
  último quadro no 3.0 Turbo, 4:5) devem ser recusados antes de enviar.

**Por que ainda não está implementado:** não consegui ler o **formato exato da resposta** (caminhos de status/URL em
`/tasks`) nem confirmar o **cabeçalho da API Key** na documentação oficial (a página é renderizada por JavaScript). Em
vez de adivinhar campos num serviço pago, o provedor fica pendente até alguém com chave capturar uma resposta real
(clipe de 3 s em 720p no `kling-3.0-turbo` ≈ US$ 0,34) e salvá-la como *fixture* de teste. Passos em
[roadmap.md](../roadmap.md).

Consequências: com **AK/SK** você não acessa os modelos mais novos (o endpoint novo responde
`401 / 1002 "The current API does not support AK/SK"`). Modelos antigos foram descontinuados (a família 1.x), por isso o
padrão deste projeto é `kling-v2-6`; confirme no console qual `model_name` sua conta enxerga.

## 2. Setup passo a passo (API legada)

1. **Crie a conta de desenvolvedor** no console da Kling (link acima). A conta/assinatura **web não vale para a API**.
2. **Compre um pacote de recursos (resource pack).** A API é cobrada por pacotes pré-pagos, por tipo (vídeo/imagem).
   Fontes de terceiros citam um pacote de teste de ~US$ 9,80 (100 unidades, 5 tarefas simultâneas, 30 dias) e pacotes
   de produção a partir de ~US$ 700 (5.000 unidades, 180 dias). **Confirme os valores atuais no console.**
3. **Gere o par de chaves** (Access Key + Secret Key) no console. Guarde a Secret Key: ela só aparece uma vez.
4. **Configure** `backend/.env`:
   ```ini
   PROVIDER=kling
   KLING_ACCESS_KEY=...
   KLING_SECRET_KEY=...
   KLING_MODEL=kling-v2-6          # model_name disponível na sua conta
   # KLING_BASE_URL=https://api-singapore.klingai.com   (padrão; o host antigo api.klingai.com foi renomeado)
   DAILY_LIMIT=5                   # teto de segurança enquanto testa
   ```
5. **Verifique**: `npm run dev` e `curl -H "X-App-Key: <chave>" localhost:3000/capabilities` deve listar `kling`
   (sem as duas chaves ele não aparece).
6. **Teste barato**: 5 s, qualidade `std`, sem imagem:
   ```bash
   curl -H "X-App-Key: <chave>" -F provider=kling -F prompt="uma onda quebrando ao pôr do sol" \
        -F duration=5 -F aspect=16:9 -F quality=std localhost:3000/jobs
   ```
   Acompanhe `GET /jobs/<id>`; ao concluir, o vídeo é copiado para `backend/data/videos`.
7. **Com imagem** (`image-to-video`): envie `-F image=@foto.png`. Regras do fabricante (via projetos acima):
   JPG/PNG, **≥ 300 px por lado**, proporção entre 1:2,5 e 2,5:1, até 10 MB inline. Com imagem, a proporção vem da
   imagem (o campo `aspect` é ignorado). `lastImage` vira `image_tail` (último quadro).

## 3. Custos, limites e comportamento

- **Cobrança por segundo gerado**, em unidades do pacote; débito ocorre **ao concluir**, não ao enviar.
  Estimativa (terceiros): `kling-2.6` sem áudio ≈ 0,3 unidade/s em 720p; com ~US$ 0,14/unidade, 5 s ≈ US$ 0,21.
- **Concorrência** limitada pelo pacote (o nome do pacote traz algo como `5Con`). Acima disso: erro `1303`.
  O backend não enfileira por você; use `DAILY_LIMIT` e poucos jobs simultâneos.
- **Falhas:** não se sabe se uma tarefa `failed` consome unidades; verifique o extrato do pacote antes de automatizar retentativas.
- **Expiração:** o fabricante limpa as URLs de saída depois de um prazo (30 dias no padrão novo, segundo a lib de
  testes). O worker copia o vídeo para o seu storage logo ao concluir.
- **Duplicidade:** `external_task_id` repetido é recusado (`1201`), o que protege contra cobrança dupla; o backend
  usa o id do job como `external_task_id`.

## 4. Erros comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `401` / `1002 … does not support AK/SK` | usando AK/SK num endpoint do **novo** padrão | usar a API legada (este provedor) ou aguardar o provedor "novo" |
| `401` de JWT | relógio da máquina errado, AK/SK trocadas | sincronizar hora; conferir o par no console |
| `1102` saldo insuficiente | pacote do tipo errado (vídeo ≠ imagem) ou esgotado | conferir o pacote de **vídeo** |
| `1303` concorrência | tarefas em andamento ≥ limite do pacote | esperar concluir; reduzir paralelismo |
| `400` com imagem | < 300 px, proporção fora de 1:2,5–2,5:1, formato ≠ JPG/PNG | ajustar a imagem |
| Modelo inválido/descontinuado | `KLING_MODEL` fora da sua conta | listar modelos no console e ajustar |
| Job `failed` com `task_status_msg` | recusa de conteúdo/qualidade da entrada | ajustar prompt/imagem |

## 5. Para quem for mexer no código

`backend/src/providers/kling.ts`. O id guardado é `<tipo>:<task_id>` para o `poll` funcionar após reiniciar. Ao
implementar o padrão novo, crie um provedor separado (ou um modo `KLING_API=new`), traduza `succeeded`/`GET /tasks`
para o modelo unificado e atualize esta página e a [tabela do modelo de dados](../data-model.md).
