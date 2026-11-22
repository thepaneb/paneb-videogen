package com.example.videogen

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.activity.viewModels
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private val vmWarm: VideoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.tabDestination()?.let { vmWarm.tab = it }
        setContent { MaterialTheme { Surface { App() } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.tabDestination()?.let { vmWarm.tab = it }
    }
}

private fun Intent.tabDestination() = getIntExtra("videogen.tab", -1).takeIf { it in 0..2 }

@Composable
fun App(vm: VideoViewModel = viewModel()) {
    // Permissão de notificação: primeiro explica o porquê (diálogo próprio), depois pede ao sistema.
    // Se negar, não insistimos — a tela Ajustes oferece o atalho para as configurações.
    val ctx = LocalContext.current
    var notifDialog by rememberSaveable { mutableStateOf(false) }
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        appPrefs(ctx).edit().putBoolean("notif_asked", true).apply()
        notifDialog = false
    }
    LaunchedEffect(Unit) {
        if (!hasNotifPermission(ctx) && !appPrefs(ctx).getBoolean("notif_asked", false)) notifDialog = true
    }
    if (notifDialog) AlertDialog(
        onDismissRequest = { notifDialog = false; appPrefs(ctx).edit().putBoolean("notif_asked", true).apply() },
        title = { Text("Ativar notificações?") },
        text = { Text("Avisamos quando seu vídeo fica pronto e quando há versão nova do app. Sem spam — só esses dois casos.") },
        confirmButton = { TextButton(onClick = { notifLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS) }) { Text("Ativar") } },
        dismissButton = { TextButton(onClick = { notifDialog = false; appPrefs(ctx).edit().putBoolean("notif_asked", true).apply() }) { Text("Agora não") } },
    )
    Scaffold(bottomBar = {
        NavigationBar {
            NavigationBarItem(selected = vm.tab == 0, onClick = { vm.tab = 0 },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                label = { NavLabel("Criar", vm.tab == 0) }, alwaysShowLabel = true)
            NavigationBarItem(selected = vm.tab == 1, onClick = { vm.tab = 1 },
                icon = { Icon(Icons.Filled.History, contentDescription = null) },
                label = { NavLabel("Histórico", vm.tab == 1) }, alwaysShowLabel = true)
            NavigationBarItem(selected = vm.tab == 2, onClick = { vm.tab = 2 },
                icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                label = { NavLabel("Ajustes", vm.tab == 2) }, alwaysShowLabel = true)
        }
    }) { pad ->
        Box(Modifier.padding(pad).statusBarsPadding()) {
            if (vm.tab == 0) CreateScreen(vm) else if (vm.tab == 1) HistoryScreen(vm) else SettingsScreen(vm)
        }
    }
}

@Composable
private fun NavLabel(text: String, selected: Boolean) = Text(
    text,
    fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Normal,
    fontSize = if (selected) 15.sp else 13.sp,
)

@Composable
fun <T> Chips(options: List<T>, selected: T, label: (T) -> String = { it.toString() }, onSelect: (T) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { o -> FilterChip(selected = o == selected, onClick = { onSelect(o) }, label = { Text(label(o)) }) }
    }
}

@Composable
fun ImagePicker(title: String, uri: Uri?, onPick: (Uri?) -> Unit) {
    val launcher = rememberLauncherForActivityResult(PickVisualMedia()) { if (it != null) onPick(it) }
    val ctx = LocalContext.current
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { launcher.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly)) }) {
            Text(if (uri == null) title else "Trocar")
        }
        if (uri != null) {
            AsyncImage(
                model = coil.request.ImageRequest.Builder(ctx).data(uri).size(256).crossfade(true).build(),
                contentDescription = "Imagem selecionada",
                modifier = Modifier.height(56.dp),
            )
            TextButton(onClick = { onPick(null) }) { Text("Remover") }
        }
    }
}

