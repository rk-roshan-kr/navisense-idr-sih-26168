package io.github.navisense.idr.models

import org.json.JSONObject

/**
 * Validated Model Manifest loaded from assets/models/model_metadata.json.
 * Enforces tensor contract parity before running inference.
 */
data class ModelManifest(
    val modelName: String,
    val modelVersion: String = "1.0.0",
    val sampleRateHz: Int = 20,
    val windowLength: Int = 100,
    val inChannels: Int = 13,
    val channelNames: List<String>,
    val quaternionOrder: String = "wxyz",
    val coordinateConvention: String = "ENU",
    val validated40mDriftPct: Double = 100.0,
    val qualityGatePassed: Boolean = false,
    val approvedForDeployment: Boolean = false
) {
    fun validate(): ValidationResult {
        val errors = mutableListOf<String>()

        if (inChannels != 13) {
            errors.add("Incompatible channel count: expected 13, found $inChannels")
        }
        if (channelNames.size != 13) {
            errors.add("Incompatible channel names count: expected 13, found ${channelNames.size}")
        }
        val expectedChannels = listOf(
            "ax_body", "ay_body", "az_body",
            "gx_body", "gy_body", "gz_body",
            "ag_x_world", "ag_y_world", "ag_z_world",
            "qw", "qx", "qy", "qz"
        )
        if (channelNames != expectedChannels) {
            // Check alternate short names
            val altChannels = listOf(
                "ax", "ay", "az",
                "gx", "gy", "gz",
                "agx", "agy", "agz",
                "qw", "qx", "qy", "qz"
            )
            if (channelNames != altChannels) {
                errors.add("Channel names mismatch: expected $expectedChannels, got $channelNames")
            }
        }
        if (quaternionOrder.lowercase() != "wxyz") {
            errors.add("Quaternion order must be 'wxyz', found: $quaternionOrder")
        }
        if (coordinateConvention != "ENU") {
            errors.add("Coordinate convention must be 'ENU', found: $coordinateConvention")
        }
        if (sampleRateHz != 20 && sampleRateHz != 100) {
            errors.add("Unsupported sample rate: $sampleRateHz Hz (expected 20 Hz or 100 Hz)")
        }

        return if (errors.isEmpty()) {
            ValidationResult.Valid
        } else {
            ValidationResult.Invalid(errors)
        }
    }

    sealed class ValidationResult {
        object Valid : ValidationResult()
        data class Invalid(val errors: List<String>) : ValidationResult()
    }

    companion object {
        fun fromJson(jsonStr: String): ModelManifest {
            val json = JSONObject(jsonStr)

            val channelsArray = json.optJSONArray("channel_names") ?: json.optJSONArray("channels")
            val channelsList = mutableListOf<String>()
            if (channelsArray != null) {
                for (i in 0 until channelsArray.length()) {
                    channelsList.add(channelsArray.getString(i))
                }
            }

            return ModelManifest(
                modelName = json.optString("model_name", "NaviSense PDR-Net"),
                modelVersion = json.optString("model_version", "1.0.0"),
                sampleRateHz = json.optInt("output_rate_hz", json.optInt("sample_rate_hz", 20)),
                windowLength = json.optInt("window_length", 100),
                inChannels = json.optInt("in_channels", 13),
                channelNames = channelsList,
                quaternionOrder = json.optString("quaternion_order", "wxyz"),
                coordinateConvention = json.optString("coordinate_convention", "ENU"),
                validated40mDriftPct = json.optDouble("validated_40m_drift_pct", 100.0),
                qualityGatePassed = json.optBoolean("quality_gate_passed", false),
                approvedForDeployment = json.optBoolean("approved_for_deployment", false)
            )
        }
    }
}
