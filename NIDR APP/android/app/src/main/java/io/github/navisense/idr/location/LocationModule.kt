package io.github.navisense.idr.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.*
import io.github.navisense.idr.models.NavigationAnchor
import io.github.navisense.idr.storage.SessionFileManager
import org.json.JSONObject
import java.io.File

/**
 * Production High-Performance Location Module.
 *
 * Employs dual-engine location fetching:
 * 1. Primary: Google Play Services FusedLocationProviderClient (instant sub-second fixes via GPS + Wi-Fi + Cell)
 * 2. Secondary/Fallback: Native Android LocationManager (GPS_PROVIDER + NETWORK_PROVIDER + PASSIVE_PROVIDER)
 *
 * Runs 100% on-device with ZERO API keys required.
 */
class LocationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LocationListener {

    private val fileManager = SessionFileManager(reactContext)
    private val locationManager by lazy {
        reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    }
    private val fusedLocationClient: FusedLocationProviderClient by lazy {
        LocationServices.getFusedLocationProviderClient(reactContext)
    }

    @Volatile private var isTracking = false
    @Volatile private var latestLocation: Location? = null
    private var gnssCollector: GnssCollector? = null
    private var gnssWriter: BufferedGnssWriter? = null
    private var currentSessionId: String? = null
    private var currentSessionDir: File? = null