@Composable
fun CreateScreen(vm: VideoViewModel) {
    val c = vm.current
    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        vm.adjustSource?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Ajustando job anterior (imagem mantida)", modifier = Modifier.weight(1f))
                TextButton(onClick = vm::cancelAdjust) { Text("Cancelar") }
            }
        }
        if (c == null) {
            Text(vm.message.ifEmpty { "Carregando…" })
            Button(onClick = { /* reconsulta */ vm.tab = 0; vm.viewModelScopeReload() }) { Text("Tentar de novo") }
            return@Column
        }
        if ((vm.caps?.providers?.size ?: 0) > 1) {
            Text("Provedor")
            Chips(vm.caps!!.providers.map { it.name }, vm.provider) { vm.selectProvider(it) }
            vm.adjustSource?.let { src ->
                if (vm.provider != src.provider) Text("Refazendo com ${vm.provider} (original: ${src.provider})",
                    style = MaterialTheme.typography.labelSmall)
            }
        }
        OutlinedTextField(
            value = vm.prompt, onValueChange = { vm.prompt = it },
            label = { Text("Descreva o vídeo") }, minLines = 3, modifier = Modifier.fillMaxWidth(),
        )
        if (vm.caps?.promptEnhance == true) OutlinedButton(
            onClick = vm::enhance, enabled = !vm.enhancing && vm.prompt.isNotBlank(),
        ) { Text(if (vm.enhancing) "Melhorando…" else "Melhorar prompt") }
        if (c.features.negativePrompt) OutlinedTextField(
            value = vm.negative, onValueChange = { vm.negative = it },
            label = { Text("O que evitar (opcional)") }, modifier = Modifier.fillMaxWidth(),
        )
        if (c.features.image) ImagePicker("Imagem inicial", vm.imageUri) { vm.imageUri = it }
        if (c.features.lastImage && vm.imageUri != null) ImagePicker("Imagem final", vm.lastUri) { vm.lastUri = it }

        Text("Duração")
        Chips(c.durations, vm.duration, { "${it}s" }) { vm.duration = it }
        Text("Proporção")
        Chips(c.aspects, vm.aspect) { vm.aspect = it }
        if (c.qualities.size > 1) {
            Text("Qualidade")
            Chips(c.qualities, vm.quality, { if (it == "pro") "Alta (pro)" else if (it == "low") "Leve (rápida)" else "Padrão" }) { vm.quality = it }
        }
        if (c.features.tune.isNotEmpty()) {
            var showTune by rememberSaveable { mutableStateOf(false) }
            val tune = c.features.tune.toSet()
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { showTune = !showTune }) {
                Text("Ajustes finos", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Icon(if (showTune) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, "Mostrar ou ocultar ajustes")
            }
            if (showTune) {
            if ("promptEnhance" in tune) Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Expandir prompt (LTX)", modifier = Modifier.weight(1f))
                Switch(checked = vm.promptEnhance, onCheckedChange = { vm.promptEnhance = it })
            }
            if ("imgStrength" in tune) {
                Text("Força da imagem: ${(vm.imgStrength * 100).toInt()}%")
                Slider(value = vm.imgStrength, onValueChange = { vm.imgStrength = it }, valueRange = 0f..1f, modifier = Modifier.fillMaxWidth())
            }
            if ("cfg" in tune) {
                Text("Aderência ao prompt (CFG): ${"%.1f".format(vm.cfg)}")
                Slider(value = vm.cfg, onValueChange = { vm.cfg = it }, valueRange = 0f..10f, steps = 19, modifier = Modifier.fillMaxWidth())
            }
            if ("steps" in tune) {
                Text("Passos do sampler")
                Chips(listOf("low", "std", "high"), vm.steps, { if (it == "low") "Rápido" else if (it == "high") "Detalhado" else "Padrão" }) { vm.steps = it }
            }
            if ("camera" in tune) {
                Text("Movimento de câmera")
                Chips(cameraMotions.map { it.first }, vm.camera, { m -> cameraMotions.first { it.first == m }.second }) { vm.camera = it }
            }
            }
        }

        Button(onClick = vm::generate, enabled = !vm.sending && vm.prompt.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text(if (vm.sending) "Enviando…" else "Gerar")
        }
        if (vm.message.isNotEmpty()) Text(vm.message)
    }
}

