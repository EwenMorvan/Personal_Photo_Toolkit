package com.ewen.photofinder.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.snapshotFlow
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DriveFolderUpload
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material.icons.rounded.SelectAll
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.ewen.photofinder.CellEntry
import com.ewen.photofinder.DatePreset
import com.ewen.photofinder.GridEntry
import com.ewen.photofinder.HeaderEntry
import com.ewen.photofinder.MainViewModel
import com.ewen.photofinder.Perms
import com.ewen.photofinder.Status
import com.ewen.photofinder.ViewData
import com.ewen.photofinder.data.Exporter
import com.ewen.photofinder.link.LinkService
import com.ewen.photofinder.link.PcLink
import com.ewen.photofinder.data.MediaItem
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.roundToInt

private val NF = NumberFormat.getIntegerInstance(Locale.FRENCH)
fun fmtInt(n: Int): String = NF.format(n)
fun plural(n: Int, one: String, many: String = one + "s"): String = fmtInt(n) + " " + if (n > 1) many else one

@Composable
fun MainScreen(vm: MainViewModel, partialAccess: Boolean, onRequestAll: () -> Unit) {
    val ctx = LocalContext.current
    val data by vm.view.collectAsStateWithLifecycle()
    val filters by vm.filters.collectAsStateWithLifecycle()
    val selection by vm.selection.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val export by vm.export.collectAsStateWithLifecycle()
    val byMonth by vm.groupByMonth.collectAsStateWithLifecycle()
    val deep by vm.deepScan.collectAsStateWithLifecycle()
    val cols by vm.columns.collectAsStateWithLifecycle()

    var showFilters by rememberSaveable { mutableStateOf(false) }
    var showRange by remember { mutableStateOf(false) }
    var showExport by remember { mutableStateOf(false) }
    var viewer by rememberSaveable { mutableStateOf<Int?>(null) }

    val treeLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        uri?.let(vm::exportToFolder)
    }
    val csvLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        uri?.let(vm::exportCsv)
    }
    val inSelection = selection.isNotEmpty()
    BackHandler(enabled = inSelection && viewer == null) { vm.clearSelection() }

    fun share() {
        val items = vm.selectedItems()
        if (items.size > 500) {
            Toast.makeText(ctx, "Trop de fichiers pour un partage (max 500). Utilise « Exporter ».", Toast.LENGTH_LONG).show()
            return
        }
        runCatching { ctx.startActivity(Exporter.shareIntent(ctx, items)) }
    }

    // --- En-tête qui se replie quand on fait défiler vers le bas ---
    val density = LocalDensity.current
    val statusPx = WindowInsets.statusBars.getTop(density)
    var headerPx by remember { mutableIntStateOf(0) }
    var headerOffset by remember { mutableFloatStateOf(0f) }
    val collapse = (headerPx - statusPx).coerceAtLeast(0).toFloat()
    val connection = remember(collapse) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                headerOffset = (headerOffset + available.y).coerceIn(-collapse, 0f)
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(inSelection, filters) { headerOffset = 0f }
    val gridState = rememberLazyGridState()
    LaunchedEffect(filters, byMonth) { gridState.scrollToItem(0) }
    // À l'arrêt du défilement, l'en-tête s'ouvre ou se ferme entièrement (jamais à moitié)
    LaunchedEffect(gridState, collapse) {
        snapshotFlow { gridState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling && collapse > 0f) {
                val nearTop = gridState.firstVisibleItemIndex == 0 && gridState.firstVisibleItemScrollOffset < collapse
                val target = if (nearTop || headerOffset > -collapse / 2) 0f else -collapse
                if (target != headerOffset) animate(headerOffset, target, animationSpec = tween(200)) { v, _ -> headerOffset = v }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(Modifier.fillMaxSize().nestedScroll(connection)) {
            val top = with(density) { headerPx.toDp() } + 4.dp
            if (data.items.isEmpty() && !status.scanning && status.loaded) {
                EmptyState(top, filters.activeCount > 0, vm::resetFilters)
            } else {
                MediaGrid(
                    state = gridState,
                    entries = data.entries,
                    columns = cols,
                    top = top,
                    selection = selection,
                    inSelection = inSelection,
                    onOpen = { viewer = it },
                    onToggle = vm::toggle,
                    onToggleGroup = { keys, sel -> vm.setKeys(keys, sel) },
                    onZoom = vm::zoomGrid,
                )
            }
            FastScroller(
                gridState, data.entries,
                Modifier.align(Alignment.TopEnd).padding(top = with(density) { headerPx.toDp() } + 8.dp, bottom = 110.dp)
            )
        }

        Header(
            modifier = Modifier
                .offset { IntOffset(0, headerOffset.roundToInt()) }
                .onSizeChanged { headerPx = it.height },
            vm = vm, data = data, status = status, inSelection = inSelection, selectionCount = selection.size,
            byMonth = byMonth, deep = deep, partialAccess = partialAccess, onRequestAll = onRequestAll,
            onFilters = { showFilters = true }, onRange = { showRange = true },
            onCsv = { csvLauncher.launch("photos_${vm.defaultExportName()}.csv") },
        )
        // Fond derrière la barre d'état quand l'en-tête est replié
        Box(
            Modifier.fillMaxWidth().height(with(density) { statusPx.toDp() })
                .background(MaterialTheme.colorScheme.background)
        )

        AnimatedVisibility(
            visible = inSelection,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            SelectionBar(
                count = selection.size,
                onExport = { showExport = true },
                onShare = ::share,
                onCsv = { csvLauncher.launch("selection_${vm.defaultExportName()}.csv") },
            )
        }

        if (showFilters) FilterSheet(vm, filters, data.facets, data.items.size, status, onPickRange = { showRange = true }, onDismiss = { showFilters = false })
        if (showRange) RangeDialog(onDismiss = { showRange = false }, onPick = { f, t -> vm.setRange(f, t); showRange = false })
        if (showExport) {
            val layout by vm.exportLayout.collectAsStateWithLifecycle()
            val split by vm.splitVideos.collectAsStateWithLifecycle()
            val lastName = remember { vm.lastTreeName() }
            val selItems = remember(selection) { vm.selectedItems() }
            val pcReq by PcLink.request.collectAsStateWithLifecycle()
            ExportSheet(
                items = selItems,
                pcRequest = pcReq?.takeIf { it.fresh },
                onPc = { showExport = false; pcReq?.let(vm::exportToPc) },
                defaultName = vm.defaultExportName(),
                lastFolder = lastName,
                layout = layout,
                splitVideos = split,
                geo = vm.geo,
                onLayout = vm::setLayout,
                onSplitVideos = vm::setSplitVideos,
                onDismiss = { showExport = false },
                onPhone = { showExport = false; vm.exportToPhone(it) },
                onPickFolder = { showExport = false; treeLauncher.launch(vm.lastTree.value) },
                onLastFolder = { showExport = false; vm.lastTree.value?.let(vm::exportToFolder) },
            )
        }
        export?.let { s ->
            ExportProgressDialog(s, onCancel = vm::cancelExport, onDone = {
                vm.dismissExport()
                if (s.stats != null) vm.clearSelection()
            })
        }

        viewer?.let { idx ->
            if (idx < data.items.size) Viewer(
                items = data.items, start = idx, selection = selection, geo = vm.geo,
                onToggle = vm::toggle,
                onNearby = { vm.nearItem(it); viewer = null },
                onClose = { viewer = null },
            ) else viewer = null
        }
    }
}

