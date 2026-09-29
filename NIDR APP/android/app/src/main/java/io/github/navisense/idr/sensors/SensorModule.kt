package io.github.navisense.idr.sensors

import android.os.Build
import android.os.SystemClock
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.github.navisense.idr.models.SessionMetadata
import io.github.navisense.idr.models.SynchronizedImuFrame
import io.github.navisense.idr.service.SensorRecordingService
import io.github.navisense.idr.storage.SessionFileManager
import java.io.File
import kotlin.math.sqrt

class SensorModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val fileManager = SessionFileManager(reactContext)
    private var imuCollector: ImuCollector? = null
    private var rawSensorRecorder: RawSensorRecorder? = null
    private var sensorWriter: BufferedSensorWriter? = null
    private var currentMetadata: SessionMetadata? = null
    private var currentSessionDir: File? = null

    // Callback link to IDR engine
    var onFrameToEngineListener: ((SynchronizedImuFrame) -> Unit)? = null

    override fun getName(): String = "SensorModule"

    @ReactMethod
    fun startRecording(
        sessionId: String,
        movementMode: String,
        participant: String,
        role: String,
        promise: Promise
    ) {
        if (imuCollector != null) {
            promise.reject("ALREADY_RECORDING", "Sensor collection is already in progress")
            return
        }

        try {
            val sessionDir = fileManager.createSessionFolder(sessionId)
            currentSessionDir = sessionDir
            val imuFile = File(sessionDir, "imu_canonical.csv")
            val writer = BufferedSensorWriter(imuFile)
            sensorWriter = writer

            val startNanos = SystemClock.elapsedRealtimeNanos()
            val startUnix = System.currentTimeMillis()

            val metadata = SessionMetadata(
                sessionId = sessionId,
                role = role,
                deviceModel = Build.MANUFACTURER + " " + Build.MODEL,
                androidVersion = "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")",
                participant = participant,
                movementMode = movementMode,
                startElapsedRealtimeNanos = startNanos,
                startUnixTimeMs = startUnix
            )
            currentMetadata = metadata
            fileManager.saveMetadata(sessionDir, metadata)

            // Start foreground service for uninterrupted sensor polling
            SensorRecordingService.startService(reactContext, "Recording " + role + " (" + movementMode + ")")

            // 1. Start High-Rate Synchronized Canonical Collector
            val collector = ImuCollector(
                context = reactContext,
                writer = writer,
                onThrottledTelemetry = { frame, actualRate ->
                    val map = Arguments.createMap().apply {
                        putDouble("ax", frame.ax.toDouble())
                        putDouble("ay", frame.ay.toDouble())
                        putDouble("az", frame.az.toDouble())
                        putDouble("gx", frame.gx.toDouble())
                        putDouble("gy", frame.gy.toDouble())
                        putDouble("gz", frame.gz.toDouble())
                        putDouble("normA", sqrt(frame.ax * frame.ax + frame.ay * frame.ay + frame.az * frame.az).toDouble())
                        putDouble("actualRateHz", actualRate.toDouble())
                        putDouble("sampleCount", writer.getSampleCount().toDouble())
                        putDouble("unixTimeMs", frame.unixTimeMs.toDouble())
                    }
                    sendEvent("onSensorTelemetry", map)
                },
                onFrameToEngine = { frame ->
                    onFrameToEngineListener?.invoke(frame)
                }
            )
            collector.start()
            imuCollector = collector

            // 2. Start Raw Multi-Sensor Stream (Dynamically enumerates ALL physical sensors to raw_events/)
            val rawRecorder = RawSensorRecorder(reactContext, sessionDir)
            rawRecorder.start()
            rawSensorRecorder = rawRecorder

            promise.resolve(sessionId)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        val collector = imuCollector
        val rawRecorder = rawSensorRecorder
        val meta = currentMetadata
        val dir = currentSessionDir

        if (collector == null || meta == null || dir == null) {
            promise.reject("NOT_RECORDING", "No active sensor recording session found")
            return
        }

        try {
            val sampleCount = collector.stop()
            val actualRate = collector.getActualRateHz()
            val rawEventsCount = rawRecorder?.stop() ?: 0L

            meta.endElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
            meta.endUnixTimeMs = System.currentTimeMillis()
            meta.imuSampleCount = sampleCount
            meta.actualRateHz = actualRate

            fileManager.saveMetadata(dir, meta)

            SensorRecordingService.stopService(reactContext)

            imuCollector = null
            rawSensorRecorder = null
            sensorWriter = null
            currentMetadata = null
            currentSessionDir = null

            val map = Arguments.createMap().apply {
                putString("sessionId", meta.sessionId)
                putDouble("sampleCount", sampleCount.toDouble())
                putDouble("rawEventsCount", rawEventsCount.toDouble())
                putDouble("actualRateHz", actualRate.toDouble())
                putString("folderPath", dir.absolutePath)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getLiveStatus(promise: Promise) {
        val collector = imuCollector
        val map = Arguments.createMap().apply {
            putBoolean("isRecording", collector != null)
            putDouble("actualRateHz", collector?.getActualRateHz()?.toDouble() ?: 0.0)
            putDouble("sampleCount", sensorWriter?.getSampleCount()?.toDouble() ?: 0.0)
        }
        promise.resolve(map)
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }
}
