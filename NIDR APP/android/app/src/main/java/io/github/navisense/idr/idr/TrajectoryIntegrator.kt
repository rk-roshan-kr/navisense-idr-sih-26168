package io.github.navisense.idr.idr

import io.github.navisense.idr.models.IdrOutput
import io.github.navisense.idr.models.InitialState
import io.github.navisense.idr.models.MotionRegime
import io.github.navisense.idr.models.NavigationState
import kotlin.math.*

/**
 * Trajectory Integrator.
 *
 * Mathematical Invariants:
 * 1. Heading Authority: Anchored to initial trusted GNSS heading psi_0, then accumulated strictly from deltaYaw:
 *    psi_t = psi_{t-1} + deltaYaw
 * 2. Azimuth Rotation to ENU:
 *    deltaEast  =  sin(psi_t) * deltaForward + cos(psi_t) * deltaLateral
 *    deltaNorth =  cos(psi_t) * deltaForward - sin(psi_t) * deltaLateral
 * 3. WGS84 Geodetic Projection from Anchor P0:
 *    Lat_t = Lat_0 + North_t / metersPerLatDeg
 *    Lon_t = Lon_0 + East_t / metersPerLonDeg
 * 4. Uncertainty Covariance Growth:
 *    Variances are already in the Navigation ENU frame:
 *    VarEast_t += sigmaEast^2
 *    VarNorth_t += sigmaNorth^2
 *    Uncertainty_t = sqrt(VarEast_t + VarNorth_t)
 */
class TrajectoryIntegrator {

    private var anchor: InitialState? = null
    private val trajectory = mutableListOf<NavigationState>()

    @Volatile private var currentState: NavigationState? = null

    private var eastM = 0.0
    private var northM = 0.0
    private var upM = 0.0
    private var headingRad = 0.0
    private var cumulativeDistanceM = 0.0
    private var varEastM2 = 0.0
    private var varNorthM2 = 0.0
    private var lastFrameNanos = 0L

    fun reset(initialState: InitialState) {
        anchor = initialState
        trajectory.clear()

        eastM = 0.0
        northM = 0.0
        upM = 0.0
        // Anchor heading strictly from initial trusted GNSS bearing
        headingRad = Math.toRadians(initialState.initialHeadingDeg.toDouble())
        cumulativeDistanceM = 0.0

        val initialVar = (max(initialState.accuracyM, 0.5f) * max(initialState.accuracyM, 0.5f)).toDouble()
        varEastM2 = initialVar * 0.5
        varNorthM2 = initialVar * 0.5
        lastFrameNanos = initialState.elapsedRealtimeNanos

        val p0State = NavigationState(
            elapsedRealtimeNanos = initialState.elapsedRealtimeNanos,
            unixTimeMs = initialState.unixTimeMs,
            latitude = initialState.latitude,
            longitude = initialState.longitude,
            altitude = initialState.altitude,
            eastOffsetM = 0.0,
            northOffsetM = 0.0,
            headingDeg = initialState.initialHeadingDeg,
            speedMps = initialState.initialSpeedMps,
            cumulativeDistanceM = 0.0,
            uncertaintyM = max(initialState.accuracyM, 0.5f),
            isStationary = (initialState.initialSpeedMps < 0.2f)
        )
        currentState = p0State
        trajectory.add(p0State)
    }

    fun step(output: IdrOutput, elapsedRealtimeNanos: Long, unixTimeMs: Long): NavigationState {
        val anc = anchor ?: return NavigationState(elapsedRealtimeNanos, unixTimeMs, 0.0, 0.0)

        val dt = if (lastFrameNanos > 0L) {
            max((elapsedRealtimeNanos - lastFrameNanos) / 1_000_000_000.0, 0.01)
        } else {
            0.05
        }
        lastFrameNanos = elapsedRealtimeNanos

        // 1. Heading accumulation: psi_t = psi_{t-1} + deltaYaw
        // deltaYaw is in radians (+ left / CCW, - right / CW)
        // Azimuth bearing is clockwise from North towards East, so subtract deltaYaw to turn clockwise
        headingRad -= output.deltaYaw.toDouble()
        while (headingRad < 0) headingRad += 2 * PI
        while (headingRad >= 2 * PI) headingRad -= 2 * PI
        val headingDeg = Math.toDegrees(headingRad).toFloat()

        // 2. Azimuth coordinate rotation: body displacement -> ENU
        val deltaEast = sin(headingRad) * output.deltaForward + cos(headingRad) * output.deltaLateral
        val deltaNorth = cos(headingRad) * output.deltaForward - sin(headingRad) * output.deltaLateral
        val deltaUp = output.deltaVertical.toDouble()

        eastM += deltaEast
        northM += deltaNorth
        upM += deltaUp

        val stepDist = sqrt(output.deltaForward * output.deltaForward + output.deltaLateral * output.deltaLateral).toDouble()
        cumulativeDistanceM += stepDist

        // 3. Geodetic WGS84 projection
        val lat0Rad = Math.toRadians(anc.latitude)
        val metersPerLatDeg = 111_132.92 - 559.82 * cos(2 * lat0Rad) + 1.175 * cos(4 * lat0Rad)
        val metersPerLonDeg = (PI / 180.0) * 6_378_137.0 * cos(lat0Rad)

        val newLat = anc.latitude + (northM / metersPerLatDeg)
        val newLon = anc.longitude + (eastM / metersPerLonDeg)

        // 4. Uncertainty propagation (variances are in navigation ENU frame)
        varEastM2 += (output.sigmaEast * output.sigmaEast).toDouble()
        varNorthM2 += (output.sigmaNorth * output.sigmaNorth).toDouble()
        val uncertaintyM = sqrt(varEastM2 + varNorthM2).toFloat().coerceAtLeast(0.5f)

        val speedMps = (stepDist / dt).toFloat().coerceIn(0f, 4.0f)
        val isStationary = (output.regime == MotionRegime.STATIONARY || speedMps < 0.15f)

        val newState = NavigationState(
            elapsedRealtimeNanos = elapsedRealtimeNanos,
            unixTimeMs = unixTimeMs,
            latitude = newLat,
            longitude = newLon,
            altitude = anc.altitude + upM,
            eastOffsetM = eastM,
            northOffsetM = northM,
            headingDeg = headingDeg,
            speedMps = speedMps,
            cumulativeDistanceM = cumulativeDistanceM,
            uncertaintyM = uncertaintyM,
            isStationary = isStationary
        )

        currentState = newState
        trajectory.add(newState)
        return newState
    }

    fun getEstimatedState(): NavigationState {
        return currentState ?: NavigationState(0L, 0L, 0.0, 0.0)
    }

    fun getTrajectory(): List<NavigationState> = trajectory.toList()
}
