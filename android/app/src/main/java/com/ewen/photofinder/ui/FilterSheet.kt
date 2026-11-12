package com.ewen.photofinder.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.GpsFixed
import androidx.compose.material.icons.rounded.GpsOff
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ewen.photofinder.DatePreset
import com.ewen.photofinder.Facets
import com.ewen.photofinder.Filters
import com.ewen.photofinder.GpsFilter
import com.ewen.photofinder.MainViewModel
import com.ewen.photofinder.Status
import com.ewen.photofinder.data.Sources

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FilterSheet(
    vm: MainViewModel,
    filters: Filters,
    facets: Facets,
    resultCount: Int,
    status: Status,
    onPickRange: () -> Unit,
    onDismiss: () -> Unit,
) {
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    var allPlaces by remember { mutableStateOf(false) }
    var allFolders by remember { mutableStateOf(false) }
    var placeText by remember { mutableStateOf("") }
    var km by remember { mutableFloatStateOf(filters.near?.km ?: 10f) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Filtres", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                if (filters.activeCount > 0) TextButton(onClick = vm::resetFilters) { Text("Tout effacer") }
            }
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)
            ) {
                // ---- Période
                SectionTitle("Période", Modifier.padding(top = 18.dp, bottom = 10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DatePreset.entries.forEach { p ->
                        Pill(
                            selected = filters.preset == p,
                            label = if (p == DatePreset.CUSTOM && filters.preset == p) rangeLabel(filters.from, filters.to) else p.label,
                            onClick = { if (p == DatePreset.CUSTOM) onPickRange() else vm.setPreset(p) }
                        )
                    }
                }
                if (filters.from != null || filters.to != null) Text(
                    rangeLabel(filters.from, filters.to), style = MaterialTheme.typography.bodySmall, color = cs.primary,
                    modifier = Modifier.padding(top = 8.dp)
                )

                // ---- Type
                SectionTitle("Type", Modifier.padding(top = 24.dp, bottom = 10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill(filters.photos, "Photos", { vm.setPhotos(!filters.photos) }, Icons.Rounded.Image)
                    Pill(filters.videos, "Vidéos", { vm.setVideos(!filters.videos) }, Icons.Rounded.Movie)
                }

                // ---- Provenance
                SectionTitle("Provenance", Modifier.padding(top = 24.dp, bottom = 10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    facets.sources.forEach { (name, n) ->
                        Pill(name in filters.sources, name, { vm.toggleSource(name) }, sourceIcon(name), n)
                    }
                    if (facets.hidden > 0) Pill(
                        filters.onlyHidden, "Cachés de la galerie", { vm.setOnlyHidden(!filters.onlyHidden) },
                        Icons.Rounded.VisibilityOff, facets.hidden
                    )
                }

                // ---- Lieu
                SectionTitle("Lieu", Modifier.padding(top = 24.dp, bottom = 10.dp))
                if (status.geoMessage != null && status.geoTotal > 0) {
                    Text("${status.geoMessage}… ${fmtInt(status.geoDone)}/${fmtInt(status.geoTotal)}", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    LinearProgressIndicator(
                        progress = { status.geoDone / status.geoTotal.toFloat() },
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 10.dp).height(3.dp).clip(CircleShape)
                    )
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill(filters.gps == GpsFilter.ALL, "Toutes", { vm.setGps(GpsFilter.ALL) })
                    Pill(filters.gps == GpsFilter.WITH, "Avec GPS", { vm.setGps(GpsFilter.WITH) }, Icons.Rounded.GpsFixed, facets.withGps)
                    Pill(filters.gps == GpsFilter.WITHOUT, "Sans GPS", { vm.setGps(GpsFilter.WITHOUT) }, Icons.Rounded.GpsOff, facets.withoutGps)
                }
                if (facets.places.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    val shown = if (allPlaces) facets.places else facets.places.take(16)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        shown.forEach { (name, n) -> Pill(name in filters.places, name, { vm.togglePlace(name) }, Icons.Rounded.Place, n) }
                        filters.places.filter { s -> shown.none { it.first == s } }.forEach { name ->
                            Pill(true, name, { vm.togglePlace(name) }, Icons.Rounded.Place)
                        }
                    }
                    if (facets.places.size > 16) TextButton(onClick = { allPlaces = !allPlaces }) {
                        Text(if (allPlaces) "Moins de lieux" else "Voir les ${facets.places.size} lieux")
                    }
                }

                // Autour d'un endroit
                Surface(shape = RoundedCornerShape(18.dp), color = cs.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.NearMe, null, Modifier.size(18.dp), tint = cs.primary)
                            Text("Autour d'un endroit", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 8.dp))
                        }
                        filters.near?.let { n ->
                            Spacer(Modifier.height(10.dp))
                            Pill(true, "≤ ${n.km.toInt()} km · ${n.label}", { vm.setNear(null) }, Icons.Rounded.Close)
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = CircleShape, color = cs.surfaceContainerHighest, modifier = Modifier.weight(1f).height(46.dp)) {
                                Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Rounded.Search, null, Modifier.size(18.dp), tint = cs.onSurfaceVariant)
                                    Spacer(Modifier.width(8.dp))
                                    Box(Modifier.weight(1f)) {
                                        if (placeText.isEmpty()) Text("Ville, adresse…", color = cs.onSurfaceVariant)
                                        BasicTextField(
                                            value = placeText, onValueChange = { placeText = it }, singleLine = true,
                                            textStyle = MaterialTheme.typography.bodyLarge.copy(color = cs.onSurface),
                                            cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth()
                                        )
                                    }
                                }
                            }
                            Spacer(Modifier.width(8.dp))
                            FilledTonalButton(enabled = placeText.isNotBlank(), onClick = {
                                vm.searchPlace(placeText, km) { Toast.makeText(ctx, it, Toast.LENGTH_LONG).show() }
                            }) { Text("OK") }
                        }
                        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Rayon", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                            Slider(
                                value = km, onValueChange = { km = it }, onValueChangeFinished = { vm.setNearKm(km) },
                                valueRange = 1f..200f, modifier = Modifier.weight(1f).padding(horizontal = 12.dp)
                            )
                            Text("${km.toInt()} km", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }

                // ---- Dossiers
                SectionTitle("Dossiers", Modifier.padding(top = 24.dp, bottom = 6.dp))
                val folders = if (allFolders) facets.folders else facets.folders.take(10)
                Surface(shape = RoundedCornerShape(18.dp), color = cs.surfaceContainerHigh) {
                    Column(Modifier.padding(vertical = 4.dp)) {
                        folders.forEach { (folder, n) ->
                            Surface(onClick = { vm.toggleFolder(folder) }, color = cs.surfaceContainerHigh) {
                                Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(sourceIcon(Sources.classify(folder)).takeIf { folder.isNotEmpty() } ?: Icons.Rounded.Folder, null, Modifier.size(20.dp), tint = cs.onSurfaceVariant)
                                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                        Text(folder.substringAfterLast('/').ifEmpty { "(racine)" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text("${fmtInt(n)} · $folder", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                    Checkbox(checked = folder in filters.folders, onCheckedChange = { vm.toggleFolder(folder) })
                                }
                            }
                        }
                    }
                }
                if (facets.folders.size > 10) TextButton(onClick = { allFolders = !allFolders }) {
                    Text(if (allFolders) "Moins de dossiers" else "Voir les ${facets.folders.size} dossiers")
                }
                Spacer(Modifier.height(8.dp))
            }
            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp).height(56.dp)
            ) { Text("Afficher " + plural(resultCount, "résultat"), style = MaterialTheme.typography.titleSmall) }
        }
    }
}

