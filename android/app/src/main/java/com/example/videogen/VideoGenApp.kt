package com.example.videogen

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class VideoGenApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ensurePushChannel(this)
        // Sem plugin google-services: inicialização manual. Vazio (builds do CI) = push desligado.
        if (fcmConfigured()) {
            val opts = com.google.firebase.FirebaseOptions.Builder()
                .setProjectId(BuildConfig.FCM_PROJECT_ID)
                .setApplicationId(BuildConfig.FCM_APP_ID)
                .setApiKey(BuildConfig.FCM_API_KEY)
                .build()
            com.google.firebase.FirebaseApp.initializeApp(this, opts)
        }
    }
}

private const val DONE_CHANNEL = "videogen_done"

fun ensurePushChannel(ctx: android.content.Context) {
    if (Build.VERSION.SDK_INT >= 26) {
        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(DONE_CHANNEL, "Vídeos prontos", NotificationManager.IMPORTANCE_DEFAULT))
    }
}

fun doneChannelId() = DONE_CHANNEL
