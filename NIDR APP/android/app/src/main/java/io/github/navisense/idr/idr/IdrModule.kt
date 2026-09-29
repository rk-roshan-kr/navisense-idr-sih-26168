package io.github.navisense.idr.idr

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.github.navisense.idr.models.*
import io.github.navisense.idr.sensors.SensorModule
import kotlin.math.*

/**
 * React Native Bridge Module for the Intelligent Dead Reckoning (IDR) Subsystem.
 *
 * Runs 100% on-device with ZERO external APIs:
 * 1. Direct hardware sensor listener (Accelerometer, Gyroscope, Rotation Vector, Step Detector)
 * 2. Kinematic PDR core with Weinberg gait model and true compass azimuth
 * 3. Blackout Controller & Trajectory Integrator
 * 4. 10 Hz + Per-step real-time UI Telemetry bridge
 */
class IdrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener {

    private val kinematicCore = KinematicPdrCore()
    private val trajectoryIntegrator = TrajectoryIntegrator()
    private var engine: IdrEngine = MockIdrEngine(MockIdrEngine.Scenario.MOCK_40M)
    private var blackoutController = BlackoutController(engine, trajectoryIntegrator)

    private var lastUiEmitNanos = 0L
    private val UI_EMIT_INTERVAL_NANOS = 100_000_000L // 10 Hz (100 ms)

    @Volatile private var isBlackoutActive = false
    @Volatile private var isSensorListening = false

    // Dedicated high-priority sensor thread for uninterrupted IMU processing
    private val sensorHandlerThread = HandlerThread("IdrLiveSensorThread", android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
    private val sensorHandler: Handler

    // Sensor Manager and Hardware Sensors
    private val sensorManager: SensorManager = reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyroSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val rotVectorSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        ?: sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
    private val stepDetectorSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)

    // Current IMU sample cache for frame synchronization
    @Volatile private var curAx = 0f; @Volatile private var curAy = 0f; @Volatile private var curAz = 9.81f
    @Volatile private var curGx = 0f; @Volatile private var curGy = 0f; @Volatile private var curGz = 0f
    @Volatile private var curQx = 0f; @Volatile private var curQy = 0f; @Volatile private var curQz = 0f; @Volatile private var curQw = 1f

    init {
        sensorHandlerThread.start()
        sensorHandler = Handler(sensorHandlerThread.looper)
    }

    override fun getName(): String = "IdrModule"

