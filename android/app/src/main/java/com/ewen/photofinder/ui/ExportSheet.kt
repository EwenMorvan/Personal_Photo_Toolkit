package com.ewen.photofinder.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Usb
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ewen.photofinder.ExportState
import com.ewen.photofinder.link.PcLink
import com.ewen.photofinder.link.PcRequest
import androidx.compose.material.icons.rounded.Computer
import com.ewen.photofinder.data.ExportLayout
import com.ewen.photofinder.data.GeoIndex
import com.ewen.photofinder.data.MediaItem

private enum class Dest { PC, FOLDER, LAST, PHONE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExportSheet(
    items: List<MediaItem>,
    pcRequest: PcRequest?,
    onPc: () -> Unit,
    defaultName: String,
    lastFolder: String?,
    layout: ExportLayout,
    splitVideos: Boolean,
    geo: GeoIndex,
    onLayout: (ExportLayout) -> Unit,
    onSplitVideos: (Boolean) -> Unit,
    onDismiss: () -> Unit,
    onPhone: (String) -> Unit,
    onPickFolder: () -> Unit,
    onLastFolder: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    var name by remember { mutableStateOf(defaultName) }
    var dest by remember { mutableStateOf(if (pcRequest != null) Dest.PC else if (lastFolder != null) Dest.LAST else Dest.FOLDER) }
    val videos = items.count { it.isVideo }
    val bytes = items.sumOf { it.size.coerceAtLeast(0) }
    val sample = items.lastOrNull()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth()) {
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)
            ) {
                Text("Exporter", style = MaterialTheme.typography.headlineSmall)
                Text(
                    buildString {
                        append(plural(items.size - videos, "photo"))
                        if (videos > 0) append(" · " + plural(videos, "vidéo"))
                        append(" · ${formatSize(bytes)}")
                    },
                    style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant
                )

                SectionTitle("Destination", Modifier.padding(top = 22.dp, bottom = 10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (pcRequest != null) DestCard(
                        Icons.Rounded.Computer, "PC · Photo Studio",
                        "${pcRequest.pc} › ${pcRequest.project} › ${PcLink.FOLDER}", dest == Dest.PC
                    ) { dest = Dest.PC }
                    if (lastFolder != null) DestCard(Icons.Rounded.History, "Dernier dossier", lastFolder, dest == Dest.LAST) { dest = Dest.LAST }
                    DestCard(Icons.Rounded.Usb, "Clé USB ou autre dossier", "Choisir l'emplacement", dest == Dest.FOLDER) { dest = Dest.FOLDER }
                    DestCard(Icons.Rounded.PhoneAndroid, "Ce téléphone", "Pictures/PhotoFinder", dest == Dest.PHONE) { dest = Dest.PHONE }
                }
                if (dest == Dest.PHONE) OutlinedTextField(
                    value = name, onValueChange = { name = it }, singleLine = true, shape = RoundedCornerShape(14.dp),
                    label = { Text("Nom du dossier") }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                )

                if (dest != Dest.PC) {
                SectionTitle("Organisation", Modifier.padding(top = 22.dp, bottom = 10.dp))
                ExportLayout.entries.chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { l ->
                            LayoutCard(l, layout == l, Modifier.weight(1f)) { onLayout(l) }
                        }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                }

                // Aperçu du chemin
                if (sample != null) {
                    val segs = layout.segments(sample, geo).let { if (splitVideos && sample.isVideo) it + "Vidéos" else it }
                    Surface(shape = RoundedCornerShape(14.dp), color = cs.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.FolderOpen, null, Modifier.size(18.dp), tint = cs.primary)
                            Text(
                                (listOf("…") + segs + sample.name).joinToString("  ›  "),
                                style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(start = 10.dp)
                            )
                        }
                    }
                }

                }

                if (videos > 0 && dest != Dest.PC) Row(
                    Modifier.fillMaxWidth().padding(top = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.Movie, null, tint = cs.onSurfaceVariant)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text("Séparer les vidéos", style = MaterialTheme.typography.bodyLarge)
                        Text("Sous-dossier « Vidéos »", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    }
                    Switch(checked = splitVideos, onCheckedChange = onSplitVideos)
                }

                Surface(shape = RoundedCornerShape(14.dp), color = cs.tertiaryContainer, modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp)) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Shield, null, tint = cs.onTertiaryContainer)
                        Text(
                            "Rien n'est jamais supprimé ni remplacé. Les dossiers existants sont réutilisés et les fichiers déjà présents sont ignorés.",
                            style = MaterialTheme.typography.bodySmall, color = cs.onTertiaryContainer,
                            modifier = Modifier.padding(start = 12.dp)
                        )
                    }
                }
            }
            Button(
                onClick = {
                    when (dest) {
                        Dest.PC -> onPc()
                        Dest.PHONE -> onPhone(name)
                        Dest.LAST -> onLastFolder()
                        Dest.FOLDER -> onPickFolder()
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp).height(56.dp),
                contentPadding = PaddingValues(horizontal = 24.dp)
            ) {
                Text(
                    when (dest) {
                        Dest.FOLDER -> "Choisir le dossier et exporter"
                        Dest.PC -> "Envoyer " + plural(items.size, "élément") + " au PC"
                        else -> "Exporter " + plural(items.size, "élément")
                    },
                    style = MaterialTheme.typography.titleSmall
                )
            }
        }
    }
}

