package com.ewen.photofinder.data

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Copie des photos/vidéos vers le téléphone ou un dossier choisi (clé USB, carte SD…).
 *
 * Règles :
 *  - les fichiers déjà présents dans le dossier cible (même contenu) sont ignorés ;
 *  - AUCUNE suppression ni écrasement dans un dossier choisi : on ne fait que créer des dossiers et des fichiers.
 */
object Exporter {

    sealed interface Destination {
        data class Phone(val folderName: String) : Destination
        data class Folder(val tree: Uri) : Destination
    }

    data class Progress(val done: Int, val copied: Int, val skipped: Int)
    data class Result(val copied: Int, val skipped: Int, val failed: List<String>, val where: String, val folders: Int)

    suspend fun export(
        ctx: Context,
        dest: Destination,
        items: List<MediaItem>,
        layout: ExportLayout,
        splitVideos: Boolean,
        geo: GeoIndex,
        progress: (Progress) -> Unit,
    ): Result = withContext(Dispatchers.IO) {
        val target: Target = when (dest) {
            is Destination.Folder -> SafTarget(ctx, dest.tree)
            is Destination.Phone -> {
                val base = "${Environment.DIRECTORY_PICTURES}/PhotoFinder/${ExportLayout.safeName(dest.folderName)}/"
                if (Build.VERSION.SDK_INT >= 29) PhoneTarget(ctx, base) else FileTarget(ctx, File(Environment.getExternalStorageDirectory(), base))
            }
        }
        var copied = 0
        var skipped = 0
        val failed = ArrayList<String>()
        items.forEachIndexed { i, item ->
            ensureActive()
            try {
                val segs = layout.segments(item, geo).let { if (splitVideos && item.isVideo) it + "Vidéos" else it }
                val dir = target.dir(segs)
                val size = realSize(ctx, item)
                if (isDuplicate(ctx, item, size, dir)) skipped++
                else {
                    dir.files += dir.write(item, size)
                    copied++
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                failed += "${item.name} : ${e.message ?: e.javaClass.simpleName}"
            }
            progress(Progress(i + 1, copied, skipped))
        }
        Result(copied, skipped, failed, target.label, target.createdFolders)
    }

    // ---------- Détection des doublons ----------

    private class Existing(val name: String, val size: Long, val uri: Uri) {
        var head: ByteArray? = null
    }

    private const val HEAD = 256 * 1024

    private fun readHead(ctx: Context, uri: Uri): ByteArray? = try {
        ctx.contentResolver.openInputStream(uri)?.use { inp ->
            val buf = ByteArray(HEAD)
            var n = 0
            while (n < HEAD) {
                val r = inp.read(buf, n, HEAD - n)
                if (r < 0) break
                n += r
            }
            buf.copyOf(n)
        }
    } catch (e: Exception) {
        null
    }

    private fun realSize(ctx: Context, item: MediaItem): Long {
        if (item.size > 0) return item.size
        return runCatching { ctx.contentResolver.openFileDescriptor(item.uri, "r")?.use { it.statSize } }.getOrNull() ?: -1L
    }

    /** Doublon = un fichier de même taille, avec le même nom ou le même début de contenu. */
    private fun isDuplicate(ctx: Context, item: MediaItem, size: Long, dir: Dir): Boolean {
        if (size <= 0) return dir.files.any { it.name.equals(item.name, true) }
        val candidates = dir.files.filter { it.size == size }
        if (candidates.isEmpty()) return false
        if (candidates.any { it.name.equals(item.name, true) }) return true
        val mine = readHead(ctx, item.uri) ?: return false
        return candidates.any { c ->
            val h = c.head ?: readHead(ctx, c.uri)?.also { c.head = it }
            h != null && h.contentEquals(mine)
        }
    }

    private fun copyStream(ctx: Context, from: Uri, to: Uri) {
        val r = ctx.contentResolver
        (r.openInputStream(from) ?: throw IOException("lecture impossible")).use { inp ->
            (r.openOutputStream(to, "w") ?: throw IOException("écriture impossible")).use { out -> inp.copyTo(out, 1 shl 16) }
        }
    }

    // ---------- Cibles ----------

    private abstract class Dir {
        val files = ArrayList<Existing>()
        abstract fun write(item: MediaItem, size: Long): Existing
    }

    private abstract class Target {
        abstract val label: String
        var createdFolders = 0
        abstract fun dir(segs: List<String>): Dir
    }

    /** Dossier choisi par l'utilisateur (Storage Access Framework : clé USB, SD, Drive…). Jamais de suppression. */
    private class SafTarget(val ctx: Context, val tree: Uri) : Target() {
        private val resolver = ctx.contentResolver
        private val dirs = HashMap<String, SafDir>()
        private val root: SafDir
        override val label: String

        init {
            val rootId = DocumentsContract.getTreeDocumentId(tree)
            root = SafDir(rootId)
            dirs[""] = root
            label = queryName(DocumentsContract.buildDocumentUriUsingTree(tree, rootId)) ?: "dossier choisi"
        }

        override fun dir(segs: List<String>): Dir {
            var cur = root
            var key = ""
            for (s in segs) {
                key += "/" + s.lowercase()
                val parent = cur
                cur = dirs.getOrPut(key) { parent.child(s) }
            }
            return cur
        }

        private fun queryName(uri: Uri): String? = runCatching {
            resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }
        }.getOrNull()

        inner class SafDir(val docId: String) : Dir() {
            private val uri = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            private val subdirs = HashMap<String, String>() // nom en minuscules -> docId

            init {
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
                resolver.query(
                    children,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                        DocumentsContract.Document.COLUMN_SIZE,
                    ), null, null, null
                )?.use { c ->
                    while (c.moveToNext()) {
                        val id = c.getString(0) ?: continue
                        val name = c.getString(1) ?: continue
                        if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) subdirs[name.lowercase()] = id
                        else files += Existing(name, if (c.isNull(3)) -1 else c.getLong(3), DocumentsContract.buildDocumentUriUsingTree(tree, id))
                    }
                }
            }

