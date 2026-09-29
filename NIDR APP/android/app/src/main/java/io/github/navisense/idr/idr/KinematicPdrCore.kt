package io.github.navisense.idr.idr

import io.github.navisense.idr.models.NavigationAnchor
import io.github.navisense.idr.models.NavigationState
import io.github.navisense.idr.models.SynchronizedImuFrame
import kotlin.math.*

/**
 * Kinematic Pedestrian Dead Reckoning (PDR) Core.
 *
 * 100% on-device live computation with zero external APIs:
 * 1. Step detection: Weinberg gait acceleration model + hardware step detector fusion.
 * 2. Heading: Fused rotation vector / compass azimuth with high-rate Z-gyro integration.
 * 3. Position propagation: Azimuth projection into local ENU frame (East, North).
 * 4. Geodetic projection: High-precision WGS84 ellipsoid projection to updated Lat/Lon.
 */
class KinematicPdrCore : IdrEngineCore {

    private var anchor: NavigationAnchor? = null
    private val trajectory = mutableListOf<NavigationState>()

    @Volatile private var currentState: NavigationState? = null

    // Dead reckoning state
    private var eastM = 0.0
    private var northM = 0.0
    private var headingRad = 0.0
    private var cumulativeDistanceM = 0.0
    private var stepCount = 0
    private var lastImuNanos = 0L

    // Step detection state (Weinberg model)
    private var lastStepNanos = 0L
    private val MIN_STEP_INTERVAL_NANOS = 250_000_000L // 250 ms (max 4 steps/sec)
    private var accelMax = 9.81f
    private var accelMin = 9.81f
    private var isSearchingPeak = true
    private val STEP_THRESHOLD = 0.95f // m/s^2 deviation from gravity
    private val WEINBERG_K = 0.45 // empirical pedestrian stride constant (averages ~0.72m)
    private val NOMINAL_STRIDE_M = 0.72

    override fun reset(anchor: NavigationAnchor) {
        this.anchor = anchor
        trajectory.clear()

        eastM = 0.0
        northM = 0.0
        headingRad = Math.toRadians(anchor.initialHeadingDeg.toDouble())
        cumulativeDistanceM = 0.0
        stepCount = 0
        lastImuNanos = anchor.anchorElapsedRealtimeNanos
        lastStepNanos = anchor.anchorElapsedRealtimeNanos
        accelMax = 9.81f
        accelMin = 9.81f
        isSearchingPeak = true

        val initialState = NavigationState(
            elapsedRealtimeNanos = anchor.anchorElapsedRealtimeNanos,
            unixTimeMs = anchor.anchorUnixTimeMs,
            latitude = anchor.latitude,
            longitude = anchor.longitude,
            altitude = anchor.altitude,
            eastOffsetM = 0.0,
            northOffsetM = 0.0,
            headingDeg = anchor.initialHeadingDeg,
            speedMps = anchor.initialSpeedMps,
            cumulativeDistanceM = 0.0,
            uncertaintyM = max(anchor.anchorAccuracyM, 0.5f),
            isStationary = true,
            stepCount = 0
        )
        currentState = initialState
        trajectory.add(initialState)
    }

    /**
     * Hardware Step Detector trigger (Sensor.TYPE_STEP_DETECTOR).
     * Invoked immediately when phone's hardware step sensor detects a physical footstep.
     */
    fun onHardwareStep(elapsedRealtimeNanos: Long, unixTimeMs: Long): NavigationState? {
        val anc = anchor ?: return null
        if (elapsedRealtimeNanos - lastStepNanos < MIN_STEP_INTERVAL_NANOS) {
            return currentState
        }

        lastStepNanos = elapsedRealtimeNanos
        stepCount++

        val strideLength = NOMINAL_STRIDE_M
        val deltaEast = strideLength * sin(headingRad)
        val deltaNorth = strideLength * cos(headingRad)

        eastM += deltaEast
        northM += deltaNorth
        cumulativeDistanceM += strideLength

        return computeGeodeticState(elapsedRealtimeNanos, unixTimeMs, anc, 1.2f, true)
    }

