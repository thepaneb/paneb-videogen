# Guia de segurança

Escopo: **uso pessoal em rede local**, com exposição opcional via túnel (Cloudflare/ngrok). Não é
endurecido para multiusuário público — os riscos aceitos estão marcados abaixo.

## Modelo de ameaça (realista para este projeto)

Atacante: alguém na mesma rede/túnel com a URL da API. Fora de escopo: invasão do PC, malware local,
vulnerabilidades do próprio ComfyUI/dependências (acompanhe updates do Comfy Desktop).

## Controles existentes

- **Autenticação**: `X-App-Key` → usuário via hash SHA-256 (`auth.ts`); sem chave, só `/healthz`, `/openapi.yaml`, `/files` (assinado) e `/metrics` (com token). Toda rota de job checa dono (`owned()`); consultas de `db.ts` recebem `userId`.
- **Links assinados**: `/files/<arq>?exp=&sig=` HMAC-SHA256 com expiração (`FILES_TTL_MIN`, `FILES_SECRET` opcional; sem ele, o segredo deriva das chaves — trocar chave invalida links).
- **Validação de entrada**: enums contra `capabilities`, seed inteira limitada, prompt ≤ 5000, multipart restrito a `image`/`lastImage` (1 cada, 10 MB), JSON ≤ 50 KB.
- **Cota diária** (`DAILY_LIMIT`) por usuário: limita custo (Kling) e abuso de GPU.
- **Path traversal**: nomes de arquivo sempre via `path.basename`; uploads salvos com nome gerado (`<jobId>-first.png`).
- **Segredos fora do Git**: `.env`, `android/local.properties`, `backend/data/` ignorados; exemplos sem segredo (`.env.example`, README do Android).
- **Logs seguros**: nunca query string/chaves/tokens; `log.*` estruturado, sem `console.*`.
- **Cabeçalhos**: `X-Powered-By` desativado; sem cookies/sessão (API stateless por chave).

## Riscos aceitos (conscientes, não esquecidos)

- **HTTP em texto puro no Wi-Fi** (build `debug`): chave e vídeos trafegam legíveis na rede local. Release exige HTTPS (ver `docs/deployment.md`).
- **Sem rate-limit por IP**: a cota é por usuário/dia. Exposição pública (túnel) + chave fraca = abuso possível; use chave forte e `DAILY_LIMIT` baixo.
- **Chave no aparelho em armazenamento criptografado** (`EncryptedSharedPreferences`, com migração única do valor antigo); fallback sem cripto só se indisponível. Não cadastre segredos críticos ali.
- **Erros do ComfyUI repassados** (`node_errors` no 502): podem vazar caminhos internos — aceito em dev; não exponha a API sem autenticação.
- **Dependência de uso restrito**: `jsonwebtoken` (+ tipos) serve só ao provedor Kling legado (JWT HS256 em `kling.ts`);
  se a Kling migrar para API Key, remover a dependência junto com o provedor legado.

## Checklist antes de expor (túnel ou internet)

1. `APP_KEY` forte e única (não reuse a de dev); `DAILY_LIMIT` baixo (ex.: 5–20).
2. `FILES_TTL_MIN` curto (ex.: 60) para links compartilhados expirarem rápido.
3. ComfyUI **nunca** exposto diretamente (sem auth nativa) — só a API, em rede privada/túnel.
4. Confira que `.env`/`local.properties`/`backend/data` continuam fora do Git (`git status` limpo de segredos).

## Aderência verificada (2026-11-21)

- Conforme: auth em todas as rotas de job (teste cobre 401 e isolamento entre usuários); links assinados com expiração e `timingSafeEqual`; basename em todos os caminhos de arquivo; multer restrito; cota diária; nada de segredo commitado.