            fun child(name: String): SafDir {
                subdirs[name.lowercase()]?.let { return SafDir(it) } // dossier existant : on le réutilise
                val created = DocumentsContract.createDocument(resolver, uri, DocumentsContract.Document.MIME_TYPE_DIR, name)
                    ?: throw IOException("impossible de créer le dossier « $name »")
                createdFolders++
                val id = DocumentsContract.getDocumentId(created)
                subdirs[name.lowercase()] = id
                return SafDir(id)
            }

            override fun write(item: MediaItem, size: Long): Existing {
                // createDocument ne remplace jamais un fichier existant : en cas de nom déjà pris il ajoute « (1) ».
                val doc = DocumentsContract.createDocument(resolver, uri, item.mime, item.name)
                    ?: throw IOException("création du fichier refusée")
                copyStream(ctx, item.uri, doc)
                return Existing(queryName(doc) ?: item.name, size, doc)
            }
        }
    }

    /** Pictures/PhotoFinder/<nom>/… dans le téléphone (Android 10+). */
    private class PhoneTarget(val ctx: Context, val base: String) : Target() {
        override val label = base.trimEnd('/')
        private val existing = HashMap<String, MutableList<Existing>>() // relative_path en minuscules
        private val dirs = HashMap<String, Dir>()

        init {
            for (collection in listOf(
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
            )) {
                ctx.contentResolver.query(
                    collection,
                    arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.RELATIVE_PATH),
                    "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?", arrayOf("$base%"), null
                )?.use { c ->
                    while (c.moveToNext()) {
                        val rel = (c.getString(3) ?: continue).lowercase()
                        existing.getOrPut(rel) { ArrayList() } +=
                            Existing(c.getString(1) ?: "", c.getLong(2), android.content.ContentUris.withAppendedId(collection, c.getLong(0)))
                    }
                }
            }
        }

        override fun dir(segs: List<String>): Dir {
            val rel = base + segs.joinToString("") { "$it/" }
            return dirs.getOrPut(rel.lowercase()) {
                object : Dir() {
                    init { existing[rel.lowercase()]?.let { files += it } }
                    override fun write(item: MediaItem, size: Long): Existing {
                        val resolver = ctx.contentResolver
                        val collection = if (item.isVideo) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        val values = ContentValues().apply {
                            put(MediaStore.MediaColumns.DISPLAY_NAME, item.name)
                            put(MediaStore.MediaColumns.MIME_TYPE, item.mime)
                            put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
                            put(MediaStore.MediaColumns.DATE_TAKEN, item.dateMs)
                            put(MediaStore.MediaColumns.IS_PENDING, 1)
                        }
                        val dest = resolver.insert(collection, values) ?: throw IOException("création refusée")
                        try {
                            copyStream(ctx, item.uri, dest)
                            resolver.update(dest, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                        } catch (e: Exception) {
                            // uniquement l'entrée incomplète que l'on vient de créer dans le téléphone
                            runCatching { resolver.delete(dest, null, null) }
                            throw e
                        }
                        return Existing(item.name, size, dest)
                    }
                }
            }
        }
    }

    /** Android 8–9 : écriture directe dans Pictures/PhotoFinder. */
    private class FileTarget(val ctx: Context, val base: File) : Target() {
        override val label = base.absolutePath
        private val dirs = HashMap<String, Dir>()

        override fun dir(segs: List<String>): Dir {
            val d = segs.fold(base) { f, s -> File(f, s) }
            return dirs.getOrPut(d.absolutePath.lowercase()) {
                if (!d.exists()) { d.mkdirs(); createdFolders++ }
                object : Dir() {
                    init { d.listFiles()?.filter { it.isFile }?.forEach { files += Existing(it.name, it.length(), Uri.fromFile(it)) } }
                    override fun write(item: MediaItem, size: Long): Existing {
                        var f = File(d, item.name)
                        var n = 1
                        while (f.exists()) f = File(d, "${item.name.substringBeforeLast('.')} (${n++})." + item.name.substringAfterLast('.', "jpg"))
                        ctx.contentResolver.openInputStream(item.uri)!!.use { inp -> f.outputStream().use { inp.copyTo(it, 1 shl 16) } }
                        f.setLastModified(item.dateMs)
                        MediaScannerConnection.scanFile(ctx, arrayOf(f.absolutePath), null, null)
                        return Existing(f.name, size, Uri.fromFile(f))
                    }
                }
            }
        }
    }

    // ---------- Partage / ouverture / CSV ----------

    fun shareUri(ctx: Context, item: MediaItem): Uri =
        if (item.indexed) item.uri
        else FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", File(item.path))

    fun shareIntent(ctx: Context, items: List<MediaItem>): Intent {
        val uris = ArrayList(items.map { shareUri(ctx, it) })
        val mime = when {
            items.all { !it.isVideo } -> "image/*"
            items.all { it.isVideo } -> "video/*"
            else -> "*/*"
        }
        val send = Intent(if (uris.size == 1) Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).apply {
            type = mime
            if (uris.size == 1) putExtra(Intent.EXTRA_STREAM, uris[0])
            else putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            clipData = ClipData.newRawUri("", uris[0]).also { cd -> uris.drop(1).forEach { cd.addItem(ClipData.Item(it)) } }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(send, "Partager ${items.size} fichier(s)")
    }

    fun viewIntent(ctx: Context, item: MediaItem): Intent =
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(shareUri(ctx, item), item.mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    /** Liste CSV (ouvrable dans Excel) de tous les chemins. */
    suspend fun writeCsv(ctx: Context, uri: Uri, items: List<MediaItem>, geo: GeoIndex) = withContext(Dispatchers.IO) {
        val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        fun q(s: String) = "\"" + s.replace("\"", "\"\"") + "\""
        ctx.contentResolver.openOutputStream(uri)!!.bufferedWriter().use { w ->
            w.write("﻿")
            w.write("Date;Nom;Type;Provenance;Dossier;Chemin complet;Taille (octets);Latitude;Longitude;Lieu;Caché de la galerie\n")
            for (it in items) {
                val p = geo.point(it)
                val date = Instant.ofEpochMilli(it.dateMs).atZone(ZoneId.systemDefault()).format(fmt)
                w.write(
                    listOf(
                        date, q(it.name), if (it.isVideo) "vidéo" else "photo", q(it.source), q(it.folder), q(it.path),
                        it.size.toString(), p?.get(0)?.toString() ?: "", p?.get(1)?.toString() ?: "",
                        q(geo.placeName(it) ?: ""), if (it.indexed) "non" else "oui"
                    ).joinToString(";")
                )
                w.write("\n")
            }
        }
    }
}
