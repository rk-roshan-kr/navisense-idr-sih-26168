package io.github.navisense.idr.models

/**
 * Canonical 17-channel synchronized sensor frame.
 * All quantities use standard SI units:
 * - Accelerations: m/s^2
 * - Angular velocities: rad/s
 * - Magnetic flux: microTesla (uT)
 * - Orientation: unit quaternion (qx, qy, qz, qw)
 */
data class SynchronizedImuFrame(
    val elapsedRealtimeNanos: Long,
    val unixTimeMs: Long,
    val ax: Float = 0f,
    val ay: Float = 0f,
    val az: Float = 0f,
    val gx: Float = 0f,
    val gy: Float = 0f,
    val gz: Float = 0f,
    val gravityX: Float = 0f,
    val gravityY: Float = 0f,
    val gravityZ: Float = 0f,
    val rotQx: Float = 0f,
    val rotQy: Float = 0f,
    val rotQz: Float = 0f,
    val rotQw: Float = 1f,
    val magX: Float = 0f,
    val magY: Float = 0f,
    val magZ: Float = 0f,
    val accuracy: Int = 3
) {
    fun toCsvLine(): String {
        return "$elapsedRealtimeNanos,$unixTimeMs," +
                "$ax,$ay,$az," +
                "$gx,$gy,$gz," +
                "$gravityX,$gravityY,$gravityZ," +
                "$rotQx,$rotQy,$rotQz,$rotQw," +
                "$magX,$magY,$magZ,$accuracy\n"
    }

    companion object {
        const val CSV_HEADER = "timestamp_elapsed_nanos,timestamp_unix_ms," +
                "ax,ay,az," +
                "gx,gy,gz," +
                "gravity_x,gravity_y,gravity_z," +
                "rot_qx,rot_qy,rot_qz,rot_qw," +
                "mag_x,mag_y,mag_z,accuracy\n"
    }
}
