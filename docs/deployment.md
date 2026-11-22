# Implantação (HTTPS, Docker, backups)

## Em uso agora — túnel compartilhado (ngrok + Caddy local)

> Estado verificado em **2026-11-22**. Este é o deploy real em operação nesta máquina; as opções A/B abaixo são
> alternativas (VPS com domínio próprio ou VPN) e **não** estão em uso aqui.

Um único túnel ngrok (plano free = 1 túnel) atende **duas aplicações**: o Caddy divide o tráfego por prefixo de path.

```
celular ──HTTPS──► ngrok (graceful-fragrance-extrovert.ngrok-free.dev)
                        │
                        ▼ :8090 (só loopback)
                   ┌── Caddy (Caddyfile.tunel) ──┐
                   │ /videogen/* → :3100         │  (strip do prefixo; a API continua vendo /jobs, /capabilities, /files…)
                   │ resto       → :3000         │  (live-persona, repasse transparente, outro repositório)
                   └─────────────────────────────┘
```

| Peça | O quê | Porta/arquivo | Estado em 2026-11-22 |
|---|---|---|---|
| Backend VideoGen | `node --import tsx src/server.ts` (pasta `backend/`) | `:3100` (override `PORT=3100`; o `.env` mantém `PORT=3000`) | no ar (`/healthz` 200; default `comfyui`) |
| Caddy | `D:\tools\caddy.exe run --config Caddyfile.tunel` | `:8090` + admin `:2019` | no ar |
| ngrok | `ngrok http 8090 --url=graceful-fragrance-extrovert.ngrok-free.dev` | URL fixa em `tunnel-api.url.txt` | no ar |
| live-persona | outro app/repositório | `:3000` | no ar |
| ComfyUI local | `COMFY_URL=http://127.0.0.1:8188` | `:8188` | no ar |
| Vigia | tarefa agendada **"VideoGen Tunnel Watch"** (a cada 5 min): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-tunnel.ps1` | log `tunnel-watch.log`; contadores em `%TEMP%\videogen-tunnel-*.fail` | ativa (último run OK) |
| Túnel apk (cloudflared quick) | origem `http://localhost:8080` → URL em `tunnel-apk.url.txt` | `cloudflared-apk.log/.err` | **origem fora do ar** (nada escuta `:8080`); o vigia só alerta — túnel não é o problema |

### Como o vigia age (`scripts/watch-tunnel.ps1`)

- **api (ngrok, domínio fixo):** testa a URL pública (`<url>/healthz` precisa conter `"ok":true` — o ngrok free devolve página de aviso para navegadores, por isso o teste usa UA próprio e confere o corpo). Se falhar 2× seguidas: backend `:3100` fora do ar → **só alerta**; proxy `:8090/videogen` fora mas backend ok → **reinicia o Caddy**; proxy ok mas túnel morto → **reinicia o ngrok com o mesmo `--url`** (a URL pública não muda).
- **apk (cloudflared):** origem `:8080` fora do ar → só alerta. Origem ok mas pública falha 2× → mata o `cloudflared` e sobe outro quick tunnel, gravando a **nova URL** em `tunnel-apk.url.txt` (+ toast no Windows).
- Falhas de toast/log não quebram o ciclo (`try/catch` interno); o `LastTaskResult` da tarefa fica `0`.

### Subir/derrubar cada peça

```powershell
# Backend VideoGen na porta do Caddy (sem tocar no .env; o dotenv não sobrescreve o ambiente)
$env:PORT="3100"
Start-Process node -ArgumentList "--import","tsx","src/server.ts" `
  -WorkingDirectory "$PWD\backend" -WindowStyle Hidden `
  -RedirectStandardOutput "$PWD\backend\server-3100.log" -RedirectStandardError "$PWD\backend\server-3100.err"
curl.exe -s http://127.0.0.1:3100/healthz   # {"ok":true}

# Caddy (proxy :8090)
D:\tools\caddy.exe run --config Caddyfile.tunel
# Checar config carregada: curl.exe -s http://127.0.0.1:2019/config/

# ngrok (mesmo domínio fixo — não trocar o --url, o app usa a URL de tunnel-api.url.txt)
ngrok http 8090 --url=graceful-fragrance-extrovert.ngrok-free.dev
# No app (local.properties ou Ajustes): videogen.apiBaseUrl=https://graceful-fragrance-extrovert.ngrok-free.dev/videogen/
```

> O backend sobe **manual** (sem serviço do Windows nem tarefa agendada): se a máquina reiniciar, siga a sequência
> acima (backend → confere `:3100` → Caddy e ngrok só se caíram; o vigia recria o resto sozinho). `Ctrl+C`/SIGTERM no
> `node` encerra limpo (espera a rodada do worker, fecha o SQLite).

### Checagem ponta a ponta

```powershell
curl.exe -s http://127.0.0.1:3100/healthz                                        # backend direto
curl.exe -s http://127.0.0.1:8090/videogen/healthz                              # via Caddy (strip /videogen)
curl.exe -s https://graceful-fragrance-extrovert.ngrok-free.dev/videogen/healthz # via túnel (celular usa esta)
```

### Produção (não usada aqui)

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
