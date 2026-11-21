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
@Serializable data class CapsDto(val default: String, val providers: List<ProviderCaps>, val promptEnhance: Boolean = false)
@Serializable data class OutputDto(val url: String, val durationSec: Double? = null)
@Serializable data class JobDto(
    val id: String, val provider: String = "", val status: String = "queued", val prompt: String = "",
    val params: JobParamsDto? = null,
    val output: OutputDto? = null, val error: String? = null, val createdAt: Long = 0,
    val progress: Double? = null, val etaSec: Long? = null,
) { val active get() = status == "queued" || status == "running" }
@Serializable data class JobParamsDto(
    val durationSec: Int = 5, val aspect: String = "9:16", val quality: String = "std",
    val seed: Long? = null, val negativePrompt: String? = null,
    val hasImage: Boolean = false, val hasLastImage: Boolean = false,
    val promptEnhance: Boolean = false, val cfg: Double? = null, val imgStrength: Double? = null, val steps: String? = null,
)
@Serializable data class JobsDto(val items: List<JobDto>)
@Serializable data class RepeatBody(
    val count: Int = 1, val sameSeed: Boolean = false, val prompt: String? = null,
    val duration: Int? = null, val aspect: String? = null, val quality: String? = null,
    val negativePrompt: String? = null, val promptEnhance: Boolean? = null,
    val cfg: Double? = null, val imgStrength: Double? = null, val steps: String? = null,
)
@Serializable data class RepeatDto(val items: List<JobDto> = emptyList(), val error: String? = null)
@Serializable data class EnhanceBody(val prompt: String, val provider: String? = null, val hasImage: Boolean = false)
@Serializable data class EnhanceDto(val enhanced: String)

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
    ): JobDto

    @GET("jobs") suspend fun list(@Query("limit") limit: Int = 30): JobsDto
    @POST("jobs/{id}/cancel") suspend fun cancel(@Path("id") id: String): JobDto
    @POST("jobs/{id}/repeat") suspend fun repeat(@Path("id") id: String, @Body body: RepeatBody): RepeatDto
    @POST("prompt/enhance") suspend fun enhance(@Body body: EnhanceBody): EnhanceDto
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
