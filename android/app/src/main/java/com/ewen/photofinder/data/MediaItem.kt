package com.ewen.photofinder.data

import android.net.Uri
import java.time.LocalDate

/** Une photo ou vidéo trouvée sur le téléphone, peu importe sa provenance. */
data class MediaItem(
    /** Identifiant unique (sélection, clés de liste). */
    val key: String,
    /** content:// (indexé par la galerie) ou file:// (trouvé par le scan approfondi). */
    val uri: Uri,
    /** Chemin complet, ex. /storage/emulated/0/DCIM/Camera/IMG_1234.jpg */
    val path: String,
    val name: String,
    /** Dossier relatif, ex. DCIM/Camera */
    val folder: String,
    /** Provenance lisible, ex. "WhatsApp", "Appareil photo" */
    val source: String,
    val isVideo: Boolean,
    val dateMs: Long,
    val day: LocalDate,
    val size: Long,
    val width: Int,
    val height: Int,
    val mime: String,
    val durationMs: Long,
    /** false = fichier ignoré par la galerie Android (.nomedia, dossier caché…). */
    val indexed: Boolean,
    val modifiedSec: Long,
    /** true si la date vient de la prise de vue (EXIF / index), pas du fichier. */
    val hasTakenDate: Boolean = false,
) {
    /** Clé du cache GPS : change si le fichier est modifié. */
    val cacheKey: String = "$path|$modifiedSec|$size"
}

object Sources {
    const val CAMERA = "Appareil photo"
    const val SCREENSHOTS = "Captures d'écran"
    const val WHATSAPP = "WhatsApp"
    const val QUICKSHARE = "Quick Share"
    const val DOWNLOADS = "Téléchargements"
    const val TELEGRAM = "Telegram"
    const val INSTAGRAM = "Instagram"
    const val SNAPCHAT = "Snapchat"
    const val MESSENGER = "Messenger"
    const val FACEBOOK = "Facebook"
    const val SIGNAL = "Signal"
    const val DISCORD = "Discord"
    const val BLUETOOTH = "Bluetooth"
    const val EXPORTS = "Exports Photo Finder"
    const val OTHER = "Autres dossiers"

    fun classify(folder: String): String {
        val f = folder.lowercase()
        return when {
            "photofinder" in f -> EXPORTS
            "whatsapp" in f -> WHATSAPP
            "telegram" in f -> TELEGRAM
            "instagram" in f -> INSTAGRAM
            "snapchat" in f -> SNAPCHAT
            "messenger" in f -> MESSENGER
            "facebook" in f -> FACEBOOK
            "org.thoughtcrime.securesms" in f || f.startsWith("signal") || "/signal" in f -> SIGNAL
            "discord" in f -> DISCORD
            "quick share" in f || "quickshare" in f || "nearby" in f -> QUICKSHARE
            "screenshot" in f || "screen_record" in f || "screenrecord" in f || "screen record" in f -> SCREENSHOTS
            "bluetooth" in f -> BLUETOOTH
            f.startsWith("download") || "/download" in f -> DOWNLOADS
            f.startsWith("dcim") || "/dcim" in f -> CAMERA
            else -> OTHER
        }
    }
}
