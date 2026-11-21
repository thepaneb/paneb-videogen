# Segurança

- Nunca commite `.env`, chaves de provedor (Kling AK/SK/API Key), `APP_KEY` ou `local.properties`.
  Se vazar, **revogue a chave no console do provedor** e gere outra; apagar do Git não basta.
- A API autentica por `X-App-Key`; `APP_KEYS` dá uma chave por usuário (dados e cota isolados). Sem chave configurada o
  servidor não inicia. Use chaves longas e **HTTPS** em qualquer acesso fora da sua rede ([docs/deployment.md](docs/deployment.md)).
- Vídeos em `/files/*` só abrem com **link assinado e com validade** (`FILES_TTL_MIN`); quem tem o link vê o vídeo até
  expirar. Não há login por senha nem 2FA: para uso público/multiusuário real, adicione um provedor de identidade.
- `/metrics` fica desligado sem `METRICS_TOKEN`; com ele, exige `Authorization: Bearer`. Não o exponha sem token.
- O aprimorador de prompt (opcional) envia o **texto** do prompt à API da Anthropic; as imagens não são enviadas.
- O ComfyUI não tem autenticação: nunca o exponha à internet.
- Para reportar uma vulnerabilidade, use **Security → Report a vulnerability** do repositório (aviso privado),
  não uma issue pública.
