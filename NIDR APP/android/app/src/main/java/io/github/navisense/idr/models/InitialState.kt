package io.github.navisense.idr.models

/**
 * Initial geodetic & navigation state anchor frozen at the start of dead-reckoning.
 * Anchored from the last trusted GNSS position & course over ground while moving.
 */
data class InitialState(
    val elapsedRealtimeNanos: Long,
    val unixTimeMs: Long,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double = 0.0,
    val initialHeadingDeg: Float = 0f,
    val initialSpeedMps: Float = 0f,
    val accuracyM: Float = 1.0f
)
