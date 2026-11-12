package com.ewen.photofinder.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val SHORT = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.FRENCH)
private val FULL = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy 'à' HH:mm", Locale.FRENCH)

fun formatSize(b: Long): String = when {
    b >= 1L shl 30 -> String.format(Locale.FRENCH, "%.1f Go", b / (1L shl 30).toDouble())
    b >= 1L shl 20 -> String.format(Locale.FRENCH, "%.1f Mo", b / (1L shl 20).toDouble())
    b >= 1L shl 10 -> "${b shr 10} Ko"
    else -> "$b o"
}

fun formatDuration(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) String.format(Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
    else String.format(Locale.US, "%d:%02d", s / 60, s % 60)
}

fun formatDateTime(ms: Long): String =
    Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(FULL).replaceFirstChar { it.titlecase(Locale.FRENCH) }

fun formatDay(d: LocalDate): String = d.format(SHORT)

fun rangeLabel(from: LocalDate?, to: LocalDate?): String = when {
    from != null && to != null && from == to -> formatDay(from)
    from != null && to != null -> "${formatDay(from)} → ${formatDay(to)}"
    from != null -> "Depuis le ${formatDay(from)}"
    to != null -> "Jusqu'au ${formatDay(to)}"
    else -> "Toutes les dates"
}