// ---------------------------------------------------------------- En-tête

@Composable
private fun Header(
    modifier: Modifier,
    vm: MainViewModel,
    data: ViewData,
    status: Status,
    inSelection: Boolean,
    selectionCount: Int,
    byMonth: Boolean,
    deep: Boolean,
    partialAccess: Boolean,
    onRequestAll: () -> Unit,
    onFilters: () -> Unit,
    onRange: () -> Unit,
    onCsv: () -> Unit,
) {
    val ctx = LocalContext.current
    val filters by vm.filters.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    var about by remember { mutableStateOf(false) }
    if (about) AboutDialog { about = false }
    val cs = MaterialTheme.colorScheme

    Column(modifier.fillMaxWidth().background(cs.background).statusBarsPadding().padding(bottom = 10.dp)) {
        // Titre + actions
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (inSelection) {
                IconButton(onClick = vm::clearSelection, modifier = Modifier.padding(end = 4.dp)) { Icon(Icons.Rounded.Close, "Annuler") }
            }
            Column(Modifier.weight(1f)) {
                if (inSelection) Text(
                    "${fmtInt(selectionCount)} sélectionné${if (selectionCount > 1) "s" else ""}",
                    style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis
                ) else {
                    Text(
                        buildString {
                            append(plural(data.photos, "photo"))
                            if (data.videos > 0) append(" · " + plural(data.videos, "vidéo"))
                        },
                        style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                    val parts = buildList {
                        add(formatSize(data.totalBytes))
                        if (status.geoMessage != null && status.geoTotal > 0) add("lieux ${status.geoDone * 100 / status.geoTotal} %")
                    }
                    Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1)
                }
            }
            if (inSelection) {
                IconButton(onClick = vm::selectAllFiltered) { Icon(Icons.Rounded.SelectAll, "Tout sélectionner") }
            } else {
                IconButton(onClick = vm::selectAllFiltered) { Icon(Icons.Rounded.SelectAll, "Tout sélectionner") }
                IconButton(onClick = { vm.sortDesc.value = !vm.sortDesc.value }) { Icon(Icons.Rounded.SwapVert, "Inverser le tri") }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "Menu") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = RoundedCornerShape(16.dp)) {
                        DropdownMenuItem(text = { Text("Rafraîchir") }, onClick = { menu = false; vm.refresh() })
                        DropdownMenuItem(
                            text = { Text(if (byMonth) "Grouper par jour" else "Grouper par mois") },
                            onClick = { menu = false; vm.setGroupByMonth(!byMonth) })
                        DropdownMenuItem(text = { Text("Vignettes plus grandes") }, onClick = { menu = false; vm.zoomGrid(-1) })
                        DropdownMenuItem(text = { Text("Vignettes plus petites") }, onClick = { menu = false; vm.zoomGrid(1) })
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text("Exporter la liste (CSV)") }, onClick = { menu = false; onCsv() })
                        DropdownMenuItem(text = { Text("À propos et licences") }, onClick = { menu = false; about = true })
                    }
                }
            }
        }

        // Barre de recherche
        SearchPill(
            query = filters.query,
            onQuery = vm::setQuery,
            activeFilters = filters.activeCount - (if (filters.query.isNotBlank()) 1 else 0),
            onFilters = onFilters,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
        )

        // Périodes
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(DatePreset.entries) { p ->
                Pill(
                    selected = filters.preset == p,
                    label = if (p == DatePreset.CUSTOM && filters.preset == p) rangeLabel(filters.from, filters.to) else p.label,
                    onClick = { if (p == DatePreset.CUSTOM) onRange() else vm.setPreset(p) },
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        // Provenances
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(data.facets.sources, key = { it.first }) { (name, n) ->
                Pill(selected = name in filters.sources, label = name, count = n, icon = sourceIcon(name), onClick = { vm.toggleSource(name) })
            }
        }

        PcBanner()

        if (partialAccess) Notice(
            "Accès limité : seules les photos choisies sont visibles.",
            "Tout autoriser", onRequestAll
        )
        if (deep && !Perms.hasAllFiles(ctx)) Notice(
            "Des photos peuvent manquer : autorise « Accès à tous les fichiers » pour tout trouver.",
            "Autoriser"
        ) { runCatching { ctx.startActivity(Perms.allFilesSettingsIntent(ctx)) } }

        if (status.scanning) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 10.dp).height(3.dp).clip(CircleShape)
            )
            status.message?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            }
        }
    }
}

