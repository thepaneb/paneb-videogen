package com.example.videogen

import android.app.Application
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.buffer
import okio.source
import java.io.File
import java.util.UUID

/** Resultado da consulta à Release mais recente no GitHub. */
sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val version: String, val url: String) : UpdateState
    data class Failed(val msg: String) : UpdateState
}

class VideoViewModel(app: Application) : AndroidViewModel(app) {
    // Chave e URL em armazenamento criptografado (ver appPrefs); só o padrão inicial vem de BuildConfig.
    private val prefs: android.content.SharedPreferences = appPrefs(app)

    /** URL base da API e chave de acesso, editáveis na tela Ajustes e guardados no aparelho. */
    var baseUrl by mutableStateOf(prefs.getString("api_base_url", BuildConfig.API_BASE_URL) ?: BuildConfig.API_BASE_URL)
        private set
    var appKey by mutableStateOf(prefs.getString("api_app_key", BuildConfig.APP_KEY) ?: BuildConfig.APP_KEY)
        private set
    private val api get() = apiFor(baseUrl)

    init { ApiAuth.appKey = appKey }

    var tab by mutableStateOf(0)                       // 0 = criar, 1 = histórico
    var caps by mutableStateOf<CapsDto?>(null)
    var provider by mutableStateOf("")
    var prompt by mutableStateOf("")
    var negative by mutableStateOf("")
    var imageUri by mutableStateOf<Uri?>(null)
    var lastUri by mutableStateOf<Uri?>(null)
    var duration by mutableStateOf(5)
    var aspect by mutableStateOf("9:16")
    var quality by mutableStateOf("std")
    var promptEnhance by mutableStateOf(false)
    var cfg by mutableStateOf(1f)
    var imgStrength by mutableStateOf(0.7f)
    var steps by mutableStateOf("std")
    var message by mutableStateOf("")
    var sending by mutableStateOf(false)
    var enhancing by mutableStateOf(false)
    var jobs by mutableStateOf<List<JobDto>>(emptyList())
    /** Job do histórico sendo ajustado (null = criação nova). A imagem guardada no servidor é reusada. */
    var adjustSource by mutableStateOf<JobDto?>(null)
        private set

    val current: ProviderCaps? get() = caps?.providers?.firstOrNull { it.name == provider }

    // Uma chave por tentativa: se a rede falhar e o usuário repetir o toque, o servidor não duplica o job.
    private var idemKey = UUID.randomUUID().toString()

    init { viewModelScope.launch { loadCaps(); refresh() } }

    fun viewModelScopeReload() { viewModelScope.launch { loadCaps(); refresh() } }

    suspend fun loadCaps() {
        try {
            caps = api.capabilities().also { selectProvider(it.default, it); message = "" }
            // Push: registra o aparelho para ser avisado ao concluir (só se servidor e build suportam).
            if (caps?.push == true && fcmConfigured()) fetchFcmToken()?.let { registerPushToken(getApplication(), it) }
        }
        catch (e: Exception) { message = "Sem conexão com a API: ${e.message}" }
    }

    fun selectProvider(name: String, c: CapsDto? = caps) {
        provider = name
        c?.providers?.firstOrNull { it.name == name }?.let {
            if (duration !in it.durations) duration = it.durations.first()
            if (aspect !in it.aspects) aspect = it.aspects.first()
            if (quality !in it.qualities) quality = it.qualities.first()
            if (!it.features.image) imageUri = null
            if (!it.features.lastImage) lastUri = null
        }
    }

    /** true quando a última atualização do histórico falhou (lista pode estar desatualizada). */
    var stale by mutableStateOf(false)
        private set

    suspend fun refresh() {
        try { jobs = api.list().items; stale = false } catch (_: Exception) { stale = true }
    }

    private fun text(s: String): RequestBody = s.toRequestBody("text/plain".toMediaType())

    // Upload por streaming: não carrega a foto inteira na RAM (evita OOM com fotos grandes).
    private fun part(name: String, uri: Uri?): MultipartBody.Part? {
        if (uri == null) return null
        val cr = getApplication<Application>().contentResolver
        val stream = cr.openInputStream(uri) ?: return null
        val mime = cr.getType(uri) ?: "image/jpeg"
        val ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
        val body = object : RequestBody() {
            override fun contentType() = mime.toMediaType()
            override fun writeTo(sink: okio.BufferedSink) {
                stream.use { sink.writeAll(it.source().buffer()) }
            }
        }
        return MultipartBody.Part.createFormData(name, "imagem.$ext", body)
    }

