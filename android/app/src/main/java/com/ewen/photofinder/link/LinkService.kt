package com.ewen.photofinder.link

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.ewen.photofinder.MainActivity
import com.ewen.photofinder.R
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import kotlin.concurrent.thread

/**
 * Écoute en arrière-plan les demandes de Photo Studio (signal UDP sur le Wi-Fi).
 * Quand le PC demande des photos : notification → l'app s'ouvre pour choisir les photos.
 */
class LinkService : Service() {

    private var socket: DatagramSocket? = null
    private var lock: WifiManager.MulticastLock? = null
    @Volatile private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels(this)
        val n = NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_link)
            .setContentTitle("Prêt à envoyer vers le PC")
            .setContentText("Photo Studio peut demander des photos sur ce Wi-Fi")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openApp(this))
            .build()
        ServiceCompat.startForeground(
            this, ID_SERVICE, n,
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        )
        running = true
        lock = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager)
            .createMulticastLock("photofinder-link").apply { setReferenceCounted(false); runCatching { acquire() } }
        thread(name = "pc-link-listener", isDaemon = true) { listen() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        running = false
        runCatching { socket?.close() }
        runCatching { lock?.release() }
        super.onDestroy()
    }

    private fun listen() {
        while (running) {
            try {
                DatagramSocket(null).use { s ->
                    socket = s
                    s.reuseAddress = true
                    s.broadcast = true
                    s.bind(InetSocketAddress(PcLink.DISCOVERY_PORT))
                    val buf = ByteArray(4096)
                    while (running) {
                        val p = DatagramPacket(buf, buf.size)
                        s.receive(p)
                        val ip = p.address?.hostAddress
                        if (ip != null) handle(String(p.data, 0, p.length), ip)
                    }
                }
            } catch (e: Exception) {
                if (running) Thread.sleep(3000) // réseau coupé : on réessaie
            }
        }
    }

    private fun handle(msg: String, fromIp: String) {
        val j = runCatching { JSONObject(msg) }.getOrNull() ?: return
        if (j.optString("app") != "photo-studio" || j.optString("type") != "request") return
        val token = j.optString("token").takeIf { it.isNotEmpty() } ?: return
        val req = PcRequest(
            pc = j.optString("pc", "PC"),
            project = j.optString("project", "projet"),
            ip = fromIp,
            port = j.optInt("port", 5056),
            token = token,
        )
        val prev = PcLink.request.value
        if (prev?.token == token) {
            // même demande : on la garde vivante (elle peut avoir été ignorée/servie → pas de nouvelle notification)
            PcLink.request.value = prev.copy(lastSeen = System.currentTimeMillis(), ip = fromIp)
            return
        }
        // Nouvelle demande : on répond au PC puis on prévient l'utilisateur
        if (!PcLink.hello(this, req)) return
        PcLink.request.value = req
        notifyRequest(req)
    }

    private fun notifyRequest(r: PcRequest) {
        val n = NotificationCompat.Builder(this, CH_REQUEST)
            .setSmallIcon(R.drawable.ic_stat_link)
            .setContentTitle("${r.pc} demande des photos")
            .setContentText("Projet « ${r.project} » · touche pour choisir les photos à envoyer")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60_000L)
            .setContentIntent(openApp(this, fromPc = true))
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(ID_REQUEST, n) }
    }

    companion object {
        const val CH_SERVICE = "link_service"
        const val CH_REQUEST = "link_request"
        const val ID_SERVICE = 10
        const val ID_REQUEST = 11
        const val EXTRA_FROM_PC = "from_pc"

        fun start(ctx: Context) {
            runCatching { ContextCompat.startForegroundService(ctx, Intent(ctx, LinkService::class.java)) }
        }

        fun cancelRequestNotification(ctx: Context) {
            runCatching { ctx.getSystemService(NotificationManager::class.java).cancel(ID_REQUEST) }
        }

        private fun openApp(ctx: Context, fromPc: Boolean = false): PendingIntent =
            PendingIntent.getActivity(
                ctx, if (fromPc) 1 else 0,
                Intent(ctx, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra(EXTRA_FROM_PC, fromPc),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun createChannels(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CH_SERVICE, "Écoute du PC", NotificationManager.IMPORTANCE_MIN)
                    .apply { description = "Permet à Photo Studio de demander des photos" }
            )
            nm.createNotificationChannel(
                NotificationChannel(CH_REQUEST, "Demandes du PC", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Quand Photo Studio demande des photos" }
            )
        }
    }
}

/** Relance l'écoute après un redémarrage du téléphone. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) LinkService.start(context)
    }
}

