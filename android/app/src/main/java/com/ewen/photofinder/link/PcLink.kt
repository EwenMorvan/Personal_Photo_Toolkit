package com.ewen.photofinder.link

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.ewen.photofinder.data.Exporter
import com.ewen.photofinder.data.MediaItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Une demande d'import envoyée par Photo Studio (PC) sur le réseau local. */
data class PcRequest(
    val pc: String,
    val project: String,
    val ip: String,
    val port: Int,
    val token: String,
    val lastSeen: Long = System.currentTimeMillis(),
    /** Ignorée ou déjà envoyée : plus de bandeau ni de notification, mais le PC reste choisissable dans l'export. */
    val dismissed: Boolean = false,
) {
    val base get() = "http://$ip:$port"
    /** Le PC renvoie son signal toutes les 2–6 s tant que la demande est ouverte. */
    val fresh get() = System.currentTimeMillis() - lastSeen < 45_000
}

object PcLink {
    const val DISCOVERY_PORT = 47321
    const val FOLDER = "Depuis_telephone"

    /** Demande en cours (partagée entre le service d'écoute et l'interface). */
    val request = MutableStateFlow<PcRequest?>(null)

    /** Identifiant propre à ce téléphone : le PC distingue ainsi plusieurs téléphones sur le même Wi-Fi. */
    @Volatile private var id: String? = null
    fun phoneId(ctx: Context): String = id ?: synchronized(this) {
        id ?: ctx.getSharedPreferences("link", 0).let { p ->
            p.getString("id", null) ?: java.util.UUID.randomUUID().toString().also { p.edit().putString("id", it).apply() }
        }.also { id = it }
    }

    private fun q(ctx: Context, r: PcRequest) = "token=${enc(r.token)}&phone=${enc(phoneId(ctx))}"

    fun deviceName(ctx: Context): String =
        runCatching { Settings.Global.getString(ctx.contentResolver, "device_name") }.getOrNull()
            ?: "${Build.MANUFACTURER} ${Build.MODEL}"

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun post(url: String, body: String? = null, timeout: Int = 6000): Pair<Int, JSONObject?> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = timeout
            c.readTimeout = timeout
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = c.responseCode
            val txt = runCatching { (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText() }.getOrNull()
            return code to txt?.let { runCatching { JSONObject(it) }.getOrNull() }
        } finally {
            c.disconnect()
        }
    }

    /** Prévient le PC que le téléphone a reçu la demande. false = demande expirée. */
    fun hello(ctx: Context, r: PcRequest): Boolean = runCatching {
        post("${r.base}/hello?${q(ctx, r)}", JSONObject().put("device", deviceName(ctx)).put("id", phoneId(ctx)).toString()).first == 200
    }.getOrDefault(false)

    /** « Ignorer » : seul ce téléphone se retire, les autres téléphones gardent la demande. */
    fun decline(ctx: Context, r: PcRequest) {
        runCatching { post("${r.base}/cancel?${q(ctx, r)}") }
        dismiss(r)
    }

    fun dismiss(r: PcRequest) {
        request.value?.takeIf { it.token == r.token }?.let { request.value = it.copy(dismissed = true) }
    }

    data class Progress(val done: Int, val copied: Int, val skipped: Int)

    /** Envoie les fichiers directement dans le dossier du projet Photo Studio. */
    suspend fun send(ctx: Context, r: PcRequest, items: List<MediaItem>, progress: (Progress) -> Unit): Exporter.Result =
        withContext(Dispatchers.IO) {
            val (code, _) = post("${r.base}/begin?${q(ctx, r)}&total=${items.size}")
            if (code != 200) throw IllegalStateException(
                if (code == 403) "La demande du PC a expiré : relance « Depuis le téléphone » dans Photo Studio."
                else "Le PC ne répond pas (code $code)."
            )
            var copied = 0
            var skipped = 0
            val failed = ArrayList<String>()
            items.forEachIndexed { i, item ->
                ensureActive()
                try {
                    when (val s = uploadOne(ctx, r, item)) {
                        "saved" -> copied++
                        "skipped" -> skipped++
                        else -> failed += "${item.name} : $s"
                    }
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    failed += "${item.name} : ${e.message ?: e.javaClass.simpleName}"
                }
                progress(Progress(i + 1, copied, skipped))
            }
            runCatching { post("${r.base}/done?${q(ctx, r)}") }
            dismiss(r)
            Exporter.Result(copied, skipped, failed, "${r.pc} › ${r.project} › $FOLDER", 0)
        }

    private fun uploadOne(ctx: Context, r: PcRequest, item: MediaItem): String {
        val resolver = ctx.contentResolver
        val size = if (item.size > 0) item.size
        else runCatching { resolver.openFileDescriptor(item.uri, "r")?.use { it.statSize } }.getOrNull() ?: -1L
        val url = "${r.base}/upload?${q(ctx, r)}&name=${enc(item.name)}&size=$size&date=${item.dateMs}"
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 8000
            c.readTimeout = 120_000
            c.setRequestProperty("Content-Type", "application/octet-stream")
            if (size > 0) c.setFixedLengthStreamingMode(size) else c.setChunkedStreamingMode(1 shl 16)
            (resolver.openInputStream(item.uri) ?: error("lecture impossible")).use { inp ->
                c.outputStream.use { out -> inp.copyTo(out, 1 shl 16) }
            }
            val code = c.responseCode
            val txt = runCatching { (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText() }.getOrNull()
            val json = txt?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (code == 403) throw IllegalStateException("demande expirée")
            return json?.optString("status")?.takeIf { it == "saved" || it == "skipped" }
                ?: (json?.optString("reason") ?: "erreur $code")
        } finally {
            c.disconnect()
        }
    }
}
