package io.github.navisense.idr.models

/**
 * 5-class motion regime matching workstation ML definition.
 */
enum class MotionRegime(val code: Int, val label: String) {
    STATIONARY(0, "stationary"),
    STEADY_WALK(1, "steady_walk"),
    TURNING(2, "turning"),
    ACCELERATION_BRAKING(3, "acceleration_braking"),
    IRREGULAR(4, "irregular");

    companion object {
        fun fromIndex(index: Int): MotionRegime = when (index) {
            0 -> STATIONARY
            1 -> STEADY_WALK
            2 -> TURNING
            3 -> ACCELERATION_BRAKING
            4 -> IRREGULAR
            else -> IRREGULAR
        }
    }
}
