package com.example.videogen

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Checagem horária de versão nova (GitHub Releases); notifica se houver. Sem login nem chave. */
class UpdateCheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        return try {
            val rel = withContext(Dispatchers.IO) { fetchLatestRelease() } ?: return Result.success()
            val tag = rel.tag_name.trim()
            if (tag.isNotEmpty() && isNewerVersion(tag, BuildConfig.VERSION_NAME)) {
                val apk = rel.assets.firstOrNull { it.name.endsWith(".apk", ignoreCase = true) }
                showUpdateNotification(applicationContext, tag.removePrefix("v"), apk?.browser_download_url ?: rel.html_url)
            }
            Result.success()
        } catch (_: Exception) { Result.retry() }
    }
}