/** Bandeau affiché quand Photo Studio (PC) attend des photos. */
@Composable
private fun PcBanner() {
    val req by PcLink.request.collectAsStateWithLifecycle()
    val r = req ?: return
    // le PC renvoie son signal régulièrement : sans nouvelles, la demande est close
    LaunchedEffect(r) {
        kotlinx.coroutines.delay(46_000)
        if (PcLink.request.value?.fresh == false) PcLink.request.value = null
    }
    if (!r.fresh || r.dismissed) return
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(18.dp), color = cs.primaryContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 10.dp)
    ) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = cs.primary, modifier = Modifier.size(38.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Computer, null, tint = cs.onPrimary, modifier = Modifier.size(20.dp)) }
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text("${r.pc} demande des photos", style = MaterialTheme.typography.titleSmall, color = cs.onPrimaryContainer)
                Text(
                    "Projet « ${r.project} » · sélectionne puis Exporter",
                    style = MaterialTheme.typography.bodySmall, color = cs.onPrimaryContainer.copy(alpha = .8f),
                    maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
            TextButton(onClick = {
                PcLink.dismiss(r)
                LinkService.cancelRequestNotification(ctx)
                kotlin.concurrent.thread { PcLink.decline(ctx.applicationContext, r) }
            }) { Text("Ignorer") }
        }
    }
}

