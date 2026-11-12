package com.ewen.photofinder.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DriveFolderUpload
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun PermissionScreen(refused: Boolean, onRequest: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxSize().background(cs.background).statusBarsPadding().navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(96.dp).background(Brush.linearGradient(listOf(cs.primary, Color(0xFF00C2FF))), RoundedCornerShape(28.dp)),
            contentAlignment = Alignment.Center
        ) { Icon(Icons.Rounded.PhotoLibrary, null, tint = Color.White, modifier = Modifier.size(48.dp)) }
        Spacer(Modifier.height(24.dp))
        Text("Photo Finder", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Toutes tes photos et vidéos, d'où qu'elles viennent.",
            style = MaterialTheme.typography.bodyLarge, color = cs.onSurfaceVariant, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp)
        )
        Spacer(Modifier.height(32.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Feature(Icons.Rounded.PhotoLibrary, "Tout au même endroit", "Appareil photo, WhatsApp, Quick Share, téléchargements, dossiers cachés…")
            Feature(Icons.Rounded.Tune, "Filtres précis", "Période, provenance, dossier, ville, autour d'un lieu.")
            Feature(Icons.Rounded.DriveFolderUpload, "Export propre", "Vers une clé USB, rangé par mois, sans doublons.")
            Feature(Icons.Rounded.Lock, "Privé", "Rien n'est envoyé, sauf la recherche du nom des villes.")
        }
        Spacer(Modifier.weight(1f))
        if (refused) Text(
            "Accès refusé. Ouvre les réglages › Autorisations › Photos et vidéos › « Toujours tout autoriser ».",
            textAlign = TextAlign.Center, color = cs.error, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(bottom = 12.dp)
        )
        Button(onClick = onRequest, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text(if (refused) "Ouvrir les réglages" else "Autoriser l'accès aux photos", style = MaterialTheme.typography.titleSmall)
        }
        Text(
            "Choisis « Tout autoriser » pour ne rien oublier.",
            style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp)
        )
    }
}

@Composable
private fun Feature(icon: ImageVector, title: String, sub: String) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(18.dp), color = cs.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = cs.primaryContainer, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = cs.onPrimaryContainer, modifier = Modifier.size(20.dp)) }
            }
            Column(Modifier.padding(start = 14.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            }
        }
    }
}
