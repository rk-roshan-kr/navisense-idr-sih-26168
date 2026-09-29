package io.github.navisense.idr.models

/**
 * Session metadata recorded at the start and end of every data collection or test session.
 */
data class SessionMetadata(
    val sessionId: String,
    val role: String, // "COLLECT", "REFERENCE_PHONE", or "IDR_TEST_PHONE"
    val deviceModel: String,
    val androidVersion: String,
    val participant: String,
    val movementMode: String, // "Walking", "Running", "Vehicle - Windshield", "Vehicle - Dashboard", "Vehicle - Cupholder"
    val startElapsedRealtimeNanos: Long,
    val startUnixTimeMs: Long,
    var endElapsedRealtimeNanos: Long = 0L,
    var endUnixTimeMs: Long = 0L,
    var requestedRateHz: Int = 100,
    var actualRateHz: Float = 0f,
    var imuSampleCount: Long = 0L,
    var gnssSampleCount: Long = 0L,
    var blackoutStartNanos: Long? = null,
    var blackoutEndNanos: Long? = null
)
