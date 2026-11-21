# App Android

Kotlin · Jetpack Compose · Retrofit/kotlinx-serialization · Media3 (ExoPlayer) · Coil. `minSdk 26`, `compileSdk 34`.

## Rodar

1. Instale o **Android Studio** (JDK 17+ e SDK 34 vêm junto) e abra **a pasta `android/`**. O Gradle wrapper já está commitado (`./gradlew`).
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

O wrapper (`gradlew`, `gradle/wrapper/*`) está commitado: compile com `./gradlew :app:assembleDebug` (dentro de `android/`). O CI ainda usa `gradle` do sistema; trocar pelo wrapper deixa o build reproduzível.

## Estrutura

`Api.kt` (DTOs e Retrofit) · `VideoViewModel.kt` (estado, polling, ações) · `MainActivity.kt` (telas Criar e Histórico).
A tela Criar é montada a partir de `GET /capabilities`; o histórico vem do servidor (`GET /jobs`), atualizado a cada 4 s.
