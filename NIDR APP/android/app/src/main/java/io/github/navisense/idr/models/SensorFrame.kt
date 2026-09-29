package io.github.navisense.idr.models

import kotlin.math.sqrt

/**
 * Canonical 13-channel synchronized sensor frame fed to the IdrEngine.
 *
 * All channels use standard SI units:
 * - ax, ay, az: Body acceleration (m/s^2)
 * - gx, gy, gz: Body angular velocity (rad/s)
 * - agxWorld, agyWorld, agzWorld: World gravity-aligned linear acceleration (m/s^2)
 * - qw, qx, qy, qz: Scalar-first canonical unit quaternion (qw >= 0)
 */
data class SensorFrame(
    val elapsedRealtimeNanos: Long,
    val unixTimeMs: Long,

    val ax: Float,
    val ay: Float,
    val az: Float,

    val gx: Float,
    val gy: Float,
    val gz: Float,

    val agxWorld: Float,
    val agyWorld: Float,
    val agzWorld: Float,

    val qw: Float,
    val qx: Float,
    val qy: Float,
    val qz: Float,

    val mx: Float = 0f,
    val my: Float = 0f,
    val mz: Float = 0f
) {
    fun to13ChannelArray(): FloatArray {
        return floatArrayOf(
            ax, ay, az,
            gx, gy, gz,
            agxWorld, agyWorld, agzWorld,
            qw, qx, qy, qz
        )
    }

    companion object {
        const val GRAVITY_M_S2 = 9.80665f

        /**
         * Converts Android raw SynchronizedImuFrame into canonical 13-channel SensorFrame.
         * Enforces scalar-first quaternion with qw >= 0 and transforms body accel to world linear accel:
         * a_world = R(q) * a_body - [0, 0, g]^T
         *
         * Mathematically identical to Python preprocessing (frame_transform.py).
         */
        fun fromImuFrame(frame: SynchronizedImuFrame): SensorFrame {
            // Android Sensor.TYPE_ROTATION_VECTOR produces [qx, qy, qz, qw]
            var qw = frame.rotQw
            var qx = frame.rotQx
            var qy = frame.rotQy
            var qz = frame.rotQz

            // Unit norm enforcement: ||q|| = 1
            val normSq = qw * qw + qx * qx + qy * qy + qz * qz
            if (normSq > 1e-12f) {
                val invNorm = 1.0f / sqrt(normSq)
                qw *= invNorm
                qx *= invNorm
                qy *= invNorm
                qz *= invNorm
            } else {
                qw = 1f; qx = 0f; qy = 0f; qz = 0f
            }

            // Antipodal disambiguation: canonical hemisphere qw >= 0
            if (qw < 0f) {
                qw = -qw
                qx = -qx
                qy = -qy
                qz = -qz
            }

            // 3x3 rotation matrix R from canonical scalar-first quaternion
            val r00 = 1.0f - 2.0f * (qy * qy + qz * qz)
            val r01 = 2.0f * (qx * qy - qz * qw)
            val r02 = 2.0f * (qx * qz + qy * qw)

            val r10 = 2.0f * (qx * qy + qz * qw)
            val r11 = 1.0f - 2.0f * (qx * qx + qz * qz)
            val r12 = 2.0f * (qy * qz - qx * qw)

            val r20 = 2.0f * (qx * qz - qy * qw)
            val r21 = 2.0f * (qy * qz + qx * qw)
            val r22 = 1.0f - 2.0f * (qx * qx + qy * qy)

            // World linear acceleration: a_world = R * a_body - [0, 0, g]^T
            val ax = frame.ax
            val ay = frame.ay
            val az = frame.az

            val agx = r00 * ax + r01 * ay + r02 * az
            val agy = r10 * ax + r11 * ay + r12 * az
            val agz = (r20 * ax + r21 * ay + r22 * az) - GRAVITY_M_S2

            return SensorFrame(
                elapsedRealtimeNanos = frame.elapsedRealtimeNanos,
                unixTimeMs = frame.unixTimeMs,
                ax = ax,
                ay = ay,
                az = az,
                gx = frame.gx,
                gy = frame.gy,
                gz = frame.gz,
                agxWorld = agx,
                agyWorld = agy,
                agzWorld = agz,
                qw = qw,
                qx = qx,
                qy = qy,
                qz = qz,
                mx = frame.magX,
                my = frame.magY,
                mz = frame.magZ
            )
        }
    }
}
