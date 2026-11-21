package com.example.videogen

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

const val DONE_CHANNEL = "videogen_done"
const val UPDATE_CHANNEL = "videogen_update"

fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val m = ctx.getSystemService(NotificationManager::class.java) ?: return
    m.createNotificationChannel(NotificationChannel(DONE_CHANNEL, "Vídeos prontos", NotificationManager.IMPORTANCE_DEFAULT))
    m.createNotificationChannel(NotificationChannel(UPDATE_CHANNEL, "Atualizações do app", NotificationManager.IMPORTANCE_DEFAULT))
}

/** true se pode postar notificações (antes do Android 13 não precisa pedir). */
fun hasNotifPermission(ctx: android.content.Context) =
    android.os.Build.VERSION.SDK_INT < 33 ||
        androidx.core.content.ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED

private fun openTabIntent(ctx: Context, tab: Int) =
    PendingIntent.getActivity(
        ctx, 1000 + tab,
        Intent(ctx, MainActivity::class.java)
            .putExtra("videogen.tab", tab)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

/** Notificação de job concluído (vem do push FCM); abre no Histórico. */
fun showDoneNotification(ctx: Context, jobId: String, status: String) {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
    val title = when (status) {
        "succeeded" -> "Vídeo pronto"
        "failed" -> "Falha ao gerar vídeo"
        "canceled" -> "Geração cancelada"
        else -> "Atualização do vídeo"
    }
    val text = if (status == "succeeded") "Seu vídeo terminou de gerar — toque para ver." else "Toque para abrir o histórico."
    val n = NotificationCompat.Builder(ctx, DONE_CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_video)
        .setContentTitle(title).setContentText(text)
        .setContentIntent(openTabIntent(ctx, 1)).setAutoCancel(true).build()
    try { NotificationManagerCompat.from(ctx).notify(jobId.hashCode(), n) } catch (_: SecurityException) { /* sem permissão */ }
}

/** Notificação de versão nova (chegada pela checagem horária); abre nos Ajustes, onde está o Baixar. */
fun showUpdateNotification(ctx: Context, version: String, url: String) {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
    val n = NotificationCompat.Builder(ctx, UPDATE_CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_video)
        .setContentTitle("Nova versão $version disponível")
        .setContentText("Toque para ver como baixar.")
        .setContentIntent(openTabIntent(ctx, 2)).setAutoCancel(true).build()
    try { NotificationManagerCompat.from(ctx).notify("videogen-update".hashCode(), n) } catch (_: SecurityException) { /* sem permissão */ }
}
