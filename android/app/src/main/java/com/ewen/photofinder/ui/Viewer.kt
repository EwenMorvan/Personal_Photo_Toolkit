package com.ewen.photofinder.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Photo
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.ewen.photofinder.data.Exporter
import com.ewen.photofinder.data.GeoIndex
import com.ewen.photofinder.data.MediaItem

@Composable
fun Viewer(
    items: List<MediaItem>,
    start: Int,
    selection: Set<String>,
    geo: GeoIndex,
    onToggle: (String) -> Unit,
    onNearby: (MediaItem) -> Unit,
    onClose: () -> Unit,
) {
    val ctx = LocalContext.current
    BackHandler(onBack = onClose)
    val pager = rememberPagerState(initialPage = start.coerceIn(0, (items.size - 1).coerceAtLeast(0))) { items.size }
    var chrome by remember { mutableStateOf(true) }
    var info by remember { mutableStateOf(false) }
    var zoomed by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        HorizontalPager(
            state = pager, modifier = Modifier.fillMaxSize(), key = { items[it].key },
            userScrollEnabled = !zoomed, beyondViewportPageCount = 1,
        ) { page ->
            val item = items[page]
            ZoomableImage(
                model = item.uri,
                active = page == pager.currentPage,
                onTap = { chrome = !chrome },
                onZoomed = { zoomed = it },
            )
            if (item.isVideo) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Surface(
                    onClick = { runCatching { ctx.startActivity(Exporter.viewIntent(ctx, item)) } },
                    shape = CircleShape, color = Color.Black.copy(alpha = .45f), modifier = Modifier.size(76.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.PlayArrow, "Lire", tint = Color.White, modifier = Modifier.size(44.dp)) }
                }
            }
        }

        val cur = items.getOrNull(pager.currentPage) ?: return@Box
        val selected = cur.key in selection
        val place = geo.placeName(cur)

        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .7f), Color.Transparent)))
                    .statusBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Retour", tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    Text(formatDateTime(cur.dateMs), color = Color.White, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${pager.currentPage + 1} sur ${items.size}", color = Color.White.copy(alpha = .7f), style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { onToggle(cur.key) }) {
                    Icon(
                        if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                        if (selected) "Désélectionner" else "Sélectionner",
                        tint = if (selected) MaterialTheme.colorScheme.primary else Color.White
                    )
                }
            }
        }

        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter)) {
            Column(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .8f))))
                    .navigationBarsPadding().padding(horizontal = 16.dp).padding(top = 40.dp, bottom = 10.dp)
            ) {
                if (info) Surface(shape = RoundedCornerShape(20.dp), color = Color(0xFF1C1D22), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        InfoRow(Icons.Rounded.Photo, cur.name, buildString {
                            append(formatSize(cur.size))
                            if (cur.width > 0) append(" · ${cur.width}×${cur.height}")
                            if (!cur.indexed) append(" · caché de la galerie")
                        })
                        InfoRow(Icons.Rounded.CalendarMonth, formatDateTime(cur.dateMs), if (cur.hasTakenDate) "Date de prise de vue" else "Date du fichier")
                        InfoRow(sourceIcon(cur.source), cur.source, cur.path, Icons.Rounded.Folder)
                        if (place != null) InfoRow(Icons.Rounded.Place, place, null)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    ViewerAction(Icons.Rounded.Share, "Partager") { runCatching { ctx.startActivity(Exporter.shareIntent(ctx, listOf(cur))) } }
                    ViewerAction(Icons.Rounded.Info, if (info) "Masquer" else "Infos") { info = !info }
                    if (geo.point(cur) != null) ViewerAction(Icons.Rounded.NearMe, "Autour") { onNearby(cur) }
                    ViewerAction(
                        if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                        if (selected) "Choisie" else "Choisir"
                    ) { onToggle(cur.key) }
                }
            }
        }
    }
}

@Composable
private fun ViewerAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = Color.White)
            Spacer(Modifier.height(4.dp))
            Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun InfoRow(icon: ImageVector, title: String, sub: String?, @Suppress("UNUSED_PARAMETER") subIcon: ImageVector? = null) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = Color.White.copy(alpha = .7f), modifier = Modifier.size(20.dp))
        Column(Modifier.padding(start = 14.dp)) {
            Text(title, color = Color.White, style = MaterialTheme.typography.bodyMedium)
            if (sub != null) Text(sub, color = Color.White.copy(alpha = .6f), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Image zoomable : pincer, double-tap, déplacement. Un doigt sans zoom = swipe du pager. */
@Composable
private fun ZoomableImage(model: Any, active: Boolean, onTap: () -> Unit, onZoomed: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var hiRes by remember { mutableStateOf(false) }
    LaunchedEffect(active) { if (!active) { scale = 1f; offset = Offset.Zero } }
    val zoomedIn = scale > 1.15f
    LaunchedEffect(zoomedIn) { if (zoomedIn) hiRes = true }
    // Version haute définition chargée seulement quand on zoome (net même à x6)
    val hiRequest = remember(model) { ImageRequest.Builder(ctx).data(model).size(4096).build() }

    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { p ->
                        if (scale > 1f) { scale = 1f; offset = Offset.Zero; onZoomed(false) }
                        else {
                            scale = 2.5f
                            offset = (Offset(size.width / 2f, size.height / 2f) - p) * 1.5f
                            onZoomed(true)
                        }
                    }
                )
            }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.size >= 2 || scale > 1f) {
                            val z = event.calculateZoom()
                            scale = (scale * z).coerceIn(1f, 6f)
                            val maxX = (size.width * (scale - 1)) / 2
                            val maxY = (size.height * (scale - 1)) / 2
                            val o = offset + event.calculatePan()
                            offset = Offset(o.x.coerceIn(-maxX, maxX), o.y.coerceIn(-maxY, maxY))
                            if (scale <= 1f) offset = Offset.Zero
                            onZoomed(scale > 1f)
                            event.changes.forEach { it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
    ) {
        val transform = Modifier.fillMaxSize().graphicsLayer {
            scaleX = scale; scaleY = scale
            translationX = offset.x; translationY = offset.y
        }
        AsyncImage(model = model, contentDescription = null, contentScale = ContentScale.Fit, modifier = transform)
        if (hiRes) AsyncImage(model = hiRequest, contentDescription = null, contentScale = ContentScale.Fit, modifier = transform)
    }
}
