package com.ewen.photofinder

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ewen.photofinder.data.ExportLayout
import com.ewen.photofinder.data.Exporter
import com.ewen.photofinder.data.GeoIndex
import com.ewen.photofinder.data.MediaItem
import com.ewen.photofinder.data.MediaScanner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class DatePreset(val label: String) {
    ALL("Tout"), TODAY("Aujourd'hui"), LAST7("7 derniers jours"), THIS_MONTH("Ce mois-ci"),
    LAST_MONTH("Mois dernier"), LAST3M("3 derniers mois"), THIS_YEAR("Cette année"),
    LAST_YEAR("L'année dernière"), CUSTOM("Période…");

    fun range(today: LocalDate): Pair<LocalDate?, LocalDate?> = when (this) {
        ALL, CUSTOM -> null to null
        TODAY -> today to today
        LAST7 -> today.minusDays(6) to today
        THIS_MONTH -> today.withDayOfMonth(1) to null
        LAST_MONTH -> today.minusMonths(1).withDayOfMonth(1).let { it to it.plusMonths(1).minusDays(1) }
        LAST3M -> today.minusMonths(3) to null
        THIS_YEAR -> today.withDayOfYear(1) to null
        LAST_YEAR -> today.minusYears(1).withDayOfYear(1).let { it to it.plusYears(1).minusDays(1) }
    }
}

enum class GpsFilter { ALL, WITH, WITHOUT }

data class NearFilter(val label: String, val lat: Double, val lon: Double, val km: Float)

data class Filters(
    val preset: DatePreset = DatePreset.ALL,
    val from: LocalDate? = null,
    val to: LocalDate? = null,
    val photos: Boolean = true,
    val videos: Boolean = true,
    val sources: Set<String> = emptySet(),
    val folders: Set<String> = emptySet(),
    val places: Set<String> = emptySet(),
    val gps: GpsFilter = GpsFilter.ALL,
    val near: NearFilter? = null,
    val onlyHidden: Boolean = false,
    val query: String = "",
) {
    val activeCount: Int
        get() = listOf(
            from != null || to != null, !photos || !videos, sources.isNotEmpty(), folders.isNotEmpty(),
            places.isNotEmpty(), gps != GpsFilter.ALL, near != null, onlyHidden, query.isNotBlank()
        ).count { it }
}

data class Status(
    val loaded: Boolean = false,
    val scanning: Boolean = false,
    val message: String? = null,
    val geoMessage: String? = null,
    val geoDone: Int = 0,
    val geoTotal: Int = 0,
)

data class ExportState(
    val title: String,
    val done: Int,
    val total: Int,
    val result: String? = null,
    val detail: String? = null,
    val stats: Exporter.Result? = null,
) {
    val finished get() = result != null || stats != null
}

data class Facets(
    val sources: List<Pair<String, Int>> = emptyList(),
    val folders: List<Pair<String, Int>> = emptyList(),
    val places: List<Pair<String, Int>> = emptyList(),
    val withGps: Int = 0,
    val withoutGps: Int = 0,
    val hidden: Int = 0,
)

sealed interface GridEntry { val id: String }
data class HeaderEntry(override val id: String, val label: String, val keys: List<String>) : GridEntry
data class CellEntry(val item: MediaItem, val index: Int) : GridEntry {
    override val id: String get() = item.key
}

