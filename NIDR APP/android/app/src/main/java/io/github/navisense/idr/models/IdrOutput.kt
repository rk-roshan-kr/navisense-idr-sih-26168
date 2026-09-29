package io.github.navisense.idr.models

/**
 * Normalized output contract of the IDR Engine.
 *
 * Coordinate Frames (Strictly Enforced):
 * - Displacements: Body coordinate frame [deltaForward, deltaLateral, deltaVertical]
 * - Heading: Signed yaw increment deltaYaw (radians, CCW/left positive)
 * - Variances: Navigation ENU frame [sigmaEast, sigmaNorth, sigmaUp, sigmaYaw]
 * - Motion Regime: 5-class classification
 */
data class IdrOutput(
    val deltaForward: Float,
    val deltaLateral: Float,
    val deltaVertical: Float,
    val deltaYaw: Float,

    val sigmaEast: Float,
    val sigmaNorth: Float,
    val sigmaUp: Float,
    val sigmaYaw: Float,

    val regime: MotionRegime
)