    override fun updateImu(sample: SynchronizedImuFrame): NavigationState {
        val anc = anchor ?: return NavigationState(sample.elapsedRealtimeNanos, sample.unixTimeMs, 0.0, 0.0)

        val dt = if (lastImuNanos > 0L) {
            max((sample.elapsedRealtimeNanos - lastImuNanos) / 1_000_000_000.0, 0.005)
        } else {
            0.01
        }
        lastImuNanos = sample.elapsedRealtimeNanos

        // 1. Heading determination
        // If 3D rotation vector quaternion is valid, compute absolute Earth-referenced azimuth
        val qMagSq = sample.rotQw * sample.rotQw + sample.rotQx * sample.rotQx + sample.rotQy * sample.rotQy + sample.rotQz * sample.rotQz
        if (qMagSq > 0.5f) {
            val qw = sample.rotQw; val qx = sample.rotQx; val qy = sample.rotQy; val qz = sample.rotQz
            val sinyCosp = 2.0 * (qw * qz + qx * qy)
            val cosyCosp = 1.0 - 2.0 * (qy * qy + qz * qz)
            var azRad = -atan2(sinyCosp, cosyCosp)
            while (azRad < 0) azRad += 2 * PI
            while (azRad >= 2 * PI) azRad -= 2 * PI
            headingRad = azRad
        } else {
            // Gyroscope Z-axis turn integration
            val gyroZ = sample.gz
            if (abs(gyroZ) > 0.005f) {
                headingRad -= gyroZ * dt
            }
            while (headingRad < 0) headingRad += 2 * PI
            while (headingRad >= 2 * PI) headingRad -= 2 * PI
        }

        // 2. Step detection on acceleration magnitude (Weinberg model)
        val aNorm = sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az)
        val aDiff = aNorm - 9.81f

        if (aNorm > accelMax) accelMax = aNorm
        if (aNorm < accelMin) accelMin = aNorm

        var stepDetected = false
        var strideLength = 0.0

        if (sample.elapsedRealtimeNanos - lastStepNanos >= MIN_STEP_INTERVAL_NANOS) {
            if (isSearchingPeak && aDiff > STEP_THRESHOLD) {
                isSearchingPeak = false
            } else if (!isSearchingPeak && aDiff < -STEP_THRESHOLD) {
                // Peak-valley cadence confirmed -> Physical footstep detected!
                stepDetected = true
                lastStepNanos = sample.elapsedRealtimeNanos
                isSearchingPeak = true
                stepCount++

                // Weinberg model: SL = K * (a_max - a_min)^(1/4)
                val bounce = max(accelMax - accelMin, 0.1f)
                strideLength = (WEINBERG_K * bounce.toDouble().pow(0.25)).coerceIn(0.45, 1.05)

                // Reset peak/valley tracking
                accelMax = 9.81f
                accelMin = 9.81f
            }
        }

        // 3. Position propagation
        var currentSpeed = 0f
        if (stepDetected && strideLength > 0.0) {
            val deltaEast = strideLength * sin(headingRad)
            val deltaNorth = strideLength * cos(headingRad)

            eastM += deltaEast
            northM += deltaNorth
            cumulativeDistanceM += strideLength
            currentSpeed = (strideLength / max(dt, 0.35)).toFloat().coerceIn(0.5f, 3.5f)
        }

        return computeGeodeticState(sample.elapsedRealtimeNanos, sample.unixTimeMs, anc, currentSpeed, stepDetected)
    }

    private fun computeGeodeticState(
        elapsedRealtimeNanos: Long,
        unixTimeMs: Long,
        anc: NavigationAnchor,
        currentSpeed: Float,
        stepDetected: Boolean
    ): NavigationState {
        // WGS84 Ellipsoidal Projection
        val lat0Rad = Math.toRadians(anc.latitude)
        val metersPerLatDeg = 111_132.92 - 559.82 * cos(2 * lat0Rad) + 1.175 * cos(4 * lat0Rad)
        val metersPerLonDeg = (PI / 180.0) * 6_378_137.0 * cos(lat0Rad)

        val newLat = anc.latitude + (northM / metersPerLatDeg)
        val newLon = anc.longitude + (eastM / max(metersPerLonDeg, 1000.0))

        val headingDeg = Math.toDegrees(headingRad).toFloat()
        val uncertainty = (anc.anchorAccuracyM + 0.12f * sqrt(cumulativeDistanceM.toFloat())).coerceAtLeast(0.5f)
        val isStationary = (elapsedRealtimeNanos - lastStepNanos > 1_500_000_000L)

        val newState = NavigationState(
            elapsedRealtimeNanos = elapsedRealtimeNanos,
            unixTimeMs = unixTimeMs,
            latitude = newLat,
            longitude = newLon,
            altitude = anc.altitude,
            eastOffsetM = eastM,
            northOffsetM = northM,
            headingDeg = headingDeg,
            speedMps = if (isStationary) 0f else currentSpeed,
            cumulativeDistanceM = cumulativeDistanceM,
            uncertaintyM = uncertainty,
            isStationary = isStationary,
            stepCount = stepCount
        )

        currentState = newState
        if (stepDetected || trajectory.isEmpty() || elapsedRealtimeNanos - trajectory.last().elapsedRealtimeNanos >= 500_000_000L) {
            trajectory.add(newState)
        }

        return newState
    }

    override fun getEstimatedState(): NavigationState {
        return currentState ?: NavigationState(0L, 0L, 0.0, 0.0)
    }

    override fun getTrajectory(): List<NavigationState> = trajectory.toList()

    fun getStepCount(): Int = stepCount
}