    fun generate() {
        val feats = current?.features ?: return
        if (prompt.isBlank() || sending) return
        // Só envia ajustes que o provedor anuncia em features.tune (os demais são ignorados pelo servidor).
        val tune = feats.tune.toSet()
        val tPromptEnhance = if ("promptEnhance" in tune) promptEnhance else null
        val tCfg = if ("cfg" in tune) cfg.toDouble() else null
        val tImg = if ("imgStrength" in tune) imgStrength.toDouble() else null
        val tSteps = if ("steps" in tune) steps else null
        viewModelScope.launch {
            sending = true; message = "Enviando…"
            try {
                val src = adjustSource
                if (src != null && imageUri == null && lastUri == null) {
                    // Sem imagem nova: reaproveita a guardada no servidor, com os ajustes.
                    api.repeat(src.id, RepeatBody(count = 1, prompt = prompt.trim(),
                        duration = duration, aspect = aspect, quality = quality,
                        negativePrompt = negative.trim().ifEmpty { null },
                        promptEnhance = tPromptEnhance, cfg = tCfg, imgStrength = tImg, steps = tSteps))
                } else {
                    api.create(
                        idemKey, text(provider), text(prompt.trim()),
                        if (feats.negativePrompt && negative.isNotBlank()) text(negative.trim()) else null,
                        text(duration.toString()), text(aspect), text(quality),
                        part("image", imageUri), part("lastImage", lastUri),
                        tPromptEnhance?.let { text(it.toString()) }, tCfg?.let { text(it.toString()) },
                        tImg?.let { text(it.toString()) }, tSteps?.let { text(it) },
                    )
                    idemKey = UUID.randomUUID().toString()
                }
                adjustSource = null
                prompt = ""; negative = ""; imageUri = null; lastUri = null; message = ""
                refresh(); tab = 1
            } catch (e: Exception) { message = "Erro: ${e.message}" }
            finally { sending = false }
        }
    }

    /** Preenche a tela Criar com os parâmetros de um job do histórico para ajustar e gerar de novo. */
    fun startAdjust(j: JobDto) {
        provider = j.provider; prompt = j.prompt
        val p = j.params
        negative = p?.negativePrompt.orEmpty()
        if (p != null) {
            duration = p.durationSec; aspect = p.aspect; quality = p.quality
            promptEnhance = p.promptEnhance; cfg = (p.cfg ?: 1.0).toFloat(); imgStrength = (p.imgStrength ?: 0.7).toFloat()
            steps = p.steps ?: "std"
        }
        imageUri = null; lastUri = null // a imagem original é reusada no servidor, salvo se trocar
        adjustSource = j; tab = 0; message = "Ajustando a partir do histórico — a imagem original é mantida, salvo troca."
    }

    fun cancelAdjust() { adjustSource = null; message = "" }

    fun enhance() {
        if (prompt.isBlank() || enhancing) return
        viewModelScope.launch {
            enhancing = true
            try { prompt = api.enhance(EnhanceBody(prompt.trim(), provider, imageUri != null)).enhanced; message = "" }
            catch (e: Exception) { message = "Erro ao melhorar o prompt: ${e.message}" }
            finally { enhancing = false }
        }
    }

    /** Refaz um job do histórico: count=1 é "refazer"; count>1 gera variações (seed nova em cada uma). */
    fun repeat(id: String, count: Int) = viewModelScope.launch {
        try { api.repeat(id, RepeatBody(count)) } catch (e: Exception) { message = "Erro: ${e.message}" }
        refresh()
    }

    fun cancel(id: String) = viewModelScope.launch {
        try { api.cancel(id); refresh() } catch (e: Exception) { message = "Falha ao cancelar: ${e.message}" }
    }
    fun delete(id: String) = viewModelScope.launch {
        try { api.delete(id); refresh() } catch (e: Exception) { message = "Falha ao excluir: ${e.message}" }
    }

    private fun safeName(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "").take(64).ifEmpty { "video" }

    private suspend fun downloadBytes(url: String): ByteArray = withContext(Dispatchers.IO) {
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        try {
            conn.connectTimeout = 15_000; conn.readTimeout = 120_000; conn.connect()
            if (conn.responseCode !in 200..206) throw java.io.IOException("HTTP ${conn.responseCode}")
            conn.inputStream.use { it.readBytes() }
        } finally { conn.disconnect() }
    }

