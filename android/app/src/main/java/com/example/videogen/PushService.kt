package com.example.videogen

import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class PushService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch { registerPushToken(applicationContext, token) }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        showDoneNotification(this, d["jobId"].orEmpty(), d["status"].orEmpty())
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

private fun showDoneNotification(ctx: android.content.Context, jobId: String, status: String) {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
    val open = PendingIntent.getActivity(
        ctx, jobId.hashCode(),
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val title = when (status) { "succeeded" -> "Vídeo pronto"; "failed" -> "Falha ao gerar vídeo"; "canceled" -> "Geração cancelada"; else -> "Atualização do vídeo" }
    val text = if (status == "succeeded") "Seu vídeo terminou de gerar — toque para ver." else "Toque para abrir o histórico."
    val n = NotificationCompat.Builder(ctx, doneChannelId())
        .setSmallIcon(R.drawable.ic_stat_video)
        .setContentTitle(title).setContentText(text)
        .setContentIntent(open).setAutoCancel(true).build()
    try { NotificationManagerCompat.from(ctx).notify(jobId.hashCode(), n) } catch (_: SecurityException) { /* sem permissão */ }
}
