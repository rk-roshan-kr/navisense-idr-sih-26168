package io.github.navisense.idr.idr

import io.github.navisense.idr.models.IdrMode
import io.github.navisense.idr.models.IdrOutput
import io.github.navisense.idr.models.InitialState
import io.github.navisense.idr.models.SensorFrame

/**
 * Pluggable Dead-Reckoning Engine Interface.
 *
 * CRITICAL ARCHITECTURAL INVARIANT:
 * This interface has ZERO GNSS parameters in pushSensorFrame.
 * GNSS coordinates CANNOT be passed to the model during dead reckoning.
 * The model receives only synchronized sensor frames and initialized anchor state.
 */
interface IdrEngine {
    /**
     * Initializes the engine state and internal recurrent/window memory at anchor P0.
     */
    fun reset(initialState: InitialState)

    /**
     * Ingests a synchronized 13-channel sensor frame and returns the step displacement,
     * yaw increment, ENU variance, and motion regime.
     */
    fun pushSensorFrame(frame: SensorFrame): IdrOutput

    /**
     * Updates the operational mode.
     */
    fun setMode(mode: IdrMode)

    /**
     * Releases resources / closes inference session.
     */
    fun close()
}
