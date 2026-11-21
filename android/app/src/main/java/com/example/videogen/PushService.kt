package com.example.videogen

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
