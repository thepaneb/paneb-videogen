package com.example.videogen

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.*
import java.util.concurrent.TimeUnit

@Serializable data class Features(
    val image: Boolean = false, val lastImage: Boolean = false,
    val negativePrompt: Boolean = false, val cancel: Boolean = false, val seed: Boolean = false,
    val tune: List<String> = emptyList(),
)
@Serializable data class ProviderCaps(
    val name: String, val durations: List<Int>, val aspects: List<String>,
    val qualities: List<String>, val features: Features = Features(),
)
@Serializable data class CapsDto(val default: String, val providers: List<ProviderCaps>, val promptEnhance: Boolean = false, val push: Boolean = false)
@Serializable data class OutputDto(val url: String, val durationSec: Double? = null)
@Serializable data class JobDto(
    val id: String, val provider: String = "", val status: String = "queued", val prompt: String = "",
    val locked: Boolean = false,
    val params: JobParamsDto? = null,
    val output: OutputDto? = null, val error: String? = null, val createdAt: Long = 0,
    val progress: Double? = null, val etaSec: Long? = null,
) { val active get() = status == "queued" || status == "running" }
@Serializable data class JobParamsDto(
    val durationSec: Int = 5, val aspect: String = "9:16", val quality: String = "std",
    val seed: Long? = null, val negativePrompt: String? = null,
    val hasImage: Boolean = false, val hasLastImage: Boolean = false,
    val promptEnhance: Boolean = false, val cfg: Double? = null, val imgStrength: Double? = null, val steps: String? = null,
    val camera: String? = null,
)
@Serializable data class JobsDto(val items: List<JobDto>)
@Serializable data class RepeatBody(
    val count: Int = 1, val sameSeed: Boolean = false, val prompt: String? = null,
    val provider: String? = null,
    val duration: Int? = null, val aspect: String? = null, val quality: String? = null,
    val negativePrompt: String? = null, val promptEnhance: Boolean? = null,
    val cfg: Double? = null, val imgStrength: Double? = null, val steps: String? = null,
    val camera: String? = null,
)
@Serializable data class RepeatDto(val items: List<JobDto> = emptyList(), val error: String? = null)
@Serializable data class EnhanceBody(val prompt: String, val provider: String? = null, val hasImage: Boolean = false)
@Serializable data class EnhanceDto(val enhanced: String)
@Serializable data class PushTokenBody(val token: String)

interface VideoApi {
    @GET("capabilities") suspend fun capabilities(): CapsDto

    @Multipart @POST("jobs")
    suspend fun create(
        @Header("Idempotency-Key") key: String,
        @Part("provider") provider: RequestBody,
        @Part("prompt") prompt: RequestBody,
        @Part("negativePrompt") negative: RequestBody?,
        @Part("duration") duration: RequestBody,
        @Part("aspect") aspect: RequestBody,
        @Part("quality") quality: RequestBody,
        @Part image: MultipartBody.Part?,
        @Part lastImage: MultipartBody.Part?,
        @Part("promptEnhance") promptEnhance: RequestBody? = null,
        @Part("cfg") cfg: RequestBody? = null,
        @Part("imgStrength") imgStrength: RequestBody? = null,
        @Part("steps") steps: RequestBody? = null,
        @Part("camera") camera: RequestBody? = null,
    ): JobDto

    @GET("jobs") suspend fun list(@Query("limit") limit: Int = 30): JobsDto
    @POST("jobs/{id}/cancel") suspend fun cancel(@Path("id") id: String): JobDto
    @POST("jobs/{id}/lock") suspend fun lock(@Path("id") id: String): JobDto
    @POST("jobs/{id}/unlock") suspend fun unlock(@Path("id") id: String): JobDto
    @POST("jobs/{id}/repeat") suspend fun repeat(@Path("id") id: String, @Body body: RepeatBody): RepeatDto
    @POST("prompt/enhance") suspend fun enhance(@Body body: EnhanceBody): EnhanceDto
    @POST("push/tokens") suspend fun pushToken(@Body body: PushTokenBody): retrofit2.Response<Unit>
    @DELETE("jobs/{id}") suspend fun delete(@Path("id") id: String): Response<Unit>
}

