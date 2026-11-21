# App Android

Kotlin · Jetpack Compose · Retrofit/kotlinx-serialization · Media3 (ExoPlayer) · Coil. `minSdk 26`, `compileSdk 37`, `targetSdk 34`.

## Rodar

1. Instale o **Android Studio** (JDK 17+ e SDK com a plataforma 37) e abra **a pasta `android/`**. O Gradle wrapper já está commitado (`./gradlew`).
2. Crie `android/local.properties` (fora do Git) com a sua API:
   ```properties
   videogen.apiBaseUrl=http://10.0.2.2:3000/
   videogen.appKey=<mesmo APP_KEY do backend>
   ```
   Emulador: `10.0.2.2` é o `localhost` do PC. Celular real: IP do PC na rede, ou túnel/VPN (Tailscale). Em `release`
   use **HTTPS** (texto puro só é permitido no build `debug`).
   Esses valores são só o padrão inicial: na aba **Ajustes** do app dá para trocar URL e chave sem recompilar.
   Dica: esses valores são só o padrão inicial — na aba **Ajustes** do app dá para trocar URL e chave sem recompilar.
3. Suba o backend (`PROVIDER=mock` para testar) e execute o app.

## Wrapper do Gradle e CI

O wrapper (`gradlew`, `gradle/wrapper/*`) está commitado: compile com `./gradlew :app:assembleDebug` (dentro de `android/`). O CI usa o mesmo wrapper, então o build é reproduzível.

## Distribuição (GitHub Releases)

Cada tag `v*` (ex.: `v0.4`) dispara o workflow `Release`, que compila o APK **release** assinado e o publica
como asset (`videogen-v0.4.apk`). O app mostra a versão instalada em **Ajustes** e
consulta `releases/latest` ao abrir a tela (sem autenticação; repositório público): se houver
versão maior que a instalada, exibe um cartão com o botão **Baixar**, que abre o link no navegador
— a instalação é concluída pelo usuário (fontes desconhecidas).

### Assinatura de release (uma vez)

O APK de release é assinado com um keystore próprio no CI. Para configurar:

1. Gere o keystore (fora do Git) e guarde bem as senhas:
   ```powershell
   keytool -genkeypair -keystore android/release.keystore -alias videogen -keyalg RSA -keysize 2048 -validity 9125
   ```
2. Converta para base64 e cadastre os segredos em **Settings → Secrets and variables → Actions** no GitHub:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("android/release.keystore")) | Set-Clipboard
   ```
   Segredos: `ANDROID_KEYSTORE_BASE64` (o texto copiado), `ANDROID_KEY_ALIAS` (`videogen`),
   `ANDROID_KEYSTORE_PASSWORD` e `ANDROID_KEY_PASSWORD`.
3. Sem esses segredos o workflow de Release falha — de propósito, para nunca publicar APK sem assinatura válida.

Quem instalou o APK de **debug** (assinatura do PC ou do runner) precisa **desinstalar antes** de instalar
o de release: o Android não permite atualizar um app para outra assinatura. Daqui em diante, todas as
Releases usam a mesma assinatura e atualizam normalmente (o cartão de "Nova versão" no app já aponta para elas).

O wrapper (`gradlew`, `gradle/wrapper/*`) está commitado: compile com `./gradlew :app:assembleDebug` (dentro de `android/`). O CI usa o mesmo wrapper, então o build é reproduzível.

## Estrutura

`Api.kt` (DTOs e Retrofit) · `VideoViewModel.kt` (estado, polling, ações) · `MainActivity.kt` (telas Criar e Histórico).
A tela Criar é montada a partir de `GET /capabilities`; o histórico vem do servidor (`GET /jobs`), atualizado a cada 4 s.
