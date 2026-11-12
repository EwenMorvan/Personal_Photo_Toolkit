package com.ewen.photofinder.data

import java.time.format.TextStyle
import java.util.Locale

/** Comment ranger les fichiers dans le dossier de destination. */
enum class ExportLayout(val label: String, val example: String) {
    FLAT("Tel quel", "Sans sous-dossier"),
    MONTH_NAME("Mois", "Septembre, Octobre…"),
    MONTH_NUM_YEAR("MM AAAA", "01 2026, 02 2026…"),
    MONTH_NAME_YEAR("Mois année", "Septembre 2026…"),
    YEAR_MONTH("Année › mois", "2026/09 Septembre"),
    YEAR("Année", "2025, 2026…"),
    DAY("Jour", "2026-09-14…"),
    SOURCE("Provenance", "WhatsApp, Appareil photo…"),
    SOURCE_MONTH("Provenance › mois", "WhatsApp/09 2026"),
    PLACE("Ville", "Brest, France…");

    fun segments(item: MediaItem, geo: GeoIndex): List<String> {
        val d = item.day
        val month = d.month.getDisplayName(TextStyle.FULL_STANDALONE, Locale.FRENCH)
            .replaceFirstChar { it.titlecase(Locale.FRENCH) }
        val mm = "%02d".format(d.monthValue)
        val segs = when (this) {
            FLAT -> emptyList()
            MONTH_NAME -> listOf(month)
            MONTH_NUM_YEAR -> listOf("$mm ${d.year}")
            MONTH_NAME_YEAR -> listOf("$month ${d.year}")
            YEAR_MONTH -> listOf("${d.year}", "$mm $month")
            YEAR -> listOf("${d.year}")
            DAY -> listOf(d.toString())
            SOURCE -> listOf(item.source)
            SOURCE_MONTH -> listOf(item.source, "$mm ${d.year}")
            PLACE -> listOf(geo.placeName(item)?.takeUnless { it.startsWith("≈") } ?: "Sans lieu")
        }
        return segs.map(::safeName)
    }

    companion object {
        /** Noms compatibles clés USB (FAT32/exFAT) : pas de / \ : * ? " < > | ni point final. */
        fun safeName(s: String): String =
            s.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimEnd('.').ifEmpty { "_" }
    }
}