    /** Baixa o vídeo (link assinado válido) e salva na galeria via MediaStore. */
    fun saveVideo(ctx: android.content.Context, url: String, id: String) = viewModelScope.launch {
        message = "Salvando na galeria…"
        try {
            val bytes = downloadBytes(url)
            val name = "videogen-${safeName(id)}.mp4"
            val cr = ctx.contentResolver
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, name)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/VideoGen")
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                    ?: throw java.io.IOException("MediaStore indisponível")
                try {
                    cr.openOutputStream(uri)?.use { it.write(bytes) } ?: throw java.io.IOException("Falha ao abrir saída")
                    values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0)
                    cr.update(uri, values, null, null)
                } catch (e: Exception) { cr.delete(uri, null, null); throw e }
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES).resolve("VideoGen")
                    .apply { mkdirs() }
                File(dir, name).writeBytes(bytes)
                @Suppress("DEPRECATION")
                android.media.MediaScannerConnection.scanFile(ctx, arrayOf(File(dir, name).absolutePath), arrayOf("video/mp4"), null)
            }
            message = "Vídeo salvo na galeria"
        } catch (e: Exception) { message = "Falha ao salvar: ${e.message}" }
    }

    /** Compartilha o arquivo de vídeo via FileProvider (com fallback para o link, que expira). */
    fun shareVideo(ctx: android.content.Context, url: String, id: String) = viewModelScope.launch {
        try {
            val bytes = downloadBytes(url)
            val out = File(ctx.cacheDir, "share-${safeName(id)}.mp4")
            withContext(Dispatchers.IO) { out.writeBytes(bytes) }
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", out)
            val i = Intent(Intent.ACTION_SEND).setType("video/mp4").putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            ctx.startActivity(Intent.createChooser(i, "Compartilhar vídeo"))
            message = ""
        } catch (_: Exception) {
            val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
            ctx.startActivity(Intent.createChooser(i, "Compartilhar link (expira)"))
            message = "Compartilhado como link (válido por tempo limitado)"
        }
    }


    /** Monitor da conexão: estado, latência e causa de falha. */
    var testing by mutableStateOf(false)
        private set
    var connOk by mutableStateOf<Boolean?>(null)
        private set
    var connMs by mutableStateOf<Long?>(null)
        private set
    var connDetail by mutableStateOf("Nunca testada")
        private set
    var connAt by mutableStateOf(0L)
        private set
    fun testConnection() = viewModelScope.launch {
        if (testing) return@launch
        testing = true
        try {
            val t0 = android.os.SystemClock.elapsedRealtime()
            val c = api.capabilities()
            val ms = android.os.SystemClock.elapsedRealtime() - t0
            connOk = true; connMs = ms; connAt = System.currentTimeMillis()
            connDetail = "Online · ${ms} ms · ${c.providers.joinToString { it.name }}"
        } catch (e: Exception) {
            connOk = false; connMs = null; connAt = System.currentTimeMillis()
            val m = e.message.orEmpty()
            connDetail = when {
                e is retrofit2.HttpException && e.code() == 401 -> "Chave rejeitada (401) — confira a chave"
                "Unable to resolve host" in m || "UnknownHost" in m -> "Servidor inalcançável — confira rede/URL"
                "timeout" in m.lowercase() -> "Tempo esgotado — servidor lento ou fora do ar"
                else -> "Falha: ${m.take(100)}"
            }
        } finally { testing = false }
    }

    /** Estado da verificação de nova versão (Release do GitHub). */
    var update by mutableStateOf<UpdateState>(UpdateState.Idle)
        private set

    fun checkForUpdates() {
        if (update is UpdateState.Checking) return
        viewModelScope.launch {
            update = UpdateState.Checking
            update = try {
                val rel = withContext(Dispatchers.IO) { fetchLatestRelease() }
                val tag = rel?.tag_name?.trim().orEmpty()
                if (tag.isEmpty() || !isNewerVersion(tag, BuildConfig.VERSION_NAME)) UpdateState.UpToDate
                else {
                    val apk = rel!!.assets.firstOrNull { it.name.endsWith(".apk", ignoreCase = true) }
                    UpdateState.Available(tag.removePrefix("v"), apk?.browser_download_url ?: rel.html_url)
                }
            } catch (e: Exception) { UpdateState.Failed(e.message?.take(120) ?: "falha de rede") }
        }
    }

    /** Troca o servidor e a chave da API e reconecta (aceita URL com ou sem http/https e barra final). */
    fun saveServer(u: String, key: String) {
        val k = key.trim()
        if (k.isEmpty()) { message = "Informe a chave da API (X-App-Key)."; return }
        baseUrl = normalizeBaseUrl(u)
        appKey = k
        ApiAuth.appKey = k
        prefs.edit().putString("api_base_url", baseUrl).putString("api_app_key", k).apply()
        message = "Conectando…"
        viewModelScope.launch { loadCaps(); if (caps?.providers.isNullOrEmpty()) message = "Sem conexão com a API." else { message = ""; refresh() } }
    }
}
