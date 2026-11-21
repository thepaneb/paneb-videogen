# Guia de design (Android)

Stack: **Kotlin + Retrofit + kotlinx.serialization + Jetpack Compose + Material3** (`Api.kt`, `VideoViewModel.kt`, `MainActivity.kt`).

## Arquitetura MVVM unidirecional

- `VideoViewModel` (AndroidViewModel) detém **todo** o estado em `mutableStateOf`: `caps`, `provider`, `prompt`, `negative`, imagens (`Uri?`), `duration`, `aspect`, `quality`, knobs (`promptEnhance`, `cfg`, `imgStrength`, `steps`), `adjustSource`, `jobs`, `message`, `sending`.
- Telas (`CreateScreen`, `HistoryScreen`, `SettingsScreen`) são **stateless**: só leem estado e despacham eventos (`vm.generate()`, `vm.selectProvider()`, `vm.startAdjust()`, `vm.saveServer()`...).
- Efeitos colaterais ficam no ViewModel (`viewModelScope`); telas só têm `LaunchedEffect` para
  polling (histórico pausa com a tela invisível via `LifecycleEventObserver`; 4 s com job ativo, 30 s sem)
  e status da conexão a cada 60 s + ticker de 1 s para o "há X" (só o texto, não a tela).

## Rede e configuração

- `ApiFactory.apiFor(baseUrl)` com cache por URL; `ApiAuth.appKey` mutável alimenta o interceptor `X-App-Key` (troca de chave sem rebuild).
- `BuildConfig.API_BASE_URL`/`APP_KEY` (de `local.properties`) são só o padrão inicial; o usuário pode trocar URL e chave na tela Ajustes (guardados em `EncryptedSharedPreferences`, com migração única do valor antigo).
- DTOs com defaults tolerantes + `ignoreUnknownKeys`: o app nunca quebra se a API adicionar campos.
- Upload por streaming (`RequestBody` sob demanda, sem carregar a foto inteira na RAM); salvamento via MediaStore (IS_PENDING) e compartilhamento do arquivo via `FileProvider` (com fallback para link).
- Push (FCM): com `caps.push` e build configurado, o app registra o token em `POST /push/tokens` (ao carregar capabilities e no `onNewToken`) e mostra notificação ao concluir (serviço `PushService`, canais "Vídeos prontos"/"Atualizações do app", sem plugin `google-services` — inicialização manual via `BuildConfig`).
- Versão nova: checagem horária em background (`WorkManager`, só com rede) via `releases/latest`; se houver, notificação que abre nos Ajustes (onde está o Baixar). "Salvar e reconectar" roda o teste de conexão (atualiza o cartão) antes de recarregar capabilities/histórico.

## Material3 e conteúdo dinâmico

- Tema padrão do Material3 (`MaterialTheme`), sem tema custom — intencional nesta fase (menos dívida visual).
- `NavigationBar` com 3 destinos (Criar/Histórico/Ajustes), rótulo sempre visível, item ativo com ícone + negrito maior.
- A UI de Criar é **dirigida por capabilities**: chips de duração/proporção/qualidade e campos condicionais (`negativePrompt`, imagem, `lastImage`) vêm do servidor — novo recurso no backend aparece sem mudar layout.
- Feedback: `LinearProgressIndicator` indeterminado na fila, determinado com `progress` real gerando; `etaSec` como "≈ N min restantes"; erros como texto, nunca toast silencioso.

## Regras

- Nada de segredo no código: só `BuildConfig` (de arquivo local fora do Git).
- Novo campo da API = novo campo opcional no DTO + render condicional (nunca quebre jobs antigos).
- Texto de UI em português; identificadores em inglês.

## Aderência verificada (2026-11-21)

- Conforme: estado centralizado no ViewModel; telas sem lógica de rede; DTOs tolerantes; capabilities dirigindo a UI (durações/qualidades/knobs condicionais via `features.tune`); chave/URL editáveis em runtime com armazenamento criptografado; upload por streaming; salvamento via MediaStore; compartilhamento via `FileProvider`; polling com pausa em background e indicador de lista desatualizada.
- Parcial: sem tema/cores próprios (Material3 padrão) e sem testes de UI — aceito para protótipo; antes de release, definir paleta + testes de fumaça (criar job mock, ver histórico, trocar servidor).
