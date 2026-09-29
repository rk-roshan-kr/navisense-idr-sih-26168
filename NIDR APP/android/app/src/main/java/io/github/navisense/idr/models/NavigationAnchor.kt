package io.github.navisense.idr.models

/**
 * P0 Anchor state frozen at the instant of GNSS blackout.
 * The IDR engine anchors all relative dead-reckoning integrations to this state.
 */
data class NavigationAnchor(
    val anchorElapsedRealtimeNanos: Long,
    val anchorUnixTimeMs: Long,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double = 0.0,
    val initialHeadingDeg: Float = 0f,
    val initialSpeedMps: Float = 0f,
    val anchorAccuracyM: Float = 0f
)
