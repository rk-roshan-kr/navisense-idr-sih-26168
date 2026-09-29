package io.github.navisense.idr.models

/**
 * Operational mode of the IDR Engine.
 */
enum class IdrMode {
    IDLE,
    STANDBY,
    TRACKING_GNSS,
    DEAD_RECKONING
}