private val cameraMotions = listOf(
    "Static" to "parada", "Pan Up" to "para cima", "Pan Down" to "para baixo",
    "Pan Left" to "para a esquerda", "Pan Right" to "para a direita",
    "Zoom In" to "aproximar", "Zoom Out" to "afastar",
    "Anti Clockwise (ACW)" to "girar anti-horário", "ClockWise (CW)" to "girar horário",
)
private fun cameraLabel(m: String) = cameraMotions.firstOrNull { it.first == m }?.second ?: m

private fun statusLabel(s: String) = when (s) {
    "queued" -> "Na fila"; "running" -> "Gerando…"; "succeeded" -> "Pronto"
    "failed" -> "Falhou"; "canceled" -> "Cancelado"; else -> s
}

private fun agoLabel(s: Long) = when {
    s < 5 -> "agora mesmo"; s < 60 -> "${s}s"; s < 3600 -> "${s / 60} min"; else -> "${s / 3600} h"
}

private fun etaLabel(s: Long) = when {
    s < 60 -> "≈ $s s"; s < 5400 -> "≈ ${s / 60} min"; else -> "≈ ${s / 3600} h"
}

private fun dateLabel(ts: Long) = try {
    val z = java.time.ZoneId.systemDefault()
    val d = java.time.Instant.ofEpochMilli(ts).atZone(z)
    val now = java.time.ZonedDateTime.now(z)
    val fmt = if (d.year == now.year) "dd/MM HH:mm" else "dd/MM/yyyy HH:mm"
    java.time.format.DateTimeFormatter.ofPattern(fmt).format(d)
} catch (_: Exception) { "" }

