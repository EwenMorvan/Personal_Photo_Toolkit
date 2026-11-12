package com.ewen.photofinder.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountTree
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CalendarToday
import androidx.compose.material.icons.rounded.DateRange
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Screenshot
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Today
import androidx.compose.material.icons.rounded.UnfoldMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.ewen.photofinder.CellEntry
import com.ewen.photofinder.GridEntry
import com.ewen.photofinder.data.ExportLayout
import com.ewen.photofinder.data.Sources
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

fun sourceIcon(source: String): ImageVector = when (source) {
    Sources.CAMERA -> Icons.Rounded.PhotoCamera
    Sources.SCREENSHOTS -> Icons.Rounded.Screenshot
    Sources.WHATSAPP, Sources.TELEGRAM, Sources.MESSENGER, Sources.SIGNAL, Sources.DISCORD -> Icons.Rounded.Forum
    Sources.QUICKSHARE -> Icons.Rounded.Share
    Sources.DOWNLOADS -> Icons.Rounded.Download
    Sources.INSTAGRAM, Sources.FACEBOOK, Sources.SNAPCHAT -> Icons.Rounded.Groups
    Sources.BLUETOOTH -> Icons.Rounded.Bluetooth
    Sources.EXPORTS -> Icons.Rounded.Archive
    else -> Icons.Rounded.Folder
}

fun layoutIcon(l: ExportLayout): ImageVector = when (l) {
    ExportLayout.FLAT -> Icons.Rounded.Folder
    ExportLayout.MONTH_NAME -> Icons.Rounded.CalendarMonth
    ExportLayout.MONTH_NUM_YEAR -> Icons.Rounded.DateRange
    ExportLayout.MONTH_NAME_YEAR -> Icons.Rounded.Event
    ExportLayout.YEAR_MONTH -> Icons.Rounded.AccountTree
    ExportLayout.YEAR -> Icons.Rounded.CalendarToday
    ExportLayout.DAY -> Icons.Rounded.Today
    ExportLayout.SOURCE -> Icons.Rounded.Apps
    ExportLayout.SOURCE_MONTH -> Icons.Rounded.Layers
    ExportLayout.PLACE -> Icons.Rounded.Place
}

/** Chip arrondie : pleine (couleur d'accent) quand sélectionnée, discrète sinon. */
@Composable
fun Pill(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
    icon: ImageVector? = null,
    count: Int? = null,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) cs.onSurface else cs.surfaceContainerHigh,
        contentColor = if (selected) cs.surface else cs.onSurface,
    ) {
        Row(
            Modifier.height(36.dp).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (icon != null) Icon(icon, null, Modifier.size(16.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
            if (count != null) Text(
                "$count", style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.alpha(if (selected) 0.7f else 0.55f)
            )
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(Locale.FRENCH), style = SectionLabel,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier
    )
}

private val MONTH = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.FRENCH)

/** Barre de défilement rapide à droite, avec une bulle indiquant le mois. */
@Composable
fun FastScroller(state: LazyGridState, entries: List<GridEntry>, modifier: Modifier = Modifier) {
    val total = entries.size
    if (total < 60) return
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var dragging by remember { mutableStateOf(false) }
    var dragFraction by remember { mutableFloatStateOf(0f) }
    var job by remember { mutableStateOf<Job?>(null) }
    val fraction by remember(total) {
        derivedStateOf { state.firstVisibleItemIndex / (total - 1).coerceAtLeast(1).toFloat() }
    }
    val visible = dragging || state.isScrollInProgress
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(if (visible) 150 else 900), label = "fs")

    BoxWithConstraints(modifier.fillMaxHeight().width(140.dp)) {
        val thumbH = with(density) { 44.dp.toPx() }
        val track = (constraints.maxHeight - thumbH).coerceAtLeast(1f)
        val f = if (dragging) dragFraction else fraction
        val y = (track * f).roundToInt()
        val index = (f * (total - 1)).roundToInt().coerceIn(0, total - 1)

        if (dragging) {
            val label = remember(index) {
                val e = entries.subList(index, (index + 2).coerceAtMost(total)).firstOrNull { it is CellEntry } as? CellEntry
                e?.item?.day?.format(MONTH)?.replaceFirstChar { it.titlecase(Locale.FRENCH) } ?: ""
            }
            if (label.isNotEmpty()) Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.inverseSurface,
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                shadowElevation = 6.dp,
                modifier = Modifier.align(Alignment.TopEnd)
                    .offset { IntOffset(-with(density) { 44.dp.roundToPx() }, y) }
            ) {
                Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }

        Box(
            Modifier.align(Alignment.TopEnd)
                .offset { IntOffset(0, y) }
                .alpha(alpha)
                .padding(end = 4.dp)
                .size(width = 32.dp, height = 44.dp)
                .draggable(
                    orientation = Orientation.Vertical,
                    enabled = alpha > 0.05f || dragging,
                    state = rememberDraggableState { delta ->
                        dragFraction = (dragFraction + delta / track).coerceIn(0f, 1f)
                        val target = (dragFraction * (total - 1)).roundToInt()
                        job?.cancel()
                        job = scope.launch { state.scrollToItem(target) }
                    },
                    onDragStarted = { dragFraction = fraction; dragging = true },
                    onDragStopped = { dragging = false },
                ),
            contentAlignment = Alignment.CenterEnd
        ) {
            Box(
                Modifier.shadow(4.dp, RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(12.dp))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
                    .size(width = 26.dp, height = 40.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Rounded.UnfoldMore, "Défilement rapide", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier)
    }
}
