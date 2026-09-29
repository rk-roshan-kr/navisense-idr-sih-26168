package io.github.navisense.idr.idr

import io.github.navisense.idr.models.NavigationAnchor
import io.github.navisense.idr.models.NavigationState
import io.github.navisense.idr.models.SynchronizedImuFrame

/**
 * Neural IDR Engine Core.
 * Implements the rolling window buffer (W=20 @ 10 Hz) ready for ExecuTorch / ONNX Mobile runtime.
 */
class NeuralIdrCore : IdrEngineCore {

    private val fallbackCore = KinematicPdrCore()
    private val windowBuffer = ArrayDeque<SynchronizedImuFrame>(20)
    private var isModelLoaded = false

    fun loadModel(modelPath: String): Boolean {
        // Future ExecuTorch/ONNX initialization hook
        isModelLoaded = false
        return false
    }

    override fun reset(anchor: NavigationAnchor) {
        windowBuffer.clear()
        fallbackCore.reset(anchor)
    }

    override fun updateImu(sample: SynchronizedImuFrame): NavigationState {
        if (windowBuffer.size >= 20) {
            windowBuffer.removeFirst()
        }
        windowBuffer.addLast(sample)

        if (isModelLoaded && windowBuffer.size == 20) {
            // ExecuTorch inference path:
            // 1. Pack windowBuffer into FloatBuffer (1, 9, 20)
            // 2. Module.forward(inputTensor)
            // 3. Extract [delta_e, delta_n, delta_psi, velocity, uncertainty, p_stop]
            // 4. Propagate state
        }

        // Seamless fallback to kinematic core when neural model is not yet compiled into APK
        return fallbackCore.updateImu(sample)
    }

    override fun getEstimatedState(): NavigationState = fallbackCore.getEstimatedState()
    override fun getTrajectory(): List<NavigationState> = fallbackCore.getTrajectory()
}