/** Vídeos locais vêm como "/files/x.mp4"; os de fallback já são URLs absolutas. */
fun resolveUrl(u: String, base: String) = if (u.startsWith("http")) u else base.trimEnd('/') + u

fun normalizeBaseUrl(u: String): String {
    var b = u.trim().trimEnd('/')
    if (!b.startsWith("http://") && !b.startsWith("https://")) b = "http://$b"
    return "$b/"
}

private val apis = object : LinkedHashMap<String, VideoApi>() {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, VideoApi>?) = size > 5
}
/** Chave enviada em X-App-Key; o usuário pode trocar na tela Ajustes (padrão: BuildConfig). */
object ApiAuth { @Volatile var appKey: String = BuildConfig.APP_KEY }

fun apiFor(baseUrl: String): VideoApi = synchronized(apis) {
    apis.getOrPut(baseUrl) {
        val client = OkHttpClient.Builder()
            .addInterceptor { c -> c.proceed(c.request().newBuilder().header("X-App-Key", ApiAuth.appKey).build()) }
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .callTimeout(180, TimeUnit.SECONDS)
            .build()
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(VideoApi::class.java)
    }
}

object ApiFactory {
    /** Instância padrão (BuildConfig); prefira apiFor(baseUrl) para trocar de servidor sem rebuild. */
    val api: VideoApi by lazy { apiFor(BuildConfig.API_BASE_URL) }
}

/** Push (FCM) configurado neste build? Sem as chaves do Firebase, o push fica desligado. */
fun fcmConfigured() = BuildConfig.FCM_PROJECT_ID.isNotEmpty()
    && BuildConfig.FCM_APP_ID.isNotEmpty() && BuildConfig.FCM_API_KEY.isNotEmpty()

/** Prefs com a URL/chave da API (mesma migração do ViewModel: criptografadas, com fallback). */
fun appPrefs(ctx: android.content.Context): android.content.SharedPreferences {
    val legacy = ctx.getSharedPreferences("videogen", android.content.Context.MODE_PRIVATE)
    return try {
        val alias = androidx.security.crypto.MasterKeys.getOrCreate(androidx.security.crypto.MasterKeys.AES256_GCM_SPEC)
        androidx.security.crypto.EncryptedSharedPreferences.create(
            "videogen-enc", alias, ctx,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
            .also { enc ->
                if (!enc.contains("api_base_url") && legacy.contains("api_base_url")) {
                    enc.edit().putString("api_base_url", legacy.getString("api_base_url", null))
                        .putString("api_app_key", legacy.getString("api_app_key", null)).apply()
                }
            }
    } catch (_: Exception) { legacy }
}

/** Registra o token FCM no backend (melhor esforço: nunca quebra o app). */
suspend fun registerPushToken(ctx: android.content.Context, token: String) {
    try {
        val p = appPrefs(ctx)
        val base = p.getString("api_base_url", BuildConfig.API_BASE_URL) ?: BuildConfig.API_BASE_URL
        val key = p.getString("api_app_key", BuildConfig.APP_KEY) ?: BuildConfig.APP_KEY
        if (key.isBlank()) return
        ApiAuth.appKey = key
        apiFor(base).pushToken(PushTokenBody(token))
    } catch (_: Exception) { /* rede/config: tenta de novo no próximo token ou abertura */ }
}

/** Token FCM deste aparelho (null sem Play Services/rede). */
suspend fun fetchFcmToken(): String? = try {
    kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        com.google.firebase.messaging.FirebaseMessaging.getInstance().token
            .addOnSuccessListener { cont.resume(it) {} }
            .addOnFailureListener { cont.resume(null) {} }
    }
} catch (_: Exception) { null }
