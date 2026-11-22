# VideoGen

App Android + API para gerar **vídeos curtos a partir de prompts e imagens**, com provedores intercambiáveis
(Kling na nuvem, LTX no ComfyUI local, e um *mock* gratuito para desenvolvimento).

```
 Android (Kotlin/Compose) ──HTTP──►  API (Node/TypeScript)  ──►  Kling (nuvem)
   criar · histórico · player          fila · SQLite · worker ──►  ComfyUI + LTX (seu PC/GPU)
                                       storage de vídeos      ──►  mock (grátis)
```

A chave do provedor **nunca** vai no app: o app só fala com a sua API (com chave por usuário e links de vídeo assinados).

## Começar em 3 minutos (sem gastar nada)

```bash
cd backend
npm install
cp .env.example .env        # defina APP_KEY; PROVIDER=mock já vem como padrão
npm run dev                 # requer Node >= 22.13
```

Para expor o backend (túnel compartilhado em uso; Docker Compose como alternativa): [docs/deployment.md](docs/deployment.md).

Teste: `curl -H "X-App-Key: <sua chave>" -F prompt="gato astronauta" localhost:3000/jobs` e acompanhe em
`/jobs/<id>` (o mock termina em ~15 s). Depois, abra a pasta `android/` no Android Studio
([android/README.md](android/README.md)).

## Provedores

| Provedor | Custo | Hardware | Estado | Guia |
|---|---|---|---|---|
| `mock` | grátis | — | pronto (só desenvolvimento) | [docs/providers/mock.md](docs/providers/mock.md) |
| `kling` | pago (pacotes pré-pagos) | nenhum | **API legada** implementada; API nova no [roadmap](docs/roadmap.md) | [docs/providers/kling.md](docs/providers/kling.md) |
| `comfyui` (LTX) | só energia/GPU | GPU NVIDIA potente (oficial: 32 GB+ VRAM) | implementado, depende do seu workflow | [docs/providers/comfyui-ltx.md](docs/providers/comfyui-ltx.md) |

Como escolher: [docs/providers/README.md](docs/providers/README.md).

## Estrutura

```
backend/    API Node/TypeScript (Express, SQLite via node:sqlite, worker, provedores, testes)
android/    app Kotlin + Jetpack Compose
docs/       arquitetura, modelo de dados, API, guias de provedores, roadmap
.github/    CI, Dependabot, templates de issue/PR
AGENTS.md   instruções para agentes de código (e boas regras para humanos)
```

## Documentação

- [Implantação](docs/deployment.md) · [Observabilidade](docs/observability.md) · [Aprimorador de prompt](docs/prompt-enhancement.md)
- [Padrões: índice](docs/padroes/00-indice.md) · [Arquitetura](docs/padroes/01-arquitetura.md) · [Engenharia de backend](docs/padroes/02-engenharia-backend.md) · [Segurança](docs/padroes/03-seguranca.md) · [Design Android](docs/padroes/04-design-android.md) · [Layout](docs/padroes/05-layout.md)
- [Arquitetura](docs/architecture.md) · [Modelo de dados](docs/data-model.md) · [Referência da API](docs/api.md) ([OpenAPI](backend/openapi.yaml))
- [Guias dos provedores](docs/providers/README.md) · [Como adicionar um provedor](docs/adding-a-provider.md)
- [Roadmap](docs/roadmap.md) · [Contribuindo](CONTRIBUTING.md) · [Segurança](SECURITY.md)

## Estado do projeto

Protótipo funcional. Testado: API completa com `mock`, provedor ComfyUI contra um servidor simulado, testes
(`npm test`: modelo, segurança, migração, contrato OpenAPI, métricas, encerramento limpo), isolamento entre usuários, links assinados,
repetição/variações com seed. **Não testado:** Kling real, aprimorador com a API real da Anthropic,
ComfyUI real, Docker/Caddy, build do app Android.
Veja o [roadmap](docs/roadmap.md).

## Licença

Defina a licença antes de publicar (adicione um arquivo `LICENSE`).
