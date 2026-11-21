package com.example.videogen

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class VideoGenApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ensureChannels(this)
        // Sem plugin google-services: inicialização manual. Vazio (builds do CI) = push desligado.
        if (fcmConfigured()) {
            val opts = com.google.firebase.FirebaseOptions.Builder()
                .setProjectId(BuildConfig.FCM_PROJECT_ID)
                .setApplicationId(BuildConfig.FCM_APP_ID)
                .setApiKey(BuildConfig.FCM_API_KEY)
                .build()
            com.google.firebase.FirebaseApp.initializeApp(this, opts)
        }
        // Checa versão nova a cada hora (só com rede); avisa por notificação se houver.
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "videogen-update-check", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<UpdateCheckWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build())
    }
}
