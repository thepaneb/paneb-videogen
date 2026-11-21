import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
    compileSdk = 34
    defaultConfig {
        applicationId = "com.example.videogen"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.2"
        // 10.0.2.2 = localhost do PC visto pelo emulador.
        buildConfigField("String", "API_BASE_URL", "\"${cfg("videogen.apiBaseUrl", "http://10.0.2.2:3000/")}\"")
        buildConfigField("String", "APP_KEY", "\"${cfg("videogen.appKey", "troque-esta-chave")}\"")
        manifestPlaceholders["usesCleartext"] = "false"
    }
    buildTypes {
        debug { manifestPlaceholders["usesCleartext"] = "true" } // http só em debug; release exige HTTPS
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
