package com.ewen.photofinder.data

import android.content.Context
import android.location.Geocoder
import android.media.MediaMetadataRetriever
import android.os.Build
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Lit les coordonnées GPS (EXIF / métadonnées vidéo) et les convertit en noms de lieux.
 * Tout est mis en cache sur le téléphone : le 2e lancement est instantané.
 */
class GeoIndex(private val ctx: Context) {

    private val points = ConcurrentHashMap<String, DoubleArray>() // [lat, lon, dateExif] ; NaN = inconnu
    private val places = ConcurrentHashMap<String, String>()
    private val pointsFile = File(ctx.filesDir, "geo_points_v2.tsv")
    private val placesFile = File(ctx.filesDir, "geo_places.tsv")
    private val none = doubleArrayOf(Double.NaN, Double.NaN, Double.NaN)
    @Volatile private var loaded = false

    fun load() {
        if (loaded) return
        loaded = true
        runCatching {
            if (pointsFile.exists()) pointsFile.forEachLine { line ->
                val p = line.split('\t')
                if (p.size == 4) points[p[0]] = DoubleArray(3) { i -> p[i + 1].toDoubleOrNull() ?: Double.NaN }
            }
            if (placesFile.exists()) placesFile.forEachLine { line ->
                val p = line.split('\t')
                if (p.size == 2 && p[1].isNotBlank()) places[p[0]] = p[1]
            }
        }
    }

    fun point(item: MediaItem): DoubleArray? = points[item.cacheKey]?.takeIf { !it[0].isNaN() }
    fun isKnown(item: MediaItem) = points.containsKey(item.cacheKey)
    fun exifDate(item: MediaItem): Long? = points[item.cacheKey]?.get(2)?.takeIf { !it.isNaN() }?.toLong()

    fun placeName(item: MediaItem): String? = point(item)?.let { placeName(it[0], it[1]) }
    fun placeName(lat: Double, lon: Double): String =
        places[cluster(lat, lon)] ?: String.format(Locale.US, "≈ %.2f, %.2f", lat, lon)

    // Grille de ~5 km pour regrouper les photos avant de demander le nom du lieu
    private fun cluster(lat: Double, lon: Double) = "${(lat / 0.05).roundToInt()},${(lon / 0.05).roundToInt()}"

    suspend fun indexPoints(
        items: List<MediaItem>,
        canReadOriginal: Boolean,
        onProgress: (done: Int, total: Int) -> Unit,
    ) = withContext(Dispatchers.IO) {
        val todo = items.filter { !points.containsKey(it.cacheKey) }
        if (todo.isEmpty()) return@withContext
        val par = Dispatchers.IO.limitedParallelism(4)
        var done = 0
        onProgress(0, todo.size)
        for (chunk in todo.chunked(64)) {
            ensureActive()
            val res = coroutineScope {
                chunk.map { item -> async(par) { item.cacheKey to readLocation(item, canReadOriginal) } }.awaitAll()
            }
            val sb = StringBuilder()
            for ((k, v) in res) {
                val arr = v ?: none
                points[k] = arr
                sb.append(k.replace('\t', ' ')).append('\t').append(arr[0]).append('\t').append(arr[1]).append('\t').append(arr[2]).append('\n')
            }
            runCatching { pointsFile.appendText(sb.toString()) }
            done += chunk.size
            onProgress(done, todo.size)
        }
    }

    private fun readLocation(item: MediaItem, canReadOriginal: Boolean): DoubleArray? = try {
        val uri = if (item.indexed && canReadOriginal && Build.VERSION.SDK_INT >= 29)
            MediaStore.setRequireOriginal(item.uri) else item.uri
        var date: Long? = null
        val ll = if (item.isVideo) {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(ctx, uri)
                parseIso6709(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION))
            } finally {
                runCatching { r.release() }
            }
        } else {
            ctx.contentResolver.openFileDescriptor(uri, "r")?.use {
                val exif = ExifInterface(it.fileDescriptor)
                if (!item.hasTakenDate) date = MediaScanner.exifDate(exif)
                exif.latLong
            }
        }
        val gps = ll?.takeIf { !(it[0] == 0.0 && it[1] == 0.0) && it[0] in -90.0..90.0 && it[1] in -180.0..180.0 }
        if (gps == null && date == null) null
        else doubleArrayOf(gps?.get(0) ?: Double.NaN, gps?.get(1) ?: Double.NaN, date?.toDouble() ?: Double.NaN)
    } catch (e: Exception) {
        null
    }

    private val ISO6709 = Regex("([+-]\\d+(?:\\.\\d+)?)([+-]\\d+(?:\\.\\d+)?)")
    private fun parseIso6709(s: String?): DoubleArray? {
        val m = ISO6709.find(s ?: return null) ?: return null
        return doubleArrayOf(m.groupValues[1].toDouble(), m.groupValues[2].toDouble())
    }

    /** Donne un nom de ville aux zones GPS pas encore nommées (nécessite internet). */
    @Suppress("DEPRECATION")
    suspend fun geocodeMissing(onProgress: (done: Int, total: Int) -> Unit) = withContext(Dispatchers.IO) {
        if (!Geocoder.isPresent()) return@withContext
        val geocoder = Geocoder(ctx, Locale.getDefault())
        val todo = points.values.asSequence().filter { !it[0].isNaN() }
            .map { cluster(it[0], it[1]) }.distinct().filter { !places.containsKey(it) }.toList()
        var fails = 0
        todo.forEachIndexed { i, key ->
            ensureActive()
            val (a, b) = key.split(',').map { it.toInt() }
            val name = try {
                val addr = geocoder.getFromLocation(a * 0.05, b * 0.05, 1)?.firstOrNull()
                fails = 0
                addr?.let {
                    listOfNotNull(it.locality ?: it.subAdminArea ?: it.adminArea, it.countryName)
                        .distinct().joinToString(", ")
                }
            } catch (e: Exception) {
                fails++
                null
            }
            if (!name.isNullOrBlank()) {
                places[key] = name
                runCatching { placesFile.appendText("$key\t${name.replace('\t', ' ')}\n") }
            }
            if (fails >= 3) return@withContext // pas de réseau : on réessaiera au prochain lancement
            if (i % 5 == 4 || i == todo.lastIndex) onProgress(i + 1, todo.size)
        }
    }

    @Suppress("DEPRECATION")
    suspend fun searchPlace(text: String): Triple<String, Double, Double>? = withContext(Dispatchers.IO) {
        if (!Geocoder.isPresent()) return@withContext null
        runCatching {
            Geocoder(ctx, Locale.getDefault()).getFromLocationName(text, 1)?.firstOrNull()?.let {
                val label = it.locality ?: it.featureName ?: text
                Triple(label, it.latitude, it.longitude)
            }
        }.getOrNull()
    }

    companion object {
        fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6371.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
            return 2 * r * asin(sqrt(a))
        }
    }
}
