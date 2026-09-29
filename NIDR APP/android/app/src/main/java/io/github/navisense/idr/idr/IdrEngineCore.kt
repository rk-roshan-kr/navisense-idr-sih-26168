package io.github.navisense.idr.idr

import io.github.navisense.idr.models.NavigationAnchor
import io.github.navisense.idr.models.NavigationState
import io.github.navisense.idr.models.SynchronizedImuFrame

/**
 * Pluggable Dead-Reckoning Engine Interface.
 * Decouples sensor ingestion and UI from the underlying motion model.
 */
interface IdrEngineCore {
    /**
     * Initializes the engine with the frozen P0 GNSS anchor at the instant of blackout.
     */
    fun reset(anchor: NavigationAnchor)

    /**
     * Ingests a new high-frequency IMU frame and propagates the estimated navigation state.
     */
    fun updateImu(sample: SynchronizedImuFrame): NavigationState

    /**
     * Returns the latest estimated state.
     */
    fun getEstimatedState(): NavigationState

    /**
     * Returns the complete trajectory accumulated during the blackout window.
     */
    fun getTrajectory(): List<NavigationState>
}
