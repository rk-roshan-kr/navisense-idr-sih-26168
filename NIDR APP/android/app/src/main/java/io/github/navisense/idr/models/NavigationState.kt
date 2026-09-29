package io.github.navisense.idr.models

/**
 * Current dead-reckoning navigation state computed by the IDR engine.
 */
data class NavigationState(
    val elapsedRealtimeNanos: Long,
    val unixTimeMs: Long,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double = 0.0,
    val eastOffsetM: Double = 0.0,
    val northOffsetM: Double = 0.0,
    val headingDeg: Float = 0f,
    val speedMps: Float = 0f,
    val cumulativeDistanceM: Double = 0.0,
    val uncertaintyM: Float = 0.5f,
    val isStationary: Boolean = false,
    val stepCount: Int = 0
)
