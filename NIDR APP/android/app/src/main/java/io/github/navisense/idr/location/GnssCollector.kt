package io.github.navisense.idr.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.*
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import io.github.navisense.idr.models.GnssFrame
import io.github.navisense.idr.models.NavigationAnchor
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.util.concurrent.atomic.AtomicLong

class GnssCollector(
    context: Context,
    private val sessionDir: File,
    private val canonicalWriter: BufferedGnssWriter,
    private val onFixReceived: ((GnssFrame) -> Unit)? = null
) : LocationListener {

    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    @Volatile private var isCutoff = false
    @Volatile private var latestFix: GnssFrame? = null
    val fixCount = AtomicLong(0L)
    val rawMeasurementCount = AtomicLong(0L)

    private val handlerThread = HandlerThread("GnssRawThread", android.os.Process.THREAD_PRIORITY_BACKGROUND)
    private val gnssHandler: Handler

    // Detailed Raw Fixes File
    private val fixesWriter: BufferedWriter
    // Raw Satellite Measurements File (C/N0, pseudorange rate, carrier freq, ADR)
    private var rawMeasWriter: BufferedWriter? = null
    // Satellite Status File (elev, az, constellation, used in fix)
    private var statusWriter: BufferedWriter? = null

    private var gnssMeasurementsCallback: GnssMeasurementsEvent.Callback? = null
    private var gnssStatusCallback: GnssStatus.Callback? = null

    init {
        handlerThread.start()
        gnssHandler = Handler(handlerThread.looper)

        val fixesFile = File(sessionDir, "gnss_fixes.csv")
        fixesWriter = BufferedWriter(FileWriter(fixesFile, false), 16384)
        fixesWriter.write("elapsed_realtime_nanos,unix_time_ms,latitude,longitude,altitude,speed_mps,bearing_deg,accuracy_horizontal_m,accuracy_vertical_m,accuracy_speed_mps,accuracy_bearing_deg,provider\n")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val rawMeasFile = File(sessionDir, "gnss_raw_measurements.csv")
            rawMeasWriter = BufferedWriter(FileWriter(rawMeasFile, false), 32768)
            rawMeasWriter?.write("elapsed_realtime_nanos,time_nanos,full_bias_nanos,bias_nanos,svid,constellation,cn0_dbhz,pseudorange_rate_mps,pseudorange_rate_unc_mps,carrier_freq_hz,adr_m,adr_state,multipath\n")

            val statusFile = File(sessionDir, "gnss_status.csv")
            statusWriter = BufferedWriter(FileWriter(statusFile, false), 16384)
            statusWriter?.write("elapsed_realtime_nanos,svid,constellation,cn0_dbhz,elevation_deg,azimuth_deg,used_in_fix,carrier_freq_hz\n")
        }
    }

    @SuppressLint("MissingPermission")
    fun start(minTimeMs: Long = 1000L, minDistanceM: Float = 0f) {
        isCutoff = false

        // 1. Hardware GPS + Fused + Network concurrent updates
        val activeProviders = mutableListOf<String>()
        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            activeProviders.add(LocationManager.GPS_PROVIDER)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && locationManager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
            activeProviders.add(LocationManager.FUSED_PROVIDER)
        }
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            activeProviders.add(LocationManager.NETWORK_PROVIDER)
        }
        if (activeProviders.isEmpty()) {
            activeProviders.add(LocationManager.PASSIVE_PROVIDER)
        }

        for (provider in activeProviders) {
            try {
                locationManager.requestLocationUpdates(
                    provider,
                    minTimeMs,
                    minDistanceM,
                    this,
                    Looper.getMainLooper()
                )
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        // Seed with best last known location immediately so initial position is never lost
        for (provider in activeProviders) {
            try {
                val last = locationManager.getLastKnownLocation(provider)
                if (last != null && latestFix == null) {
                    onLocationChanged(last)
                    break
                }
            } catch (e: Exception) {
                // Ignore seed error
            }
        }

        // 2. Register Raw Satellite Measurements (API 24+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                val measCb = object : GnssMeasurementsEvent.Callback() {
                    override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
                        if (isCutoff) return
                        val nowNanos = SystemClock.elapsedRealtimeNanos()
                        val clock = event.clock
                        val timeNanos = clock.timeNanos
                        val fullBiasNanos = if (clock.hasFullBiasNanos()) clock.fullBiasNanos else 0L
                        val biasNanos = if (clock.hasBiasNanos()) clock.biasNanos else 0.0

                        val writer = rawMeasWriter ?: return
                        val sb = StringBuilder()
                        for (m in event.measurements) {
                            sb.append(nowNanos).append(',')
                                .append(timeNanos).append(',')
                                .append(fullBiasNanos).append(',')
                                .append(biasNanos).append(',')
                                .append(m.svid).append(',')
                                .append(getConstellationName(m.constellationType)).append(',')
                                .append(m.cn0DbHz).append(',')
                                .append(m.pseudorangeRateMetersPerSecond).append(',')
                                .append(m.pseudorangeRateUncertaintyMetersPerSecond).append(',')
                                .append(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && m.hasCarrierFrequencyHz()) m.carrierFrequencyHz else 0f).append(',')
                                .append(m.accumulatedDeltaRangeMeters).append(',')
                                .append(m.accumulatedDeltaRangeState).append(',')
                                .append(m.multipathIndicator).append('\n')
                            rawMeasurementCount.incrementAndGet()
                        }
                        synchronized(writer) {
                            try {
                                writer.write(sb.toString())
                            } catch (e: Exception) {
                                // Ignore buffer write
                            }
                        }
                    }
                }
                gnssMeasurementsCallback = measCb
                locationManager.registerGnssMeasurementsCallback(measCb, gnssHandler)
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // 3. Register Satellite Constellation Status
            try {
                val statCb = object : GnssStatus.Callback() {
                    override fun onSatelliteStatusChanged(status: GnssStatus) {
                        if (isCutoff) return
                        val nowNanos = SystemClock.elapsedRealtimeNanos()
                        val count = status.satelliteCount
                        val writer = statusWriter ?: return
                        val sb = StringBuilder()
                        for (i in 0 until count) {
                            val svid = status.getSvid(i)
                            val constellation = getConstellationName(status.getConstellationType(i))
                            val cn0 = status.getCn0DbHz(i)
                            val elev = status.getElevationDegrees(i)
                            val az = status.getAzimuthDegrees(i)
                            val used = status.usedInFix(i)
                            val freq = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && status.hasCarrierFrequencyHz(i)) status.getCarrierFrequencyHz(i) else 0f

                            sb.append(nowNanos).append(',')
                                .append(svid).append(',')
                                .append(constellation).append(',')
                                .append(cn0).append(',')
                                .append(elev).append(',')
                                .append(az).append(',')
                                .append(used).append(',')
                                .append(freq).append('\n')
                        }
                        synchronized(writer) {
                            try {
                                writer.write(sb.toString())
                            } catch (e: Exception) {
                                // Ignore
                            }
                        }
                    }
                }
                gnssStatusCallback = statCb
                locationManager.registerGnssStatusCallback(statCb, gnssHandler)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * Programmatic Software Blackout Gate.
     * Guaranteed to cutoff all location and satellite signals immediately.
     */
    fun softwareCutoff() {
        isCutoff = true
        try {
            locationManager.removeUpdates(this)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                gnssMeasurementsCallback?.let { locationManager.unregisterGnssMeasurementsCallback(it) }
                gnssStatusCallback?.let { locationManager.unregisterGnssStatusCallback(it) }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun stop(): Long {
        softwareCutoff()
        handlerThread.quitSafely()

        try {
            synchronized(fixesWriter) {
                fixesWriter.flush()
                fixesWriter.close()
            }
        } catch (e: Exception) {}

        try {
            rawMeasWriter?.let {
                synchronized(it) {
                    it.flush()
                    it.close()
                }
            }
        } catch (e: Exception) {}

        try {
            statusWriter?.let {
                synchronized(it) {
                    it.flush()
                    it.close()
                }
            }
        } catch (e: Exception) {}

        canonicalWriter.close()
        return fixCount.get()
    }

    override fun onLocationChanged(location: Location) {
        if (isCutoff) return

        val elapsedNanos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            location.elapsedRealtimeNanos
        } else {
            SystemClock.elapsedRealtimeNanos()
        }

        val frame = GnssFrame(
            elapsedRealtimeNanos = elapsedNanos,
            unixTimeMs = location.time,
            latitude = location.latitude,
            longitude = location.longitude,
            altitude = location.altitude,
            speedMps = if (location.hasSpeed()) location.speed else 0f,
            bearingDeg = if (location.hasBearing()) location.bearing else 0f,
            accuracyM = if (location.hasAccuracy()) location.accuracy else 0f
        )

        latestFix = frame
        canonicalWriter.writeFix(frame)
        fixCount.incrementAndGet()

        // Write full detailed fix row
        val vertAcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasVerticalAccuracy()) location.verticalAccuracyMeters else 0f
        val spdAcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond else 0f
        val brgAcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasBearingAccuracy()) location.bearingAccuracyDegrees else 0f

        val sb = StringBuilder()
        sb.append(elapsedNanos).append(',')
            .append(location.time).append(',')
            .append(location.latitude).append(',')
            .append(location.longitude).append(',')
            .append(location.altitude).append(',')
            .append(frame.speedMps).append(',')
            .append(frame.bearingDeg).append(',')
            .append(frame.accuracyM).append(',')
            .append(vertAcc).append(',')
            .append(spdAcc).append(',')
            .append(brgAcc).append(',')
            .append(location.provider ?: "unknown").append('\n')

        synchronized(fixesWriter) {
            try {
                fixesWriter.write(sb.toString())
            } catch (e: Exception) {
                // Ignore write error
            }
        }

        onFixReceived?.invoke(frame)
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    fun getLatestFix(): GnssFrame? = latestFix

    fun captureAnchor(): NavigationAnchor? {
        val fix = latestFix ?: return null
        if (fix.accuracyM > 25.0f && fix.accuracyM != 0f) return null

        return NavigationAnchor(
            anchorElapsedRealtimeNanos = fix.elapsedRealtimeNanos,
            anchorUnixTimeMs = fix.unixTimeMs,
            latitude = fix.latitude,
            longitude = fix.longitude,
            altitude = fix.altitude,
            initialHeadingDeg = fix.bearingDeg,
            initialSpeedMps = fix.speedMps,
            anchorAccuracyM = fix.accuracyM
        )
    }

    companion object {
        fun getConstellationName(type: Int): String {
            return when (type) {
                GnssStatus.CONSTELLATION_GPS -> "GPS"
                GnssStatus.CONSTELLATION_SBAS -> "SBAS"
                GnssStatus.CONSTELLATION_GLONASS -> "GLONASS"
                GnssStatus.CONSTELLATION_QZSS -> "QZSS"
                GnssStatus.CONSTELLATION_BEIDOU -> "BEIDOU"
                GnssStatus.CONSTELLATION_GALILEO -> "GALILEO"
                GnssStatus.CONSTELLATION_IRNSS -> "NAVIC"
                else -> "UNKNOWN_" + type
            }
        }
    }
}