    private fun startLiveSensors() {
        if (isSensorListening) return
        isSensorListening = true

        accelSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, sensorHandler) }
        gyroSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, sensorHandler) }
        rotVectorSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, sensorHandler) }
        stepDetectorSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST, sensorHandler) }
    }

    private fun stopLiveSensors() {
        if (!isSensorListening) return
        isSensorListening = false
        sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent) {
        val nowNanos = SystemClock.elapsedRealtimeNanos()
        val nowUnixMs = System.currentTimeMillis()

        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                curAx = event.values[0]
                curAy = event.values[1]
                curAz = event.values[2]
            }
            Sensor.TYPE_GYROSCOPE -> {
                curGx = event.values[0]
                curGy = event.values[1]
                curGz = event.values[2]
            }
            Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                val q = FloatArray(4)
                SensorManager.getQuaternionFromVector(q, event.values)
                curQw = q[0]
                curQx = q[1]
                curQy = q[2]
                curQz = q[3]
            }
            Sensor.TYPE_STEP_DETECTOR -> {
                // Hardware step detector fired directly on device hardware!
                val stepState = kinematicCore.onHardwareStep(nowNanos, nowUnixMs)
                if (stepState != null && isBlackoutActive) {
                    emitState(stepState, isBlackout = true)
                }
                return
            }
        }

        // On accelerometer or gyro event: propagate kinematic PDR
        if (event.sensor.type == Sensor.TYPE_ACCELEROMETER || event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            val imuFrame = SynchronizedImuFrame(
                elapsedRealtimeNanos = nowNanos,
                unixTimeMs = nowUnixMs,
                ax = curAx, ay = curAy, az = curAz,
                gx = curGx, gy = curGy, gz = curGz,
                gravityX = 0f, gravityY = 0f, gravityZ = 0f,
                rotQx = curQx, rotQy = curQy, rotQz = curQz, rotQw = curQw,
                magX = 0f, magY = 0f, magZ = 0f,
                accuracy = event.accuracy
            )

            val pdrState = kinematicCore.updateImu(imuFrame)

            // Also feed blackout controller if synthetic benchmark is requested
            val sensorFrame = SensorFrame.fromImuFrame(imuFrame)
            blackoutController.onSensorFrame(sensorFrame)

            if (isBlackoutActive) {
                // Throttle emission to 10 Hz for smooth UI updates
                if (nowNanos - lastUiEmitNanos >= UI_EMIT_INTERVAL_NANOS) {
                    lastUiEmitNanos = nowNanos
                    emitState(pdrState, isBlackout = true)
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun internalSetEngine(engineType: String, scenarioName: String?) {
        engine.close()
        engine = when (engineType.uppercase()) {
            "EXECUTORCH" -> ExecuTorchIdrEngine(reactContext)
            else -> {
                val scenario = try {
                    if (scenarioName != null) MockIdrEngine.Scenario.valueOf(scenarioName)
                    else MockIdrEngine.Scenario.MOCK_40M
                } catch (e: Exception) {
                    MockIdrEngine.Scenario.MOCK_40M
                }
                MockIdrEngine(scenario)
            }
        }
        blackoutController.setEngine(engine)
    }

    @ReactMethod
    fun setEngineType(engineType: String, scenarioName: String?, promise: Promise) {
        try {
            internalSetEngine(engineType, scenarioName)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_ENGINE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setAnchor(anchorMap: ReadableMap, engineType: String, promise: Promise) {
        try {
            internalSetEngine(engineType, null)

            val anchorElapsedNanos = if (anchorMap.hasKey("anchorElapsedRealtimeNanos")) {
                anchorMap.getDouble("anchorElapsedRealtimeNanos").toLong()
            } else {
                SystemClock.elapsedRealtimeNanos()
            }
            val anchorUnixMs = if (anchorMap.hasKey("anchorUnixTimeMs")) {
                anchorMap.getDouble("anchorUnixTimeMs").toLong()
            } else {
                System.currentTimeMillis()
            }

            val navAnchor = NavigationAnchor(
                anchorElapsedRealtimeNanos = anchorElapsedNanos,
                anchorUnixTimeMs = anchorUnixMs,
                latitude = anchorMap.getDouble("latitude"),
                longitude = anchorMap.getDouble("longitude"),
                altitude = if (anchorMap.hasKey("altitude")) anchorMap.getDouble("altitude") else 0.0,
                initialHeadingDeg = if (anchorMap.hasKey("initialHeadingDeg")) anchorMap.getDouble("initialHeadingDeg").toFloat() else 0f,
                initialSpeedMps = if (anchorMap.hasKey("initialSpeedMps")) anchorMap.getDouble("initialSpeedMps").toFloat() else 0f,
                anchorAccuracyM = if (anchorMap.hasKey("anchorAccuracyM")) anchorMap.getDouble("anchorAccuracyM").toFloat() else 1.0f
            )

            // 1. Reset real physical sensor kinematic PDR core
            kinematicCore.reset(navAnchor)

            // 2. Set anchor in blackout controller
            val anchor = InitialState(
                elapsedRealtimeNanos = navAnchor.anchorElapsedRealtimeNanos,
                unixTimeMs = navAnchor.anchorUnixTimeMs,
                latitude = navAnchor.latitude,
                longitude = navAnchor.longitude,
                altitude = navAnchor.altitude,
                initialHeadingDeg = navAnchor.initialHeadingDeg,
                initialSpeedMps = navAnchor.initialSpeedMps,
                accuracyM = navAnchor.anchorAccuracyM
            )

            val gnssFrame = GnssFrame(
                elapsedRealtimeNanos = anchor.elapsedRealtimeNanos,
                unixTimeMs = anchor.unixTimeMs,
                latitude = anchor.latitude,
                longitude = anchor.longitude,
                altitude = anchor.altitude,
                speedMps = anchor.initialSpeedMps,
                bearingDeg = anchor.initialHeadingDeg,
                accuracyM = anchor.accuracyM
            )
            blackoutController.onGnssFix(gnssFrame)

            // 3. Start high-rate phone hardware sensors immediately
            startLiveSensors()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_ANCHOR_ERROR", e.message)
        }
    }

    @ReactMethod
    fun triggerBlackout(promise: Promise) {
        try {
            isBlackoutActive = true
            blackoutController.startOutage()
            startLiveSensors()
            lastUiEmitNanos = 0L

            val state = kinematicCore.getEstimatedState()
            emitState(state, isBlackout = true)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("TRIGGER_BLACKOUT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun endOutage(promise: Promise) {
        try {
            isBlackoutActive = false
            blackoutController.endOutage()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("END_OUTAGE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun restoreGnss(promise: Promise) {
        try {
            isBlackoutActive = false
            val state = kinematicCore.getEstimatedState()
            val rawTraj = kinematicCore.getTrajectory()

            val map = Arguments.createMap().apply {
                putDouble("finalLat", state.latitude)
                putDouble("finalLon", state.longitude)
                putDouble("cumulativeDistanceM", state.cumulativeDistanceM)
                putInt("trajectoryPointCount", rawTraj.size)
                putInt("stepCount", state.stepCount)
                putDouble("finalUncertaintyM", state.uncertaintyM.toDouble())
                putString("blackoutState", "COMPLETE")
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("RESTORE_GNSS_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getEstimatedState(promise: Promise) {
        val state = kinematicCore.getEstimatedState()
        val map = Arguments.createMap().apply {
            putDouble("latitude", state.latitude)
            putDouble("longitude", state.longitude)
            putDouble("eastOffsetM", state.eastOffsetM)
            putDouble("northOffsetM", state.northOffsetM)
            putDouble("headingDeg", state.headingDeg.toDouble())
            putDouble("speedMps", state.speedMps.toDouble())
            putDouble("cumulativeDistanceM", state.cumulativeDistanceM)
            putDouble("uncertaintyM", state.uncertaintyM.toDouble())
            putInt("stepCount", state.stepCount)
            putBoolean("isStationary", state.isStationary)
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun getTrajectory(promise: Promise) {
        val list = kinematicCore.getTrajectory()
        val array = Arguments.createArray()

        for (st in list) {
            val m = Arguments.createMap().apply {
                putDouble("elapsedRealtimeNanos", st.elapsedRealtimeNanos.toDouble())
                putDouble("unixTimeMs", st.unixTimeMs.toDouble())
                putDouble("latitude", st.latitude)
                putDouble("longitude", st.longitude)
                putDouble("eastOffsetM", st.eastOffsetM)
                putDouble("northOffsetM", st.northOffsetM)
                putDouble("headingDeg", st.headingDeg.toDouble())
                putDouble("speedMps", st.speedMps.toDouble())
                putDouble("cumulativeDistanceM", st.cumulativeDistanceM)
                putDouble("uncertaintyM", st.uncertaintyM.toDouble())
                putInt("stepCount", st.stepCount)
            }
            array.pushMap(m)
        }
        promise.resolve(array)
    }

    @ReactMethod
    fun resetTest(promise: Promise) {
        isBlackoutActive = false
        blackoutController.reset()
        promise.resolve(true)
    }

    private fun emitState(state: NavigationState, isBlackout: Boolean) {
        val map = Arguments.createMap().apply {
            putDouble("timestamp", state.unixTimeMs.toDouble())
            putDouble("latitude", state.latitude)
            putDouble("longitude", state.longitude)
            putDouble("estimatedLat", state.latitude)
            putDouble("estimatedLon", state.longitude)
            putDouble("eastOffsetM", state.eastOffsetM)
            putDouble("northOffsetM", state.northOffsetM)
            putDouble("headingDeg", state.headingDeg.toDouble())
            putDouble("speedMps", state.speedMps.toDouble())
            putDouble("speed", state.speedMps.toDouble())
            putDouble("heading", state.headingDeg.toDouble())
            putDouble("cumulativeDistanceM", state.cumulativeDistanceM)
            putDouble("uncertaintyM", state.uncertaintyM.toDouble())
            putDouble("uncertainty", state.uncertaintyM.toDouble())
            putInt("stepCount", state.stepCount)
            putBoolean("isStationary", state.isStationary)
            putBoolean("gnssAvailable", !isBlackout)
            putString("mode", if (isBlackout) "IDR" else "GNSS")
        }
        sendEvent("onIdrStateUpdate", map)
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stopLiveSensors()
        sensorHandlerThread.quitSafely()
    }
}
