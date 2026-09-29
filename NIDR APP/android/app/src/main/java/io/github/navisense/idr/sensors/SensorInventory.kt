package io.github.navisense.idr.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class SensorInventory(context: Context) {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    // All relevant physical motion, orientation, and environmental sensor types
    private val physicalSensorTypes = setOf(
        Sensor.TYPE_ACCELEROMETER,
        Sensor.TYPE_ACCELEROMETER_UNCALIBRATED,
        Sensor.TYPE_GYROSCOPE,
        Sensor.TYPE_GYROSCOPE_UNCALIBRATED,
        Sensor.TYPE_MAGNETIC_FIELD,
        Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED,
        Sensor.TYPE_GRAVITY,
        Sensor.TYPE_LINEAR_ACCELERATION,
        Sensor.TYPE_ROTATION_VECTOR,
        Sensor.TYPE_GAME_ROTATION_VECTOR,
        Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR,
        Sensor.TYPE_PRESSURE,
        Sensor.TYPE_AMBIENT_TEMPERATURE,
        Sensor.TYPE_STEP_DETECTOR,
        Sensor.TYPE_STEP_COUNTER,
        Sensor.TYPE_SIGNIFICANT_MOTION
    )

    fun getAvailablePhysicalSensors(): List<Sensor> {
        val allSensors = sensorManager.getSensorList(Sensor.TYPE_ALL)
        return allSensors.filter { it.type in physicalSensorTypes }
    }

    fun buildInventoryJson(): JSONObject {
        val root = JSONObject()
        root.put("deviceManufacturer", Build.MANUFACTURER)
        root.put("deviceModel", Build.MODEL)
        root.put("deviceHardware", Build.HARDWARE)
        root.put("androidRelease", Build.VERSION.RELEASE)
        root.put("sdkInt", Build.VERSION.SDK_INT)

        val sensorsArray = JSONArray()
        val sensors = getAvailablePhysicalSensors()

        for (s in sensors) {
            val sObj = JSONObject().apply {
                put("type", s.type)
                put("typeName", s.stringType ?: getSensorTypeName(s.type))
                put("name", s.name)
                put("vendor", s.vendor)
                put("version", s.version)
                put("power_mA", s.power.toDouble())
                put("resolution", s.resolution.toDouble())
                put("maximumRange", s.maximumRange.toDouble())
                put("minDelayUs", s.minDelay)
                put("maxDelayUs", s.maxDelay)
                put("isWakeUp", s.isWakeUpSensor)
                put("reportingMode", s.reportingMode)
            }
            sensorsArray.put(sObj)
        }

        root.put("totalPhysicalSensors", sensors.size)
        root.put("sensors", sensorsArray)
        return root
    }

    fun writeInventoryToFile(targetFile: File) {
        val json = buildInventoryJson()
        targetFile.writeText(json.toString(2))
    }

    companion object {
        fun getSensorTypeName(type: Int): String {
            return when (type) {
                Sensor.TYPE_ACCELEROMETER -> "accelerometer"
                Sensor.TYPE_ACCELEROMETER_UNCALIBRATED -> "accelerometer_uncalibrated"
                Sensor.TYPE_GYROSCOPE -> "gyroscope"
                Sensor.TYPE_GYROSCOPE_UNCALIBRATED -> "gyroscope_uncalibrated"
                Sensor.TYPE_MAGNETIC_FIELD -> "magnetometer"
                Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED -> "magnetometer_uncalibrated"
                Sensor.TYPE_GRAVITY -> "gravity"
                Sensor.TYPE_LINEAR_ACCELERATION -> "linear_acceleration"
                Sensor.TYPE_ROTATION_VECTOR -> "rotation_vector"
                Sensor.TYPE_GAME_ROTATION_VECTOR -> "game_rotation_vector"
                Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR -> "geomagnetic_rotation_vector"
                Sensor.TYPE_PRESSURE -> "barometer_pressure"
                Sensor.TYPE_AMBIENT_TEMPERATURE -> "ambient_temperature"
                Sensor.TYPE_STEP_DETECTOR -> "step_detector"
                Sensor.TYPE_STEP_COUNTER -> "step_counter"
                Sensor.TYPE_SIGNIFICANT_MOTION -> "significant_motion"
                else -> "sensor_type_" + type
            }
        }
    }
}
