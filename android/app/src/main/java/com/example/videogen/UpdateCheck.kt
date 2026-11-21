package com.example.videogen

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

@Serializable
data class ReleaseAssetDto(val name: String = "", val browser_download_url: String = "")

@Serializable
data class GitHubReleaseDto(
    val tag_name: String = "",
    val html_url: String = "",
    val assets: List<ReleaseAssetDto> = emptyList(),
)

private val ghJson = Json { ignoreUnknownKeys = true }
private val ghHttp = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()

/** Release mais recente no GitHub (repo público, sem autenticação). Null se ainda não houver releases. */
fun fetchLatestRelease(owner: String = "thepaneb", repo: String = "paneb-videogen"): GitHubReleaseDto? {
    val req = Request.Builder()
        .url("https://api.github.com/repos/$owner/$repo/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "VideoGen-Android")
        .build()
    ghHttp.newCall(req).execute().use { res ->
        if (res.code == 404) return null
        if (!res.isSuccessful) throw java.io.IOException("GitHub HTTP ${res.code}")
        return ghJson.decodeFromString(GitHubReleaseDto.serializer(), res.body?.string().orEmpty())
    }
}

private fun normVersion(v: String): List<Int> =
    v.trim().removePrefix("v").removePrefix("V")
        .split('.', '-').map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

/** true quando `latest` é mais nova que `current` ("v0.4" > "0.3"; sufixos não numéricos são ignorados). */
fun isNewerVersion(latest: String, current: String): Boolean {
    val a = normVersion(latest); val b = normVersion(current)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}