    private val fusedLocationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            handleLocationFix(location)
        }
    }

    override fun getName(): String = "LocationModule"

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun startLocationTracking(sessionId: String, promise: Promise) {
        if (isTracking) {
            promise.resolve(true)
            return
        }
        isTracking = true

        try {
            // 1. Immediately fetch last known location from Fused Location Provider
            fusedLocationClient.lastLocation
                .addOnSuccessListener { loc ->
                    if (loc != null) {
                        handleLocationFix(loc)
                    }
                }

            // 2. Request immediate one-shot high-accuracy current location
            try {
                fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                    .addOnSuccessListener { loc ->
                        if (loc != null) {
                            handleLocationFix(loc)
                        }
                    }
            } catch (e: Exception) {
                // Ignore fallback to regular updates
            }

            // 3. Register high-rate continuous location updates (1 Hz, 0m distance)
            val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
                .setMinUpdateIntervalMillis(500L)
                .setMinUpdateDistanceMeters(0f)
                .setWaitForAccurateLocation(false)
                .build()

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                fusedLocationCallback,
                Looper.getMainLooper()
            )

            // 4. Concurrent fallback: Also register native LocationManager providers
            val providers = mutableListOf<String>()
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                providers.add(LocationManager.GPS_PROVIDER)
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                providers.add(LocationManager.NETWORK_PROVIDER)
            }
            if (providers.isEmpty()) {
                providers.add(LocationManager.PASSIVE_PROVIDER)
            }

            for (provider in providers) {
                try {
                    locationManager.requestLocationUpdates(
                        provider,
                        1000L,
                        0f,
                        this,
                        Looper.getMainLooper()
                    )
                    val last = locationManager.getLastKnownLocation(provider)
                    if (last != null && latestLocation == null) {
                        handleLocationFix(last)
                    }
                } catch (e: Exception) {
                    // Ignore provider error
                }
            }

            // 5. Start optional background CSV raw collector for dataset recording
            try {
                val sessionDir = fileManager.createSessionFolder(sessionId)
                currentSessionId = sessionId
                currentSessionDir = sessionDir
                val gnssFile = File(sessionDir, "gnss_canonical.csv")
                val writer = BufferedGnssWriter(gnssFile)
                gnssWriter = writer

                val collector = GnssCollector(
                    context = reactContext,
                    sessionDir = sessionDir,
                    canonicalWriter = writer,
                    onFixReceived = { fix ->
                        // Canonical writer logging
                    }
                )
                collector.start()
                gnssCollector = collector
            } catch (e: Exception) {
                // Disk logging failure must never block live location streaming
                e.printStackTrace()
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("LOCATION_START_ERROR", e.message)
        }
    }

    private fun handleLocationFix(location: Location) {
        latestLocation = location

        val elapsedNanos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            location.elapsedRealtimeNanos
        } else {
            SystemClock.elapsedRealtimeNanos()
        }

        val map = Arguments.createMap().apply {
            putDouble("latitude", location.latitude)
            putDouble("longitude", location.longitude)
            putDouble("altitude", location.altitude)
            putDouble("speedMps", if (location.hasSpeed()) location.speed.toDouble() else 0.0)
            putDouble("bearingDeg", if (location.hasBearing()) location.bearing.toDouble() else 0.0)
            putDouble("accuracyM", if (location.hasAccuracy()) location.accuracy.toDouble() else 3.0)
            putDouble("unixTimeMs", location.time.toDouble())
            putDouble("elapsedRealtimeNanos", elapsedNanos.toDouble())
        }

        sendEvent("onLocationUpdate", map)
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun getLastKnownLocation(promise: Promise) {
        try {
            // First check memory cache
            val cached = latestLocation
            if (cached != null) {
                promise.resolve(buildLocationMap(cached))
                return
            }

            // Try FusedLocationProviderClient lastLocation
            fusedLocationClient.lastLocation
                .addOnSuccessListener { loc ->
                    if (loc != null) {
                        latestLocation = loc
                        promise.resolve(buildLocationMap(loc))
                    } else {
                        // Fallback to LocationManager
                        queryLocationManagerLastFix(promise)
                    }
                }
                .addOnFailureListener {
                    queryLocationManagerLastFix(promise)
                }
        } catch (e: Exception) {
            queryLocationManagerLastFix(promise)
        }
    }

    @SuppressLint("MissingPermission")
    private fun queryLocationManagerLastFix(promise: Promise) {
        try {
            val providers = mutableListOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                providers.add(0, LocationManager.FUSED_PROVIDER)
            }

            for (p in providers) {
                try {
                    val loc = locationManager.getLastKnownLocation(p)
                    if (loc != null) {
                        latestLocation = loc
                        promise.resolve(buildLocationMap(loc))
                        return
                    }
                } catch (e: Exception) {}
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    private fun buildLocationMap(loc: Location): WritableMap {
        val elapsedNanos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            loc.elapsedRealtimeNanos
        } else {
            SystemClock.elapsedRealtimeNanos()
        }
        return Arguments.createMap().apply {
            putDouble("latitude", loc.latitude)
            putDouble("longitude", loc.longitude)
            putDouble("altitude", loc.altitude)
            putDouble("speedMps", if (loc.hasSpeed()) loc.speed.toDouble() else 0.0)
            putDouble("bearingDeg", if (loc.hasBearing()) loc.bearing.toDouble() else 0.0)
            putDouble("accuracyM", if (loc.hasAccuracy()) loc.accuracy.toDouble() else 3.0)
            putDouble("unixTimeMs", loc.time.toDouble())
            putDouble("elapsedRealtimeNanos", elapsedNanos.toDouble())
        }
    }

    @ReactMethod
    fun softwareCutoff(promise: Promise) {
        try {
            isTracking = false
            fusedLocationClient.removeLocationUpdates(fusedLocationCallback)
            locationManager.removeUpdates(this)
            gnssCollector?.softwareCutoff()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CUTOFF_ERROR", e.message)
        }
    }

    @ReactMethod
    fun captureAnchor(promise: Promise) {
        val loc = latestLocation
        if (loc == null) {
            promise.reject("NO_FIX", "No valid GNSS fix available to establish anchor")
            return
        }

        val elapsedNanos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            loc.elapsedRealtimeNanos
        } else {
            SystemClock.elapsedRealtimeNanos()
        }

        val map = Arguments.createMap().apply {
            putDouble("latitude", loc.latitude)
            putDouble("longitude", loc.longitude)
            putDouble("altitude", loc.altitude)
            putDouble("initialHeadingDeg", if (loc.hasBearing()) loc.bearing.toDouble() else 0.0)
            putDouble("initialSpeedMps", if (loc.hasSpeed()) loc.speed.toDouble() else 0.0)
            putDouble("anchorAccuracyM", if (loc.hasAccuracy()) loc.accuracy.toDouble() else 3.0)
            putDouble("anchorUnixTimeMs", loc.time.toDouble())
            putDouble("anchorElapsedRealtimeNanos", elapsedNanos.toDouble())
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun stopLocationTracking(promise: Promise) {
        isTracking = false
        try {
            fusedLocationClient.removeLocationUpdates(fusedLocationCallback)
            locationManager.removeUpdates(this)

            val collector = gnssCollector
            val dir = currentSessionDir
            if (collector == null) {
                promise.resolve(0.0)
                return
            }

            val fixCount = collector.stop()
            gnssCollector = null
            gnssWriter = null
            currentSessionId = null
            currentSessionDir = null

            if (dir != null) {
                val metaFile = File(dir, "metadata.json")
                if (metaFile.exists()) {
                    try {
                        val json = JSONObject(metaFile.readText())
                        json.put("gnssSampleCount", fixCount)
                        metaFile.writeText(json.toString(2))
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }

            promise.resolve(fixCount.toDouble())
        } catch (e: Exception) {
            promise.reject("LOCATION_STOP_ERROR", e.message)
        }
    }

    // LocationListener interface callbacks for native LocationManager
    override fun onLocationChanged(location: Location) {
        handleLocationFix(location)
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }
}