@Composable
fun HistoryScreen(vm: VideoViewModel) {
    var playing by rememberSaveable { mutableStateOf<String?>(null) }
    val ctx = LocalContext.current
    // Pausa o polling com a tela invisível; intervalo curto só com job ativo, longo caso contrário.
    val resumed = remember { mutableStateOf(true) }
    DisposableEffect(ctx) {
        val lo = ctx as? LifecycleOwner
        val obs = LifecycleEventObserver { _, e -> resumed.value = (e == Lifecycle.Event.ON_RESUME) }
        lo?.lifecycle?.addObserver(obs)
        onDispose { lo?.lifecycle?.removeObserver(obs) }
    }
    LaunchedEffect(Unit) {
        while (true) {
            if (resumed.value) vm.refresh()
            delay(if (vm.jobs.any { it.active }) 4_000 else 30_000)
        }
    }
    if (vm.stale) Text(
        "Desatualizado — sem conexão com a API",
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(horizontal = 16.dp),
    )

    LazyColumnOrEmpty(vm.jobs) { j ->
        val ctx = LocalContext.current
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(j.prompt, maxLines = 2, style = MaterialTheme.typography.bodyLarge)
                Text("${statusLabel(j.status)} · ${j.provider} · ${dateLabel(j.createdAt)}" +
                    (if (j.locked) " · protegido" else ""), style = MaterialTheme.typography.labelMedium)
                j.params?.let { p ->
                    val q = when (p.quality) { "pro" -> "Alta"; "low" -> "Leve"; else -> "Padrão" }
                    val extra = buildList {
                        if (p.promptEnhance) add("expandido")
                        p.cfg?.takeIf { it != 1.0 }?.let { add("cfg $it") }
                        p.imgStrength?.takeIf { it != 0.7 }?.let { add("img ${(it * 100).toInt()}%") }
                        p.steps?.takeIf { it != "std" }?.let { add(if (it == "low") "rápido" else "detalhado") }
                        p.camera?.let { add(cameraLabel(it)) }
                    }
                    Text("${p.durationSec}s · ${p.aspect} · $q" +
                        (p.seed?.let { " · seed $it" } ?: "") +
                        (if (p.hasImage || p.hasLastImage) " · com imagem" else "") +
                        (if (extra.isNotEmpty()) " · ${extra.joinToString(" ")}" else "") +
                        (p.negativePrompt?.takeIf { it.isNotBlank() }?.let { " · evita: ${it.take(40)}" } ?: ""),
                        style = MaterialTheme.typography.labelSmall)
                }
                if (j.active) {
                    // Na fila (progresso 0): animação indeterminada para mostrar atividade.
                    // Gerando: barra determinada com o progresso real + previsão.
                    val p = j.progress
                    if (p != null && p > 0) LinearProgressIndicator(progress = { p.toFloat() }, modifier = Modifier.fillMaxWidth())
                    else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    j.etaSec?.let { Text("≈ ${etaLabel(it)} restantes", style = MaterialTheme.typography.labelSmall) }
                }
                j.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Row(Modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    val url = j.output?.url?.let { resolveUrl(it, vm.baseUrl) }
                    if (url != null) {
                        IconButton(onClick = { playing = url }) { Icon(Icons.Filled.PlayArrow, "Assistir") }
                        IconButton(onClick = { vm.saveVideo(ctx, url, j.id) }) { Icon(Icons.Filled.Download, "Salvar na galeria") }
                        IconButton(onClick = { vm.shareVideo(ctx, url, j.id) }) { Icon(Icons.Filled.Share, "Compartilhar") }
                    }
                    if (j.active) IconButton(onClick = { vm.cancel(j.id) }) { Icon(Icons.Filled.Close, "Cancelar") }
                    else {
                        IconButton(onClick = { vm.repeat(j.id, 1) }) { Icon(Icons.Filled.Refresh, "Refazer") }
                        IconButton(onClick = { vm.repeat(j.id, 2) }) { Icon(Icons.Filled.ContentCopy, "Variar ×2") }
                        IconButton(onClick = { vm.startAdjust(j) }) { Icon(Icons.Filled.Tune, "Ajustar e gerar de novo") }
                    }
                    IconButton(onClick = { vm.toggleLock(j) }) {
                        Icon(if (j.locked) Icons.Filled.LockOpen else Icons.Filled.Lock, if (j.locked) "Desproteger" else "Proteger contra exclusão")
                    }
                    IconButton(onClick = { vm.delete(j.id) }) { Icon(Icons.Filled.Delete, "Excluir") }
                }
            }
        }
    }
    playing?.let { url ->
        AlertDialog(onDismissRequest = { playing = null }, confirmButton = { TextButton(onClick = { playing = null }) { Text("Fechar") } },
            text = { VideoPlayer(url) })
    }
}

