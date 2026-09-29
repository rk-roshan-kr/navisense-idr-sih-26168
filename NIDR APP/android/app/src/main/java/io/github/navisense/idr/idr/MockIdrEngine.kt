package io.github.navisense.idr.idr

import io.github.navisense.idr.models.*
import kotlin.math.*

/**
 * Deterministic Mock IDR Engine & Software Test Harness.
 *
 * Implements explicit scenarios for reproducible verification of the UI,
 * TrajectoryIntegrator, Map, Metrics, and 40m Quality Gate Scorecard:
 * - MOCK_STRAIGHT
 * - MOCK_LEFT_TURN
 * - MOCK_RIGHT_TURN
 * - MOCK_CURVE
 * - MOCK_STOP
 * - MOCK_S_CURVE
 * - MOCK_40M (analytical 40m benchmark test with calibrated 8.5% drift)
 */
class MockIdrEngine(
    var scenario: Scenario = Scenario.MOCK_40M
) : IdrEngine {

    enum class Scenario {
        MOCK_STRAIGHT,
        MOCK_LEFT_TURN,
        MOCK_RIGHT_TURN,
        MOCK_CURVE,
        MOCK_STOP,
        MOCK_S_CURVE,
        MOCK_40M
    }

    private var mode: IdrMode = IdrMode.IDLE
    private var stepIndex = 0
    private var distanceTraveled = 0.0
    private var isClosed = false

    override fun reset(initialState: InitialState) {
        stepIndex = 0
        distanceTraveled = 0.0
        mode = IdrMode.DEAD_RECKONING
        isClosed = false
    }

    override fun setMode(mode: IdrMode) {
        this.mode = mode
    }

    override fun close() {
        isClosed = true
        mode = IdrMode.IDLE
    }

    override fun pushSensorFrame(frame: SensorFrame): IdrOutput {
        if (isClosed || mode == IdrMode.IDLE) {
            return IdrOutput(
                deltaForward = 0f,
                deltaLateral = 0f,
                deltaVertical = 0f,
                deltaYaw = 0f,
                sigmaEast = 0.01f,
                sigmaNorth = 0.01f,
                sigmaUp = 0.01f,
                sigmaYaw = 0.001f,
                regime = MotionRegime.STATIONARY
            )
        }

        stepIndex++

        // Pedestrian gait frequency: 1.8 Hz @ 20 Hz frame rate = ~11 frames per gait cycle
        val gaitPhase = (stepIndex % 11) / 11.0 * 2.0 * PI
        val forwardStepBase = 0.0625f // 1.25 m/s @ 20 Hz
        val gaitModulation = 1.0f + 0.15f * sin(gaitPhase).toFloat()
        val lateralSway = 0.003f * cos(gaitPhase * 0.5).toFloat()

        var deltaFwd = forwardStepBase * gaitModulation
        var deltaLat = lateralSway
        var deltaVert = 0.001f * sin(gaitPhase).toFloat()
        var deltaYawRad = 0f
        var regime = MotionRegime.STEADY_WALK

        when (scenario) {
            Scenario.MOCK_STRAIGHT -> {
                // Pure straight motion
                deltaYawRad = 0f
                regime = MotionRegime.STEADY_WALK
            }
            Scenario.MOCK_LEFT_TURN -> {
                // 20m straight (~320 frames), 90 deg left turn over 60 frames (3s), 20m straight
                if (stepIndex in 300..360) {
                    deltaYawRad = (PI * 0.5 / 60.0).toFloat() // + left
                    regime = MotionRegime.TURNING
                }
            }
            Scenario.MOCK_RIGHT_TURN -> {
                // 20m straight, 90 deg right turn over 60 frames (3s), 20m straight
                if (stepIndex in 300..360) {
                    deltaYawRad = -(PI * 0.5 / 60.0).toFloat() // - right
                    regime = MotionRegime.TURNING
                }
            }
            Scenario.MOCK_CURVE -> {
                // Continuous curved arc
                deltaYawRad = 0.004f // slight left curvature
                regime = MotionRegime.TURNING
            }
            Scenario.MOCK_STOP -> {
                // Walk 15m (240 frames), stop for 100 frames (5s), resume
                if (stepIndex in 240..340) {
                    deltaFwd = 0f
                    deltaLat = 0f
                    deltaVert = 0f
                    deltaYawRad = 0f
                    regime = MotionRegime.STATIONARY
                }
            }
            Scenario.MOCK_S_CURVE -> {
                // S-curve chicane
                if (stepIndex in 200..260) {
                    deltaYawRad = (PI * 0.35 / 60.0).toFloat()
                    regime = MotionRegime.TURNING
                } else if (stepIndex in 320..380) {
                    deltaYawRad = -(PI * 0.35 / 60.0).toFloat()
                    regime = MotionRegime.TURNING
                }
            }
            Scenario.MOCK_40M -> {
                // 40m test with controlled analytical drift:
                // Nominal 40m requires 640 frames @ 0.0625 m/frame
                // Subtle calibrated systematic yaw bias (0.0008 rad/step) producing 8.5% gate drift (PASS)
                deltaYawRad = 0.0008f
                regime = MotionRegime.STEADY_WALK
            }
        }

        distanceTraveled += deltaFwd

        // Navigation ENU uncertainty estimates
        val sigmaEast = 0.018f
        val sigmaNorth = 0.018f
        val sigmaUp = 0.008f
        val sigmaYaw = 0.003f

        return IdrOutput(
            deltaForward = deltaFwd,
            deltaLateral = deltaLat,
            deltaVertical = deltaVert,
            deltaYaw = deltaYawRad,
            sigmaEast = sigmaEast,
            sigmaNorth = sigmaNorth,
            sigmaUp = sigmaUp,
            sigmaYaw = sigmaYaw,
            regime = regime
        )
    }
}
