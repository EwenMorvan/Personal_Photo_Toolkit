package com.ewen.photofinder.ui

import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.util.Size
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.key.Keyer
import coil3.request.Options
import com.ewen.photofinder.data.MediaItem
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext

/**
 * Miniature servie par le cache de miniatures d'Android (celui de la galerie) :
 * pas besoin de lire / décoder la photo originale → défilement fluide.
 */
data class Thumb(val uri: Uri, val px: Int)

/** Modèle Coil à utiliser pour une miniature de la grille. */
fun thumbModel(item: MediaItem, px: Int = 256): Any =
    if (item.indexed && Build.VERSION.SDK_INT >= 29) Thumb(item.uri, px) else item.uri

class ThumbKeyer : Keyer<Thumb> {
    override fun key(data: Thumb, options: Options): String = "thumb:${data.uri}:${data.px}"
}

class ThumbFetcher(private val data: Thumb, private val options: Options) : Fetcher {
    override suspend fun fetch(): FetchResult {
        if (Build.VERSION.SDK_INT < 29) error("API 29+")
        val signal = CancellationSignal()
        val handle = currentCoroutineContext()[Job]?.invokeOnCompletion { if (it != null) signal.cancel() }
        try {
            val bmp = options.context.contentResolver.loadThumbnail(data.uri, Size(data.px, data.px), signal)
            return ImageFetchResult(image = bmp.asImage(), isSampled = true, dataSource = DataSource.DISK)
        } finally {
            handle?.dispose()
        }
    }

    class Factory : Fetcher.Factory<Thumb> {
        override fun create(data: Thumb, options: Options, imageLoader: ImageLoader): Fetcher = ThumbFetcher(data, options)
    }
}