@Composable
private fun SearchPill(query: String, onQuery: (String) -> Unit, activeFilters: Int, onFilters: () -> Unit, modifier: Modifier) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = CircleShape, color = cs.surfaceContainerHigh, modifier = modifier.fillMaxWidth().height(52.dp)) {
        Row(Modifier.padding(start = 16.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Search, null, tint = cs.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) Text("Nom de fichier, dossier…", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                BasicTextField(
                    value = query, onValueChange = onQuery, singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = cs.onSurface),
                    cursorBrush = SolidColor(cs.primary),
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }) { Icon(Icons.Rounded.Close, "Effacer", tint = cs.onSurfaceVariant) }
            Surface(onClick = onFilters, shape = CircleShape, color = if (activeFilters > 0) cs.primary else cs.surfaceContainerHighest) {
                BadgedBox(
                    badge = {},
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Tune, "Filtres", Modifier.size(20.dp), tint = if (activeFilters > 0) cs.onPrimary else cs.onSurface)
                        if (activeFilters > 0) Text(
                            " $activeFilters", color = cs.onPrimary, style = MaterialTheme.typography.labelLarge
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Notice(text: String, action: String, onAction: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 10.dp)
    ) {
        Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Warning, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).padding(horizontal = 10.dp))
            TextButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
private fun EmptyState(top: androidx.compose.ui.unit.Dp, hasFilters: Boolean, onReset: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(top = top).padding(32.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(80.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.SearchOff, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Spacer(Modifier.height(16.dp))
        Text("Aucun résultat", style = MaterialTheme.typography.titleLarge)
        Text("Aucune photo ne correspond à ces filtres.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (hasFilters) {
            Spacer(Modifier.height(16.dp))
            Button(onClick = onReset) { Text("Réinitialiser les filtres") }
        }
    }
}

// ---------------------------------------------------------------- Grille

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MediaGrid(
    state: LazyGridState,
    entries: List<GridEntry>,
    columns: Int,
    top: androidx.compose.ui.unit.Dp,
    selection: Set<String>,
    inSelection: Boolean,
    onOpen: (Int) -> Unit,
    onToggle: (String) -> Unit,
    onToggleGroup: (List<String>, Boolean) -> Unit,
    onZoom: (Int) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
        modifier = Modifier.fillMaxSize().pointerInput(Unit) {
            // Pincer pour changer la taille des vignettes (n'intercepte pas le défilement à un doigt)
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                var zoom = 1f
                do {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    if (event.changes.size >= 2) {
                        zoom *= event.calculateZoom()
                        if (zoom > 1.35f) { onZoom(-1); zoom = 1f }
                        else if (zoom < 0.74f) { onZoom(1); zoom = 1f }
                        event.changes.forEach { it.consume() }
                    }
                } while (event.changes.any { it.pressed })
            }
        },
        contentPadding = PaddingValues(top = top, bottom = 120.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items(
            entries,
            key = { it.id },
            span = { if (it is HeaderEntry) GridItemSpan(maxLineSpan) else GridItemSpan(1) },
            contentType = { if (it is HeaderEntry) 0 else 1 },
        ) { e ->
            when (e) {
                is HeaderEntry -> DayHeader(e, selection, inSelection, onToggleGroup)
                is CellEntry -> {
                    val item = e.item
                    Thumb(
                        item, item.key in selection, inSelection,
                        onClick = { if (inSelection) onToggle(item.key) else onOpen(e.index) },
                        onLong = { onToggle(item.key) }
                    )
                }
            }
        }
    }
}

@Composable
private fun DayHeader(e: HeaderEntry, selection: Set<String>, inSelection: Boolean, onToggleGroup: (List<String>, Boolean) -> Unit) {
    val allSel = inSelection && e.keys.all { it in selection }
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 18.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(e.label, style = MaterialTheme.typography.titleMedium)
            Text("${fmtInt(e.keys.size)} élément${if (e.keys.size > 1) "s" else ""}", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
        }
        IconButton(onClick = { onToggleGroup(e.keys, !allSel) }) {
            Icon(
                if (allSel) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                contentDescription = "Sélectionner ce groupe",
                tint = if (allSel) cs.primary else cs.outline,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Thumb(item: MediaItem, selected: Boolean, inSelection: Boolean, onClick: () -> Unit, onLong: () -> Unit) {
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val req = remember(item.key) { ImageRequest.Builder(ctx).data(thumbModel(item)).size(256).build() }
    val inset by animateDpAsState(if (selected) 10.dp else 0.dp, label = "inset")
    val corner by animateDpAsState(if (selected) 14.dp else 0.dp, label = "corner")
    Box(
        Modifier.aspectRatio(1f)
            .background(if (selected) cs.primaryContainer else Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLong)
    ) {
        AsyncImage(
            model = req, contentDescription = item.name, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().padding(inset).clip(RoundedCornerShape(corner)).background(cs.surfaceContainerHigh)
        )
        if (item.isVideo) Row(
            Modifier.align(Alignment.TopEnd).padding(6.dp)
                .background(Color.Black.copy(alpha = .5f), CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Rounded.PlayArrow, null, tint = Color.White, modifier = Modifier.size(12.dp))
            if (item.durationMs > 0) Text(formatDuration(item.durationMs), color = Color.White, fontSize = 10.sp)
        }
        if (!item.indexed) Icon(
            Icons.Rounded.VisibilityOff, "Caché de la galerie", tint = Color.White,
            modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).size(18.dp)
                .background(Color.Black.copy(alpha = .5f), CircleShape).padding(3.dp)
        )
        if (inSelection) Box(Modifier.align(Alignment.TopStart).padding(6.dp)) {
            if (selected) Icon(
                Icons.Rounded.CheckCircle, null, tint = cs.primary,
                modifier = Modifier.size(24.dp).background(cs.surface, CircleShape)
            ) else Icon(
                Icons.Rounded.RadioButtonUnchecked, null, tint = Color.White,
                modifier = Modifier.size(24.dp).background(Color.Black.copy(alpha = .2f), CircleShape)
            )
        }
    }
}

// ---------------------------------------------------------------- Barre de sélection

@Composable
private fun SelectionBar(count: Int, onExport: () -> Unit, onShare: () -> Unit, onCsv: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shadowElevation = 12.dp,
        modifier = Modifier.navigationBarsPadding().padding(16.dp)
    ) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(onClick = onExport, modifier = Modifier.height(52.dp), contentPadding = PaddingValues(horizontal = 22.dp)) {
                Icon(Icons.Rounded.DriveFolderUpload, null)
                Spacer(Modifier.width(8.dp))
                Text("Exporter ${fmtInt(count)}")
            }
            FilledTonalIconButton(onClick = onShare, modifier = Modifier.size(52.dp)) { Icon(Icons.Rounded.Share, "Partager") }
            FilledTonalIconButton(onClick = onCsv, modifier = Modifier.size(52.dp)) { Icon(Icons.Rounded.Description, "Liste CSV") }
        }
    }
}

// ---------------------------------------------------------------- Plage de dates

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RangeDialog(onDismiss: () -> Unit, onPick: (java.time.LocalDate?, java.time.LocalDate?) -> Unit) {
    val state = rememberDateRangePickerState()
    fun toDate(ms: Long?) = ms?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = state.selectedStartDateMillis != null,
                onClick = {
                    val f = toDate(state.selectedStartDateMillis)
                    onPick(f, toDate(state.selectedEndDateMillis) ?: f)
                }) { Text("Appliquer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    ) {
        DateRangePicker(
            state = state,
            modifier = Modifier.weight(1f),
            title = { Text("Choisir une période", modifier = Modifier.padding(start = 24.dp, top = 16.dp)) },
        )
    }
}

/** Version, licence de l'app et licences des bibliothèques incluses (texte embarqué dans l'APK). */
@Composable
private fun AboutDialog(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val version = remember {
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "?"
    }
    val text = remember { runCatching { ctx.assets.open("licenses.txt").bufferedReader().use { it.readText() } }.getOrDefault("") }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Photo Finder $version") },
        text = {
            Text(
                text, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())
            )
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
    )
}
