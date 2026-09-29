package io.github.navisense.idr.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import io.github.navisense.idr.models.SynchronizedImuFrame

class ImuCollector(
    context: Context,
    private val writer: BufferedSensorWriter,
    private val onThrottledTelemetry: ((SynchronizedImuFrame, Float) -> Unit)? = null,
    private val onFrameToEngine: ((SynchronizedImuFrame) -> Unit)? = null
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private val accel: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyro: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val gravity: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)
    private val rotVector: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val mag: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)

    private val handlerThread = HandlerThread("ImuSensorThread", android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
    private val sensorHandler: Handler

    // Dual clock base alignment
    private var baseElapsedRealtimeNanos: Long = 0L
    private var baseUnixTimeMs: Long = 0L

    // Current synchronized channel cache
    @Volatile private var curAx = 0f; @Volatile private var curAy = 0f; @Volatile private var curAz = 0f
    @Volatile private var curGx = 0f; @Volatile private var curGy = 0f; @Volatile private var curGz = 0f
    @Volatile private var curGravX = 0f; @Volatile private var curGravY = 0f; @Volatile private var curGravZ = 0f
    @Volatile private var curQx = 0f; @Volatile private var curQy = 0f; @Volatile private var curQz = 0f; @Volatile private var curQw = 1f
    @Volatile private var curMagX = 0f; @Volatile private var curMagY = 0f; @Volatile private var curMagZ = 0f
    @Volatile private var curAccuracy = 3

    // Rate calculation and UI throttle
    private var totalFramesWritten = 0L
    private var startTimeNanos = 0L
    private var lastTelemetryEmitNanos = 0L
    private val TELEMETRY_INTERVAL_NANOS = 100_000_000L // 10 Hz (100 ms)

    init {
        handlerThread.start()
        sensorHandler = Handler(handlerThread.looper)
    }

    fun start(requestedDelayUs: Int = SensorManager.SENSOR_DELAY_FASTEST) {
        baseElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        baseUnixTimeMs = System.currentTimeMillis()
        startTimeNanos = baseElapsedRealtimeNanos

        accel?.let { sensorManager.registerListener(this, it, requestedDelayUs, sensorHandler) }
        gyro?.let { sensorManager.registerListener(this, it, requestedDelayUs, sensorHandler) }
        gravity?.let { sensorManager.registerListener(this, it, requestedDelayUs, sensorHandler) }
        rotVector?.let { sensorManager.registerListener(this, it, requestedDelayUs, sensorHandler) }
        mag?.let { sensorManager.registerListener(this, it, requestedDelayUs, sensorHandler) }
    }

    fun stop(): Long {
        sensorManager.unregisterListener(this)
        handlerThread.quitSafely()
        return writer.close()
    }

    override fun onSensorChanged(event: SensorEvent) {
        val nowRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        // Defensive synchronization: handle OEM HALs that don't align event.timestamp to elapsedRealtime
        val eventNanos = if (Math.abs(event.timestamp - nowRealtimeNanos) < 5_000_000_000L) {
            event.timestamp
        } else {
            nowRealtimeNanos
        }
        val eventUnixMs = baseUnixTimeMs + ((eventNanos - baseElapsedRealtimeNanos) / 1_000_000L)
        curAccuracy = event.accuracy

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
            Sensor.TYPE_GRAVITY -> {
                curGravX = event.values[0]
                curGravY = event.values[1]
                curGravZ = event.values[2]
            }
            Sensor.TYPE_ROTATION_VECTOR -> {
                val q = FloatArray(4)
                SensorManager.getQuaternionFromVector(q, event.values)
                curQw = q[0]
                curQx = q[1]
                curQy = q[2]
                curQz = q[3]
            }
            Sensor.TYPE_MAGNETIC_FIELD -> {
                curMagX = event.values[0]
                curMagY = event.values[1]
                curMagZ = event.values[2]
            }
        }

        // Primary trigger: emit on Accelerometer/Gyro update for canonical frame synchronization
        if (event.sensor.type == Sensor.TYPE_ACCELEROMETER || event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            val frame = SynchronizedImuFrame(
                elapsedRealtimeNanos = eventNanos,
                unixTimeMs = eventUnixMs,
                ax = curAx, ay = curAy, az = curAz,
                gx = curGx, gy = curGy, gz = curGz,
                gravityX = curGravX, gravityY = curGravY, gravityZ = curGravZ,
                rotQx = curQx, rotQy = curQy, rotQz = curQz, rotQw = curQw,
                magX = curMagX, magY = curMagY, magZ = curMagZ,
                accuracy = curAccuracy
            )

            // Direct native disk streaming (Zero JS bridge overhead)
            writer.writeFrame(frame)
            totalFramesWritten++

            // Feed IDR engine if active
            onFrameToEngine?.invoke(frame)

            // Throttled UI telemetry trigger (10 Hz)
            if (eventNanos - lastTelemetryEmitNanos >= TELEMETRY_INTERVAL_NANOS) {
                lastTelemetryEmitNanos = eventNanos
                val elapsedSec = (eventNanos - startTimeNanos) / 1_000_000_000f
                val actualRate = if (elapsedSec > 0f) totalFramesWritten / elapsedSec else 0f
                onThrottledTelemetry?.invoke(frame, actualRate)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        curAccuracy = accuracy
    }

    fun getActualRateHz(): Float {
        val elapsedSec = (SystemClock.elapsedRealtimeNanos() - startTimeNanos) / 1_000_000_000f
        return if (elapsedSec > 0f) totalFramesWritten / elapsedSec else 0f
    }
}
