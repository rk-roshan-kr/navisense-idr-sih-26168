package io.github.navisense.idr.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class RawSensorRecorder(
    private val context: Context,
    private val sessionDir: File
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val inventory = SensorInventory(context)

    private val rawEventsDir = File(sessionDir, "raw_events").apply {
        if (!exists()) mkdirs()
    }

    private val handlerThread = HandlerThread("RawSensorThread", android.os.Process.THREAD_PRIORITY_MORE_FAVORABLE)
    private val sensorHandler: Handler

    private val writers = ConcurrentHashMap<Int, BufferedWriter>()
    val totalRawEventsLogged = AtomicLong(0L)

    private var baseElapsedRealtimeNanos: Long = 0L
    private var baseUnixTimeMs: Long = 0L

    init {
        handlerThread.start()
        sensorHandler = Handler(handlerThread.looper)
    }

    fun start(samplingPeriodUs: Int = SensorManager.SENSOR_DELAY_FASTEST) {
        baseElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        baseUnixTimeMs = System.currentTimeMillis()

        // Also write the hardware sensor inventory to this session
        inventory.writeInventoryToFile(File(sessionDir, "sensor_inventory.json"))

        val physicalSensors = inventory.getAvailablePhysicalSensors()
        for (sensor in physicalSensors) {
            val typeName = SensorInventory.getSensorTypeName(sensor.type)
            val csvFile = File(rawEventsDir, "raw_" + typeName + ".csv")
            val bw = BufferedWriter(FileWriter(csvFile, false), 32768)
            bw.write("elapsed_realtime_nanos,unix_time_ms,accuracy,val0,val1,val2,val3,val4,val5\n")
            writers[sensor.type] = bw

            sensorManager.registerListener(this, sensor, samplingPeriodUs, sensorHandler)
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        val nowRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        val eventNanos = if (Math.abs(event.timestamp - nowRealtimeNanos) < 5_000_000_000L) {
            event.timestamp
        } else {
            nowRealtimeNanos
        }
        val eventUnixMs = baseUnixTimeMs + ((eventNanos - baseElapsedRealtimeNanos) / 1_000_000L)

        val writer = writers[event.sensor.type] ?: return
        val sb = StringBuilder()
        sb.append(eventNanos).append(',')
        sb.append(eventUnixMs).append(',')
        sb.append(event.accuracy)

        val vals = event.values
        val len = vals.size
        for (i in 0 until 6) {
            sb.append(',')
            if (i < len) {
                sb.append(vals[i])
            }
        }
        sb.append('\n')

        synchronized(writer) {
            writer.write(sb.toString())
        }
        totalRawEventsLogged.incrementAndGet()
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        // Handled per-event
    }

    fun stop(): Long {
        sensorManager.unregisterListener(this)
        handlerThread.quitSafely()

        for ((_, writer) in writers) {
            try {
                synchronized(writer) {
                    writer.flush()
                    writer.close()
                }
            } catch (e: Exception) {
                // Ignore close errors
            }
        }
        writers.clear()
        return totalRawEventsLogged.get()
    }
}
