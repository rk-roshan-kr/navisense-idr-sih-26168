package io.github.navisense.idr.models

/**
 * Synchronized GNSS / Location fix frame.
 */
data class GnssFrame(
    val elapsedRealtimeNanos: Long,
    val unixTimeMs: Long,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double = 0.0,
    val speedMps: Float = 0f,
    val bearingDeg: Float = 0f,
    val accuracyM: Float = 0f
) {
    fun toCsvLine(): String {
        return "$elapsedRealtimeNanos,$unixTimeMs," +
                "$latitude,$longitude,$altitude," +
                "$speedMps,$bearingDeg,$accuracyM\n"
    }

    companion object {
        const val CSV_HEADER = "timestamp_elapsed_nanos,timestamp_unix_ms," +
                "lat,lon,alt,speed_mps,bearing_deg,accuracy_m\n"
    }
}
