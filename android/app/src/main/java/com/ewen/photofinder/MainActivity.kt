package com.ewen.photofinder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.LaunchedEffect
import com.ewen.photofinder.link.LinkService
import com.ewen.photofinder.ui.AppTheme
import com.ewen.photofinder.ui.MainScreen
import com.ewen.photofinder.ui.PermissionScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        LinkService.start(this)          // écoute des demandes de Photo Studio (PC)
        handleIntent(intent)
        setContent { AppTheme { App() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(LinkService.EXTRA_FROM_PC, false) == true) LinkService.cancelRequestNotification(this)
    }
}

@Composable
fun App(vm: MainViewModel = viewModel()) {
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(Perms.hasMedia(ctx)) }
    var partial by remember { mutableStateOf(Perms.isPartial(ctx)) }
    var refused by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        granted = Perms.hasMedia(ctx)
        partial = Perms.isPartial(ctx)
        refused = !granted
        vm.onResume()
    }
    // Notifications : pour être prévenu quand le PC demande des photos
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(granted) {
        if (granted && Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        granted = Perms.hasMedia(ctx)
        partial = Perms.isPartial(ctx)
        vm.onResume()
    }
    if (!granted) PermissionScreen(refused) {
        // Après un refus, Android n'affiche plus la demande : on ouvre les réglages de l'app.
        if (refused) runCatching { ctx.startActivity(Perms.appSettingsIntent(ctx)) }
        else launcher.launch(Perms.request())
    }
    else MainScreen(vm, partial, onRequestAll = { launcher.launch(Perms.request()) })
}