@Composable
fun SettingsScreen(vm: VideoViewModel) {
    var urlDraft by rememberSaveable(vm.baseUrl) { mutableStateOf(vm.baseUrl) }
    var keyDraft by rememberSaveable(vm.appKey) { mutableStateOf(vm.appKey) }
    LaunchedEffect(Unit) {
        vm.testConnection()
        while (true) { delay(60_000); vm.testConnection() }
    }
    LaunchedEffect(Unit) { vm.checkForUpdates() }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Servidor da API", style = MaterialTheme.typography.labelLarge)
        OutlinedTextField(
            value = urlDraft, onValueChange = { urlDraft = it },
            label = { Text("URL base (https://…)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = keyDraft, onValueChange = { keyDraft = it },
            label = { Text("Chave da API (X-App-Key)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = { vm.saveServer(urlDraft, keyDraft) }, modifier = Modifier.fillMaxWidth()) { Text("Salvar e reconectar") }
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                val dot = when (vm.connOk) { true -> MaterialTheme.colorScheme.primary; false -> MaterialTheme.colorScheme.error; null -> MaterialTheme.colorScheme.outline }
                Box(Modifier.size(12.dp).background(dot, CircleShape)
                    .semantics { contentDescription = when (vm.connOk) { true -> "Online"; false -> "Offline"; else -> "Não testada" } })
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        when (vm.connOk) { true -> "Online"; false -> "Offline"; null -> "Não testada" },
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(vm.connDetail, style = MaterialTheme.typography.labelSmall)
                    if (vm.connAt > 0L) Text(
                        "verificado há ${agoLabel((now - vm.connAt).coerceAtLeast(0) / 1000)}",
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                TextButton(onClick = vm::testConnection, enabled = !vm.testing) { Text(if (vm.testing) "…" else "Testar") }
            }
        }
        if (vm.message.isNotEmpty()) Text(vm.message)
        Text("Versão ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.labelSmall)
        val updCtx = LocalContext.current
        when (val u = vm.update) {
            is UpdateState.Available -> Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Nova versão ${u.version} disponível", style = MaterialTheme.typography.titleSmall)
                    Button(onClick = { openUrl(updCtx, u.url) }, modifier = Modifier.fillMaxWidth()) { Text("Baixar") }
                }
            }
            UpdateState.Checking -> Text("Verificando atualizações…", style = MaterialTheme.typography.labelSmall)
            is UpdateState.Failed -> Text("Atualização: ${u.msg}", style = MaterialTheme.typography.labelSmall)
            else -> {}
        }
        TextButton(onClick = vm::checkForUpdates, enabled = vm.update !is UpdateState.Checking) { Text("Verificar atualizações") }
        // Se a permissão foi negada (com "não perguntar de novo" o sistema nem exibe), atalho para as configurações.
        val setCtx = LocalContext.current
        var notifOn by remember { mutableStateOf(hasNotifPermission(setCtx)) }
        val setLo = setCtx as? LifecycleOwner
        DisposableEffect(setLo) {
            val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) notifOn = hasNotifPermission(setCtx) }
            setLo?.lifecycle?.addObserver(obs)
            onDispose { setLo?.lifecycle?.removeObserver(obs) }
        }
        if (!notifOn) Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Notificações desativadas", modifier = Modifier.weight(1f))
            TextButton(onClick = { openAppSettings(setCtx) }) { Text("Ativar") }
        }
    }
}

private fun openAppSettings(ctx: android.content.Context) {
    try {
        ctx.startActivity(android.content.Intent(
            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", ctx.packageName, null),
        ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) { /* sem app de configurações: mantém como está */ }
}

private fun openUrl(ctx: android.content.Context, url: String) {
    try { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
    catch (_: Exception) { /* sem navegador: o link continua visível no cartão */ }
}

@Composable
fun LazyColumnOrEmpty(list: List<JobDto>, row: @Composable (JobDto) -> Unit) {
    if (list.isEmpty()) { Box(Modifier.fillMaxSize().padding(24.dp)) { Text("Nenhum vídeo ainda.") }; return }
    androidx.compose.foundation.lazy.LazyColumn(
        Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { items(list.size, key = { list[it].id }) { row(list[it]) } }
}

@Composable
fun VideoPlayer(url: String) {
    val ctx = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(ctx).build().apply { setMediaItem(MediaItem.fromUri(url)); prepare(); playWhenReady = true }
    }
    val lo = ctx as? LifecycleOwner
    DisposableEffect(player, lo) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_PAUSE) player.pause() }
        lo?.lifecycle?.addObserver(obs)
        onDispose { lo?.lifecycle?.removeObserver(obs); player.release() }
    }
    AndroidView(factory = { PlayerView(it).apply { this.player = player } }, modifier = Modifier.fillMaxWidth().height(360.dp))
}

