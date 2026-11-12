package com.ewen.photofinder

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.ContextCompat

object Perms {
    private fun granted(ctx: Context, p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    fun request(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED, Manifest.permission.ACCESS_MEDIA_LOCATION
        )
        Build.VERSION.SDK_INT >= 33 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.ACCESS_MEDIA_LOCATION
        )
        Build.VERSION.SDK_INT >= 29 -> arrayOf(
            Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION
        )
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
    }

    fun hasMedia(ctx: Context): Boolean = when {
        Build.VERSION.SDK_INT >= 34 -> granted(ctx, Manifest.permission.READ_MEDIA_IMAGES) ||
            granted(ctx, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> granted(ctx, Manifest.permission.READ_MEDIA_IMAGES)
        else -> granted(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    /** Android 14+ : l'utilisateur n'a autorisé que quelques photos. */
    fun isPartial(ctx: Context): Boolean = Build.VERSION.SDK_INT >= 34 &&
        !granted(ctx, Manifest.permission.READ_MEDIA_IMAGES) &&
        granted(ctx, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)

    fun hasMediaLocation(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 29 || granted(ctx, Manifest.permission.ACCESS_MEDIA_LOCATION)

    /** Nécessaire pour le scan approfondi (dossiers avec .nomedia, etc.). */
    fun hasAllFiles(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else granted(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)

    fun allFilesSettingsIntent(ctx: Context): Intent =
        if (Build.VERSION.SDK_INT >= 30)
            Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${ctx.packageName}"))
        else appSettingsIntent(ctx)

    fun appSettingsIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
}
