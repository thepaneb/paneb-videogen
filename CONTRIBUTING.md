# Contribuindo

1. Abra uma issue (bug, mudança de API de provedor ou ideia) ou comente numa existente.
2. Branch a partir de `main`: `feat/...`, `fix/...`, `docs/...`.
3. Rode `cd backend && npm ci && npm run check && npm test`. No Android, compile `:app:assembleDebug` se puder.
4. Commits no imperativo, em português (`adiciona provedor X`). PRs pequenos, com o template preenchido.
5. Mudou modelo de dados/API/provedor? Atualize `docs/` no mesmo PR (veja regras em [AGENTS.md](AGENTS.md)).

Testes nunca devem usar chaves reais nem gastar crédito de provedor. Novo provedor: siga
[docs/adding-a-provider.md](docs/adding-a-provider.md).
