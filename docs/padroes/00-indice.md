# Padrões do projeto (índice)

Guias alinhados com a stack real: **Node 22+/TypeScript + Express + SQLite (`node:sqlite`)** no backend,
**Kotlin + Retrofit + Jetpack Compose + Material3** no Android, **ComfyUI local** como executor de vídeo.

| Guia | Cobre |
|---|---|
| [Arquitetura](01-arquitetura.md) | visão do sistema, camadas, fluxos, contratos entre camadas |
| [Engenharia de backend](02-engenharia-backend.md) | provedores, worker, validação, erros, logs, testes |
| [Segurança](03-seguranca.md) | modelo de ameaça (uso pessoal), auth, links assinados, segredos, upload, DoS |
| [Design Android](04-design-android.md) | MVVM, estado unidirecional, Material3, navegação |
| [Layout e telas](05-layout.md) | telas Criar/Histórico/Ajustes, componentes, responsividade, acessibilidade |

Regra geral (ver [AGENTS.md](../AGENTS.md)): documentação e commits em **português**, código e
identificadores em **inglês**. Cada guia termina com **"Aderência verificada"** — o estado real do
código em 2026-11-21, incluindo o que foi assumido como risco aceito e o que ainda falta.
