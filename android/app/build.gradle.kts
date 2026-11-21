import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Configuração local, fora do Git: android/local.properties (ou -Pvideogen.apiBaseUrl=... na linha de comando)
val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun cfg(key: String, default: String): String =
    local.getProperty(key) ?: (project.findProperty(key) as String?) ?: default

android {
    namespace = "com.example.videogen"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.example.videogen"
        minSdk = 26
        targetSdk = 34
        versionCode = 5
        versionName = "0.6"
        // 10.0.2.2 = localhost do PC visto pelo emulador.
        buildConfigField("String", "API_BASE_URL", "\"${cfg("videogen.apiBaseUrl", "http://10.0.2.2:3000/")}\"")
        buildConfigField("String", "APP_KEY", "\"${cfg("videogen.appKey", "troque-esta-chave")}\"")
        // Push (FCM): projeto Firebase criado no console; vazio = push desligado (builds do CI).
        buildConfigField("String", "FCM_PROJECT_ID", "\"${cfg("videogen.fcmProjectId", "")}\"")
        buildConfigField("String", "FCM_APP_ID", "\"${cfg("videogen.fcmAppId", "")}\"")
        buildConfigField("String", "FCM_API_KEY", "\"${cfg("videogen.fcmApiKey", "")}\"")
        manifestPlaceholders["usesCleartext"] = "false"
    }
    // Assinatura de release via keystore próprio (CI: segredos do GitHub; local: ~/.gradle/gradle.properties
    // com release.storeFile/storePassword/keyAlias/keyPassword — nunca commitar o .keystore).
    // O caminho é relativo à raiz do projeto Android (android/): file() sozinho resolveria em android/app/.
    val ksFile = System.getenv("RELEASE_KEYSTORE_FILE") ?: (findProperty("release.storeFile") as String?).orEmpty()
    signingConfigs {
        create("release") {
            if (ksFile.isNotBlank()) {
                storeFile = rootProject.file(ksFile)
                storePassword = System.getenv("RELEASE_KEYSTORE_PASSWORD") ?: findProperty("release.storePassword") as String?
                keyAlias = System.getenv("RELEASE_KEY_ALIAS") ?: findProperty("release.keyAlias") as String?
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD") ?: findProperty("release.keyPassword") as String?
            }
        }
    }
    buildTypes {
        debug { manifestPlaceholders["usesCleartext"] = "true" } // http só em debug; release exige HTTPS
        release { signingConfig = signingConfigs.getByName("release") } // sem minify neste estágio
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    // jvmTarget 17 vem do targetCompatibility acima (padrão do Kotlin embutido no AGP 9).
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation(platform("com.google.firebase:firebase-bom:34.2.0"))
    implementation("com.google.firebase:firebase-messaging")
}
