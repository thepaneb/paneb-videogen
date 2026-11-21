# Implantação (HTTPS, Docker, backups)

> Os arquivos `Dockerfile`, `docker-compose.yml` e `Caddyfile` foram escritos mas **não foram executados** no ambiente
> de desenvolvimento deste projeto (sem Docker disponível). O CI faz `docker build`; o primeiro `compose up` pode pedir ajustes.

## Opção A — Docker Compose + Caddy (HTTPS automático)

Requisitos: um servidor com Docker, um **domínio** apontando para ele e as portas 80/443 abertas.

```bash
cp backend/.env.example backend/.env      # defina APP_KEYS (ou APP_KEY), PROVIDER e as chaves do provedor
echo "VIDEOGEN_DOMAIN=videogen.seudominio.com" > .env
docker compose up -d --build
curl https://videogen.seudominio.com/healthz
```
No Android (`android/local.properties`): `videogen.apiBaseUrl=https://videogen.seudominio.com/`.

- Dados (SQLite + vídeos) ficam no volume `videogen-data` (`/data`). **Faça backup dele.**
- ComfyUI no próprio servidor/host: `COMFY_URL=http://host.docker.internal:8188` (já mapeado no compose). Workflows
  entram por `./backend/workflows` (somente leitura) e `COMFY_WORKFLOW=workflows/ltx2.api.json`.
- A porta 3000 só escuta em `127.0.0.1`; o acesso externo é pelo Caddy.

## Opção B — Sem domínio público (uso pessoal)

Mantenha a API na sua rede e use uma VPN/mesh (Tailscale/WireGuard) para o celular chegar nela. Nesse caso o
tráfego já é cifrado pela VPN; o build `release` do Android ainda exige HTTPS, então use `debug` ou publique via
`tailscale serve` (HTTPS com certificado do tailnet).

## Chaves, usuários e links

- `APP_KEYS=alice:chave1,bob:chave2` cria usuários isolados (cada um vê só os próprios vídeos e tem cota diária própria,
  `DAILY_LIMIT`). `APP_KEY` sozinho cria o usuário `default`. Sem nenhuma das duas, **o servidor não inicia**.
- Trocar/revogar uma chave = editar o `.env` e reiniciar. Gere chaves longas (`openssl rand -hex 24`).
- Vídeos são servidos por **links assinados com validade** (`FILES_TTL_MIN`, padrão 24 h). Isso inclui links
  compartilhados pelo app: depois de expirar, o destinatário não consegue mais abrir.
- `FILES_SECRET` fixo mantém links válidos mesmo se você trocar as chaves.

## Observabilidade

Defina `METRICS_TOKEN` para habilitar `/metrics` (veja [observability.md](observability.md)). O Caddy repassa `X-Request-Id` e a API
registra logs JSON no `stdout` (`docker compose logs -f api`). O `docker compose stop` envia `SIGTERM` e o servidor encerra de forma limpa.

## Atualizar

```bash
git pull && docker compose up -d --build
```
O esquema do banco migra sozinho na inicialização (`PRAGMA user_version`); faça backup do volume antes de atualizar.
