package io.github.navisense.idr.idr

import io.github.navisense.idr.models.*
import kotlin.math.*

/**
 * Blackout State Machine Controller.
 *
 * State Lifecycle:
 * ARMED -> GNSS_ACTIVE -> BLACKOUT -> RECONVERGING -> COMPLETE
 *
 * Invariants (Strictly Enforced):
 * 1. Physical Isolation: During BLACKOUT, IdrEngine has ZERO access to GNSS coordinates.
 * 2. Unaltered Outage Benchmark: RECONVERGING does NOT modify or retroactively blend
 *    the historical blackout trajectory P_hat(t). The 40m scorecard evaluates the pure,
 *    unaugmented blackout estimate against reference GNSS.
 */
class BlackoutController(
    private var engine: IdrEngine,
    private val trajectoryIntegrator: TrajectoryIntegrator
) {

    enum class State {
        ARMED,
        GNSS_ACTIVE,
        BLACKOUT,
        RECONVERGING,
        COMPLETE
    }

    @Volatile var state: State = State.ARMED
        private set

    private var initialAnchor: InitialState? = null
    private val rawBlackoutTrajectory = mutableListOf<NavigationState>()
    private val referenceGnssTrajectory = mutableListOf<GnssFrame>()

    fun setEngine(newEngine: IdrEngine) {
        this.engine = newEngine
    }

    /**
     * Called when a trusted GNSS fix is acquired before blackout.
     * Anchors the initial navigation state from the last trusted moving course over ground.
     */
    fun onGnssFix(frame: GnssFrame): Boolean {
        if (state == State.ARMED || state == State.GNSS_ACTIVE) {
            // Require moving fix (speed > 0.5 m/s, accuracy <= 5.0m) to trust heading course
            val isHeadingTrusted = frame.speedMps > 0.5f && frame.accuracyM <= 5.0f

            initialAnchor = InitialState(
                elapsedRealtimeNanos = frame.elapsedRealtimeNanos,
                unixTimeMs = frame.unixTimeMs,
                latitude = frame.latitude,
                longitude = frame.longitude,
                altitude = frame.altitude,
                initialHeadingDeg = if (isHeadingTrusted) frame.bearingDeg else 0f,
                initialSpeedMps = frame.speedMps,
                accuracyM = frame.accuracyM
            )
            state = State.GNSS_ACTIVE
            return true
        }

        // During RECONVERGING, reference GNSS reacquisition marks completion
        if (state == State.RECONVERGING) {
            referenceGnssTrajectory.add(frame)
            state = State.COMPLETE
            return true
        }

        return false
    }

    /**
     * Logs independent reference GNSS (from Phone A or continuous background reference).
     * Strictly isolated from IdrEngine.
     */
    fun logReferenceGnss(frame: GnssFrame) {
        referenceGnssTrajectory.add(frame)
    }

    /**
     * User taps "START OUTAGE":
     * Transitions to BLACKOUT.
     * Initializes engine and integrator with frozen anchor P0.
     */
    fun startOutage(): Boolean {
        val anchor = initialAnchor ?: return false

        rawBlackoutTrajectory.clear()
        referenceGnssTrajectory.clear()

        engine.reset(anchor)
        trajectoryIntegrator.reset(anchor)

        state = State.BLACKOUT
        return true
    }

    /**
     * Processes high-rate sensor frame during outage.
     * Note: ZERO GNSS coordinates are passed to the engine.
     */
    fun onSensorFrame(frame: SensorFrame): NavigationState? {
        if (state != State.BLACKOUT) {
            return null
        }

        // 1. Pure IMU model inference (zero GNSS input)
        val idrOutput = engine.pushSensorFrame(frame)

        // 2. Trajectory propagation via azimuth rotation into ENU & WGS84
        val navState = trajectoryIntegrator.step(idrOutput, frame.elapsedRealtimeNanos, frame.unixTimeMs)

        // 3. Store unaltered historical point
        rawBlackoutTrajectory.add(navState)

        return navState
    }

    /**
     * User taps "END OUTAGE":
     * Transitions from BLACKOUT -> RECONVERGING.
     * Awaits trusted reference GNSS fix without altering historical blackout trajectory.
     */
    fun endOutage() {
        if (state == State.BLACKOUT) {
            state = State.RECONVERGING
            engine.setMode(IdrMode.STANDBY)
        }
    }

    /**
     * Resets controller for a new test run.
     */
    fun reset() {
        state = State.ARMED
        initialAnchor = null
        rawBlackoutTrajectory.clear()
        referenceGnssTrajectory.clear()
        engine.setMode(IdrMode.IDLE)
    }

    fun getRawBlackoutTrajectory(): List<NavigationState> = rawBlackoutTrajectory.toList()
    fun getReferenceTrajectory(): List<GnssFrame> = referenceGnssTrajectory.toList()
    fun getInitialAnchor(): InitialState? = initialAnchor
}