data class ViewData(
    val items: List<MediaItem> = emptyList(),
    val entries: List<GridEntry> = emptyList(),
    val facets: Facets = Facets(),
    val total: Int = 0,
    val totalBytes: Long = 0,
    val photos: Int = 0,
    val videos: Int = 0,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx get() = getApplication<Application>()
    private val prefs = app.getSharedPreferences("settings", 0)

    val geo = GeoIndex(app)
    private val all = MutableStateFlow<List<MediaItem>>(emptyList())
    private val geoTick = MutableStateFlow(0)

    val filters = MutableStateFlow(Filters())
    val sortDesc = MutableStateFlow(true)
    val groupByMonth = MutableStateFlow(prefs.getBoolean("byMonth", false))
    /** Scan approfondi toujours actif (dès que l'accès à tous les fichiers est autorisé). */
    val deepScan = MutableStateFlow(true)
    val selection = MutableStateFlow<Set<String>>(emptySet())
    val status = MutableStateFlow(Status())
    val export = MutableStateFlow<ExportState?>(null)

    private var loadJob: Job? = null
    private var exportJob: Job? = null
    private var lastAllFiles: Boolean? = null

    val view: StateFlow<ViewData> =
        combine(all, filters, sortDesc, groupByMonth, geoTick) { a, f, desc, byMonth, _ -> compute(a, f, desc, byMonth) }
            .flowOn(Dispatchers.Default)
            .stateIn(viewModelScope, SharingStarted.Eagerly, ViewData())

    // ---------- Chargement ----------

    fun onResume() {
        if (!Perms.hasMedia(ctx)) return
        val af = Perms.hasAllFiles(ctx)
        val changed = lastAllFiles != null && lastAllFiles != af && deepScan.value
        lastAllFiles = af
        if ((!status.value.loaded && loadJob?.isActive != true) || changed) refresh()
    }

    fun refresh() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            status.update { it.copy(scanning = true, message = "Lecture de la galerie…") }
            withContext(Dispatchers.IO) { geo.load() }
            val indexed = withContext(Dispatchers.IO) { applyExifDates(MediaScanner.queryMediaStore(ctx)) }
            all.value = indexed
            status.update { it.copy(loaded = true) }

            if (deepScan.value && Perms.hasAllFiles(ctx)) {
                status.update { it.copy(message = "Scan approfondi des dossiers…") }
                val known = indexed.mapTo(HashSet(indexed.size * 2)) { it.path }
                val extra = withContext(Dispatchers.IO) {
                    MediaScanner.deepScan(ctx, known) { dirs, found ->
                        status.update { it.copy(message = "Scan approfondi : $dirs dossiers, $found fichiers cachés") }
                    }
                }
                all.value = indexed + extra
            }
            status.update { it.copy(scanning = false, message = null) }

            // GPS en arrière-plan
            val items = all.value
            var lastTick = 0
            geo.indexPoints(items, Perms.hasMediaLocation(ctx)) { done, total ->
                status.update { it.copy(geoMessage = "Lecture des positions GPS", geoDone = done, geoTotal = total) }
                if (done - lastTick >= 512 || done == total) { lastTick = done; geoTick.update { it + 1 } }
            }
            all.value = applyExifDates(all.value)
            geo.geocodeMissing { done, total ->
                status.update { it.copy(geoMessage = "Recherche des noms de lieux", geoDone = done, geoTotal = total) }
                geoTick.update { it + 1 }
            }
            status.update { it.copy(geoMessage = null, geoDone = 0, geoTotal = 0) }
            geoTick.update { it + 1 }
        }
    }

    /** Si l'index Android n'a pas de date de prise de vue, on utilise celle lue dans l'EXIF. */
    private fun applyExifDates(items: List<MediaItem>): List<MediaItem> = items.map { m ->
        if (m.hasTakenDate) m
        else geo.exifDate(m)?.let { d -> m.copy(dateMs = d, day = MediaScanner.toDay(d), hasTakenDate = true) } ?: m
    }

    fun setDeepScan(on: Boolean) {
        deepScan.value = on
        prefs.edit().putBoolean("deep", on).apply()
        refresh()
    }

    fun setGroupByMonth(on: Boolean) {
        groupByMonth.value = on
        prefs.edit().putBoolean("byMonth", on).apply()
    }

    // ---------- Filtres ----------

    fun setPreset(p: DatePreset) {
        val (from, to) = p.range(LocalDate.now())
        filters.update { it.copy(preset = p, from = from, to = to) }
    }

    fun setRange(from: LocalDate?, to: LocalDate?) =
        filters.update { it.copy(preset = if (from == null && to == null) DatePreset.ALL else DatePreset.CUSTOM, from = from, to = to) }

    fun toggleSource(s: String) = filters.update { it.copy(sources = it.sources.toggle(s)) }
    fun toggleFolder(s: String) = filters.update { it.copy(folders = it.folders.toggle(s)) }
    fun togglePlace(s: String) = filters.update { it.copy(places = it.places.toggle(s)) }
    fun setPhotos(on: Boolean) = filters.update { it.copy(photos = on) }
    fun setVideos(on: Boolean) = filters.update { it.copy(videos = on) }
    fun setGps(g: GpsFilter) = filters.update { it.copy(gps = g) }
    fun setOnlyHidden(on: Boolean) = filters.update { it.copy(onlyHidden = on) }
    fun setQuery(q: String) = filters.update { it.copy(query = q) }
    fun setNear(n: NearFilter?) = filters.update { it.copy(near = n) }
    fun setNearKm(km: Float) = filters.update { f -> f.copy(near = f.near?.copy(km = km)) }
    fun resetFilters() { filters.value = Filters() }

    fun searchPlace(text: String, km: Float, onError: (String) -> Unit) = viewModelScope.launch {
        val r = geo.searchPlace(text)
        if (r == null) onError("Lieu introuvable (connexion internet nécessaire)")
        else setNear(NearFilter(r.first, r.second, r.third, km))
    }

    fun nearItem(item: MediaItem) {
        val p = geo.point(item) ?: return
        setNear(NearFilter(geo.placeName(p[0], p[1]), p[0], p[1], 5f))
    }

    private fun <T> Set<T>.toggle(v: T) = if (v in this) this - v else this + v

    private fun baseMatch(m: MediaItem, f: Filters, q: String): Boolean {
        if (m.isVideo && !f.videos) return false
        if (!m.isVideo && !f.photos) return false
        if (f.from != null && m.day.isBefore(f.from)) return false
        if (f.to != null && m.day.isAfter(f.to)) return false
        if (f.onlyHidden && m.indexed) return false
        if (q.isNotEmpty() && !m.name.contains(q, true) && !m.folder.contains(q, true)) return false
        return true
    }

    private fun facetMatch(m: MediaItem, f: Filters): Boolean {
        if (f.sources.isNotEmpty() && m.source !in f.sources) return false
        if (f.folders.isNotEmpty() && m.folder !in f.folders) return false
        if (f.gps != GpsFilter.ALL || f.places.isNotEmpty() || f.near != null) {
            val p = geo.point(m)
            if (f.gps == GpsFilter.WITH && p == null) return false
            if (f.gps == GpsFilter.WITHOUT && p != null) return false
            if (f.places.isNotEmpty() && (p == null || geo.placeName(p[0], p[1]) !in f.places)) return false
            val n = f.near
            if (n != null && (p == null || GeoIndex.distanceKm(n.lat, n.lon, p[0], p[1]) > n.km)) return false
        }
        return true
    }

    private val dayFmt = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.FRENCH)
    private val dayFmtThisYear = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.FRENCH)
    private val monthFmt = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.FRENCH)

    private fun dayLabel(d: LocalDate): String {
        val today = LocalDate.now()
        return when (d) {
            today -> "Aujourd'hui"
            today.minusDays(1) -> "Hier"
            else -> d.format(if (d.year == today.year) dayFmtThisYear else dayFmt)
        }
    }

    val columns = MutableStateFlow(prefs.getInt("cols", 4))
    fun zoomGrid(delta: Int) {
        val n = (columns.value + delta).coerceIn(2, 7)
        if (n != columns.value) { columns.value = n; prefs.edit().putInt("cols", n).apply() }
    }

    private fun compute(a: List<MediaItem>, f: Filters, desc: Boolean, byMonth: Boolean): ViewData {
        val q = f.query.trim()
        val base = a.filter { baseMatch(it, f, q) }
        val list = base.filter { facetMatch(it, f) }
            .let { l -> if (desc) l.sortedByDescending { it.dateMs } else l.sortedBy { it.dateMs } }

        val entries = ArrayList<GridEntry>(list.size + 64)
        var idx = 0
        list.groupBy { if (byMonth) YearMonth.from(it.day) else it.day }.forEach { (k, items) ->
            val label = when (k) {
                is LocalDate -> dayLabel(k)
                is YearMonth -> k.format(monthFmt)
                else -> k.toString()
            }.replaceFirstChar { it.titlecase(Locale.FRENCH) }
            entries += HeaderEntry("h:$k", label, items.map { it.key })
            items.forEach { entries += CellEntry(it, idx++) }
        }

        val places = HashMap<String, Int>()
        var withGps = 0
        for (m in base) {
            val p = geo.point(m) ?: continue
            withGps++
            places.merge(geo.placeName(p[0], p[1]), 1, Int::plus)
        }
        val facets = Facets(
            sources = base.groupingBy { it.source }.eachCount().toList().sortedByDescending { it.second },
            folders = base.groupingBy { it.folder }.eachCount().toList().sortedByDescending { it.second },
            places = places.toList().sortedByDescending { it.second },
            withGps = withGps,
            withoutGps = base.size - withGps,
            hidden = a.count { !it.indexed },
        )
        val videos = list.count { it.isVideo }
        return ViewData(list, entries, facets, a.size, list.sumOf { it.size.coerceAtLeast(0) }, list.size - videos, videos)
    }

    // ---------- Sélection ----------

    fun toggle(key: String) = selection.update { if (key in it) it - key else it + key }
    fun setKeys(keys: Collection<String>, selected: Boolean) =
        selection.update { if (selected) it + keys else it - keys.toSet() }
    fun selectAllFiltered() = selection.update { it + view.value.items.map { m -> m.key } }
    fun clearSelection() { selection.value = emptySet() }

    fun selectedItems(): List<MediaItem> {
        val sel = selection.value
        return all.value.filter { it.key in sel }.sortedBy { it.dateMs }
    }

    // ---------- Export ----------

    fun defaultExportName(): String =
        "Export_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HH'h'mm"))

    val exportLayout = MutableStateFlow(
        runCatching { ExportLayout.valueOf(prefs.getString("layout", null) ?: "") }.getOrDefault(ExportLayout.FLAT)
    )
    val splitVideos = MutableStateFlow(prefs.getBoolean("splitVideos", false))
    val lastTree = MutableStateFlow(prefs.getString("lastTree", null)?.let(Uri::parse))

    fun setLayout(l: ExportLayout) { exportLayout.value = l; prefs.edit().putString("layout", l.name).apply() }
    fun setSplitVideos(on: Boolean) { splitVideos.value = on; prefs.edit().putBoolean("splitVideos", on).apply() }

    /** Nom du dernier dossier choisi s'il est toujours accessible (clé USB encore branchée). */
    fun lastTreeName(): String? {
        val uri = lastTree.value ?: return null
        if (ctx.contentResolver.persistedUriPermissions.none { it.uri == uri && it.isWritePermission }) return null
        return runCatching {
            val d = androidx.documentfile.provider.DocumentFile.fromTreeUri(ctx, uri)
            if (d != null && d.exists() && d.canWrite()) d.name else null
        }.getOrNull()
    }

    fun exportToPhone(folderName: String) {
        val name = folderName.ifBlank { defaultExportName() }
        runExport(Exporter.Destination.Phone(name),
            "Sur le PC : branche le téléphone en USB (« Transfert de fichiers ») › Pictures › PhotoFinder.")
    }

    fun exportToFolder(tree: Uri) {
        runCatching {
            ctx.contentResolver.takePersistableUriPermission(
                tree, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        }
        lastTree.value = tree
        prefs.edit().putString("lastTree", tree.toString()).apply()
        runExport(Exporter.Destination.Folder(tree), null)
    }

    fun sampleSelected(): MediaItem? = selectedItems().lastOrNull()

    /** Envoi direct dans le projet Photo Studio qui a fait la demande. */
    fun exportToPc(req: com.ewen.photofinder.link.PcRequest) {
        val items = selectedItems()
        if (items.isEmpty()) return
        exportJob = viewModelScope.launch {
            export.value = ExportState("Envoi vers ${req.pc}", 0, items.size)
            try {
                val r = com.ewen.photofinder.link.PcLink.send(ctx, req, items) { p ->
                    export.update { it?.copy(done = p.done, detail = "${p.copied} envoyés · ${p.skipped} déjà sur le PC") }
                }
                export.update { it?.copy(done = items.size, stats = r, result = "Les photos apparaissent dans le projet « ${req.project} » de Photo Studio.") }
            } catch (e: kotlinx.coroutines.CancellationException) {
                export.value = null
                throw e
            } catch (e: Exception) {
                export.update { it?.copy(done = items.size, result = "Erreur : ${e.message}") }
            }
        }
    }

    fun exportCsv(uri: Uri) {
        viewModelScope.launch {
            val items = if (selection.value.isNotEmpty()) selectedItems() else view.value.items
            export.value = ExportState("Export de la liste", 0, items.size)
            val msg = runCatching { Exporter.writeCsv(ctx, uri, items, geo) }
                .fold({ "Liste de ${items.size} fichier(s) enregistrée." }, { "Erreur : ${it.message}" })
            export.value = ExportState("Export de la liste", items.size, items.size, msg)
        }
    }

    private fun runExport(dest: Exporter.Destination, hint: String?) {
        val items = selectedItems()
        if (items.isEmpty()) return
        val layout = exportLayout.value
        val split = splitVideos.value
        exportJob = viewModelScope.launch {
            export.value = ExportState("Copie en cours", 0, items.size)
            try {
                val r = Exporter.export(ctx, dest, items, layout, split, geo) { p ->
                    export.update { it?.copy(done = p.done, detail = "${p.copied} copiés · ${p.skipped} déjà présents") }
                }
                export.update { it?.copy(done = items.size, stats = r, result = hint) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                export.value = null
                throw e
            } catch (e: Exception) {
                export.update { it?.copy(done = items.size, result = "Erreur : ${e.message}") }
            }
        }
    }

    fun cancelExport() { exportJob?.cancel(); export.value = null }
    fun dismissExport() { export.value = null }
}
