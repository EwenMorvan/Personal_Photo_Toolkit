package com.ewen.photofinder.data

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

object MediaScanner {

    private val IMG_EXT = setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp", "dng", "avif")
    private val EXIF_EXT = setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "dng")
    private val VID_EXT = setOf("mp4", "3gp", "mkv", "mov", "webm", "avi", "m4v")
    private const val DAY_MS = 86_400_000L
    const val MIN_TAKEN = 315_532_800_000L // 1980

    // ---------- Index de la galerie (MediaStore) ----------

    fun queryMediaStore(ctx: Context): List<MediaItem> {
        val out = ArrayList<MediaItem>(4096)
        val images = if (Build.VERSION.SDK_INT >= 29)
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val videos = if (Build.VERSION.SDK_INT >= 29)
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        else MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        queryCollection(ctx, images, false, out)
        queryCollection(ctx, videos, true, out)
        return out
    }

    @Suppress("DEPRECATION")
    private fun queryCollection(ctx: Context, collection: Uri, video: Boolean, out: MutableList<MediaItem>) {
        val cols = mutableListOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATA,
            "datetaken",
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.MIME_TYPE,
        )
        if (Build.VERSION.SDK_INT >= 29) cols += MediaStore.MediaColumns.RELATIVE_PATH
        if (video) cols += MediaStore.Video.VideoColumns.DURATION

        val cursor = try {
            ctx.contentResolver.query(collection, cols.toTypedArray(), null, null, null)
        } catch (e: Exception) {
            null
        } ?: return

        cursor.use { c ->
            val iId = c.getColumnIndex(MediaStore.MediaColumns._ID)
            val iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
            val iData = c.getColumnIndex(MediaStore.MediaColumns.DATA)
            val iTaken = c.getColumnIndex("datetaken")
            val iMod = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
            val iAdded = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)
            val iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
            val iW = c.getColumnIndex(MediaStore.MediaColumns.WIDTH)
            val iH = c.getColumnIndex(MediaStore.MediaColumns.HEIGHT)
            val iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
            val iRel = c.getColumnIndex("relative_path")
            val iDur = c.getColumnIndex("duration")

            while (c.moveToNext()) {
                val id = c.getLong(iId)
                val name = c.str(iName) ?: "sans_nom"
                val data = c.str(iData)
                val rel = c.str(iRel)
                val path = data ?: ("/storage/emulated/0/" + (rel ?: "") + name)
                val folder = if (data != null) relativeFolder(data) else (rel ?: "").trimEnd('/')
                val modSec = c.long(iMod)
                val addedSec = c.long(iAdded)
                val modMs = if (modSec > 0) modSec * 1000 else addedSec * 1000
                val taken = c.long(iTaken)
                val date = bestDate(taken, modMs, name)
                out += MediaItem(
                    key = (if (video) "v" else "i") + id,
                    uri = ContentUris.withAppendedId(collection, id),
                    path = path,
                    name = name,
                    folder = folder,
                    source = Sources.classify(folder),
                    isVideo = video,
                    dateMs = date,
                    day = toDay(date),
                    size = c.long(iSize),
                    width = c.long(iW).toInt(),
                    height = c.long(iH).toInt(),
                    mime = c.str(iMime) ?: if (video) "video/mp4" else "image/jpeg",
                    durationMs = c.long(iDur),
                    indexed = true,
                    modifiedSec = modSec,
                    hasTakenDate = taken > MIN_TAKEN,
                )
            }
        }
    }

    private fun Cursor.str(i: Int): String? = if (i < 0 || isNull(i)) null else getString(i)
    private fun Cursor.long(i: Int): Long = if (i < 0 || isNull(i)) 0L else getLong(i)

    // ---------- Scan approfondi (fichiers que la galerie ignore) ----------

    fun storageRoots(ctx: Context): List<File> =
        ctx.getExternalFilesDirs(null).filterNotNull().mapNotNull { f ->
            val p = f.absolutePath
            val i = p.indexOf("/Android/")
            if (i > 0) File(p.substring(0, i)) else null
        }.distinctBy { it.absolutePath }

    fun deepScan(ctx: Context, known: Set<String>, onProgress: (dirs: Int, found: Int) -> Unit): List<MediaItem> {
        val out = ArrayList<MediaItem>()
        var dirs = 0
        for (root in storageRoots(ctx)) {
            root.walkTopDown()
                .onEnter { d ->
                    dirs++
                    if (dirs % 100 == 0) onProgress(dirs, out.size)
                    val n = d.name
                    val p = d.absolutePath
                    !(n == ".thumbnails" || n == ".cache" || n.startsWith(".trash", ignoreCase = true) ||
                        n.startsWith(".Trash") || p.endsWith("/Android/data") || p.endsWith("/Android/obb"))
                }
                .onFail { _, _ -> }
                .forEach { f -> if (f.isFile) fileItem(f, known)?.let(out::add) }
        }
        onProgress(dirs, out.size)
        return out
    }

    private fun fileItem(f: File, known: Set<String>): MediaItem? {
        val ext = f.extension.lowercase()
        val video = ext in VID_EXT
        if (!video && ext !in IMG_EXT) return null
        val path = f.absolutePath
        if (path in known) return null
        val len = f.length()
        if (len < 4_000) return null // icônes, miniatures
        val mod = f.lastModified()
        val taken = if (!video && ext in EXIF_EXT) exifDate(f) ?: 0L else 0L
        val date = bestDate(taken, mod, f.name)
        val folder = relativeFolder(path)
        return MediaItem(
            key = "f:$path",
            uri = Uri.fromFile(f),
            path = path,
            name = f.name,
            folder = folder,
            source = Sources.classify(folder),
            isVideo = video,
            dateMs = date,
            day = toDay(date),
            size = len,
            width = 0,
            height = 0,
            mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                ?: if (video) "video/mp4" else "image/jpeg",
            durationMs = 0,
            indexed = false,
            modifiedSec = mod / 1000,
            hasTakenDate = taken > MIN_TAKEN,
        )
    }

    private val EXIF_FMT = DateTimeFormatter.ofPattern("yyyy:MM:dd HH:mm:ss")

    private fun exifDate(f: File): Long? = try {
        exifDate(ExifInterface(f.absolutePath))
    } catch (e: Exception) {
        null
    }

    fun exifDate(exif: ExifInterface): Long? = try {
        val s = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
            ?: exif.getAttribute(ExifInterface.TAG_DATETIME)
        s?.trim()?.let {
            LocalDateTime.parse(it, EXIF_FMT).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }?.takeIf { it > MIN_TAKEN }
    } catch (e: Exception) {
        null
    }

    // ---------- Utilitaires ----------

    private val SD_PRIMARY = Regex("^/storage/emulated/\\d+/?")
    private val SD_OTHER = Regex("^/storage/([^/]+)/?")

    fun relativeFolder(path: String): String {
        val parent = path.substringBeforeLast('/', "")
        SD_PRIMARY.find(parent)?.let { return parent.substring(it.range.last + 1) }
        SD_OTHER.find(parent)?.let { return "Carte SD/" + parent.substring(it.range.last + 1) }
        return parent
    }

    fun toDay(ms: Long): LocalDate = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()

    /**
     * Date de prise de vue si connue, sinon date contenue dans le nom de fichier
     * (IMG-20240512-WA0003, PXL_20240512_143055…) si la date de modification semble fausse,
     * sinon date de modification.
     */
    fun bestDate(taken: Long, modifiedMs: Long, name: String): Long {
        if (taken > MIN_TAKEN) return taken
        val fromName = parseNameDate(name)
        if (fromName != null && (modifiedMs <= 0 || abs(modifiedMs - fromName) > 2 * DAY_MS)) return fromName
        return if (modifiedMs > 0) modifiedMs else fromName ?: 0L
    }

    private val NAME_DATE = Regex(
        "(?<!\\d)((?:19|20)\\d{2})[-_.]?(\\d{2})[-_.]?(\\d{2})(?:[-_ .T]?(\\d{2})[-_.:h]?(\\d{2})[-_.:m]?(\\d{2}))?(?!\\d)"
    )

    fun parseNameDate(name: String): Long? {
        val m = NAME_DATE.find(name) ?: return null
        val g = m.groupValues
        return try {
            val y = g[1].toInt()
            if (y < 1990 || y > LocalDate.now().year + 1) return null
            val dt = LocalDateTime.of(
                y, g[2].toInt(), g[3].toInt(),
                g[4].toIntOrNull() ?: 12, g[5].toIntOrNull() ?: 0, g[6].toIntOrNull() ?: 0
            )
            dt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        } catch (e: Exception) {
            null
        }
    }
}