@Composable
private fun DestCard(icon: ImageVector, title: String, sub: String, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        color = if (selected) cs.primaryContainer else cs.surfaceContainerHigh,
        border = if (selected) BorderStroke(2.dp, cs.primary) else null,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = if (selected) cs.primary else cs.surfaceContainerHighest, modifier = Modifier.size(42.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = if (selected) cs.onPrimary else cs.onSurface)
                }
            }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (selected) Icon(Icons.Rounded.CheckCircle, null, tint = cs.primary)
        }
    }
}

@Composable
private fun LayoutCard(l: ExportLayout, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = if (selected) cs.primaryContainer else cs.surfaceContainerHigh,
        border = if (selected) BorderStroke(2.dp, cs.primary) else null,
        modifier = modifier
    ) {
        Column(Modifier.padding(12.dp)) {
            Icon(layoutIcon(l), null, tint = if (selected) cs.primary else cs.onSurfaceVariant, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(8.dp))
            Text(l.label, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(l.example, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ---------------------------------------------------------------- Progression / résultat

@Composable
fun ExportProgressDialog(s: ExportState, onCancel: () -> Unit, onDone: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Dialog(
        onDismissRequest = { if (s.finished) onDone() },
        properties = DialogProperties(dismissOnClickOutside = s.finished, dismissOnBackPress = s.finished)
    ) {
        Surface(shape = RoundedCornerShape(28.dp), color = cs.surfaceContainerHigh) {
            Column(Modifier.padding(24.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                if (!s.finished) {
                    val p = if (s.total == 0) 0f else s.done / s.total.toFloat()
                    Box(contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(progress = { p }, modifier = Modifier.size(104.dp), strokeWidth = 8.dp, trackColor = cs.surfaceContainerHighest)
                        Text("${(p * 100).toInt()} %", style = MaterialTheme.typography.titleLarge)
                    }
                    Spacer(Modifier.height(18.dp))
                    Text(s.title, style = MaterialTheme.typography.titleMedium)
                    Text("${fmtInt(s.done)} / ${fmtInt(s.total)}", style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant)
                    s.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp)) }
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = onCancel) { Text("Arrêter") }
                } else {
                    val st = s.stats
                    val ok = st == null || st.failed.isEmpty()
                    Icon(
                        if (ok) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline, null,
                        tint = if (ok) cs.tertiary else cs.error, modifier = Modifier.size(64.dp)
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(if (st != null) "Export terminé" else "Terminé", style = MaterialTheme.typography.headlineSmall)
                    if (st != null) {
                        Text(st.where, style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(16.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat(Icons.Rounded.CheckCircle, fmtInt(st.copied), "copiés", Modifier.weight(1f))
                            Stat(Icons.Rounded.DoneAll, fmtInt(st.skipped), "déjà là", Modifier.weight(1f))
                            Stat(Icons.Rounded.CreateNewFolder, fmtInt(st.folders), "dossiers", Modifier.weight(1f))
                        }
                        if (st.failed.isNotEmpty()) {
                            Text(
                                "${st.failed.size} échec(s) :\n" + st.failed.take(4).joinToString("\n") { "• $it" },
                                style = MaterialTheme.typography.bodySmall, color = cs.error,
                                modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                            )
                        }
                    }
                    s.result?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
                    }
                    Spacer(Modifier.height(18.dp))
                    Button(onClick = onDone, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text("OK") }
                }
            }
        }
    }
}

@Composable
private fun Stat(icon: ImageVector, value: String, label: String, modifier: Modifier) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(16.dp), color = cs.surfaceContainerHighest, modifier = modifier) {
        Column(Modifier.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, Modifier.size(18.dp), tint = cs.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge)
            Text(label, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
        }
    }
}

