# Como adicionar um provedor

Candidatos naturais: novo padrão da Kling, Veo (Google), Runway, Luma, agregadores (fal, Replicate...).

1. **Estude o esquema oficial** (autenticação, criação, consulta, cancelamento, formatos de imagem, limites,
   preços, expiração das saídas). Anote a data e os links no guia do provedor.
2. **Crie `backend/src/providers/<nome>.ts`** exportando um `VideoProvider`:
   - `caps`: durações, proporções, qualidades e recursos **reais** do provedor.
   - `submit(params, jobId)` → devolve um id que baste para `poll` após reiniciar o servidor
     (se o consulta depende do tipo/modelo, embuta no id: `tipo:id`).
   - `poll(id)` → `{ status, remoteUrl?, durationSec?, error? }` com o status **traduzido** para o modelo unificado.
   - `cancel?(id)` só se existir cancelamento de verdade (e marque `features.cancel`).
3. **Registre** em `providers/index.ts` (habilite só quando as credenciais/arquivos existirem) e documente as
   variáveis em `backend/.env.example`.
4. **Teste sem rede**: um teste em `backend/test/` que troca `globalThis.fetch` por respostas fixas (veja o teste
   da Kling). Nunca use chave real em teste.
5. **Documente**: `docs/providers/<nome>.md` (setup passo a passo, custos, limites, erros comuns, "Verificado em"),
   linha na tabela de [providers/README.md](providers/README.md) e no `README.md`; atualize
   [data-model.md](data-model.md) se surgirem campos novos.
6. **Android**: normalmente nada — a UI é guiada por `/capabilities`. Recurso novo exige campo em `Capabilities`.
7. Rode `npm run check && npm test`.
