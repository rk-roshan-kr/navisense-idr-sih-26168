package io.github.navisense.idr.storage

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import java.io.File

class SessionStorageModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val fileManager = SessionFileManager(reactContext)

    override fun getName(): String = "SessionStorageModule"

    @ReactMethod
    fun listSessions(promise: Promise) {
        try {
            val sessions = fileManager.listSessions()
            val array = Arguments.createArray()
            for (s in sessions) {
                val map = Arguments.createMap()
                for ((k, v) in s) {
                    when (v) {
                        is String -> map.putString(k, v)
                        is Int -> map.putInt(k, v)
                        is Long -> map.putDouble(k, v.toDouble())
                        is Double -> map.putDouble(k, v)
                        is Float -> map.putDouble(k, v.toDouble())
                        is Boolean -> map.putBoolean(k, v)
                    }
                }
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", e.message)
        }
    }

    @ReactMethod
    fun deleteSession(sessionId: String, promise: Promise) {
        try {
            val success = fileManager.deleteSession(sessionId)
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun exportSessionZip(sessionId: String, promise: Promise) {
        try {
            val zip = fileManager.exportSessionZip(sessionId)
            if (zip != null && zip.exists()) {
                promise.resolve(zip.absolutePath)
            } else {
                promise.reject("EXPORT_ERROR", "Failed to create session ZIP archive for " + sessionId)
            }
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun exportAllSessionsZip(promise: Promise) {
        try {
            val zip = fileManager.exportAllSessionsZip()
            if (zip != null && zip.exists()) {
                promise.resolve(zip.absolutePath)
            } else {
                promise.reject("EXPORT_ALL_ERROR", "No recorded sessions found to export")
            }
        } catch (e: Exception) {
            promise.reject("EXPORT_ALL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun shareSessionZip(sessionId: String, promise: Promise) {
        try {
            val zip = fileManager.exportSessionZip(sessionId)
            if (zip == null || !zip.exists()) {
                promise.reject("EXPORT_ERROR", "Could not create zip for sharing: " + sessionId)
                return
            }
            openShareSheet(zip)
            promise.resolve(zip.absolutePath)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun shareAllSessionsZip(promise: Promise) {
        try {
            val zip = fileManager.exportAllSessionsZip()
            if (zip == null || !zip.exists()) {
                promise.reject("EXPORT_ALL_ERROR", "No sessions available to share")
                return
            }
            openShareSheet(zip)
            promise.resolve(zip.absolutePath)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message)
        }
    }

    private fun openShareSheet(file: File) {
        val authority = reactContext.packageName + ".provider"
        val uri = FileProvider.getUriForFile(
            reactContext,
            authority,
            file
        )
        val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = android.content.ClipData.newRawUri("", uri)
            putExtra(Intent.EXTRA_SUBJECT, "NaviSense IDR Dataset: " + file.name)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val chooser = Intent.createChooser(shareIntent, "Share NaviSense Dataset ZIP").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        reactContext.startActivity(chooser)
    }

    @ReactMethod
    fun readSessionTrajectories(sessionId: String, promise: Promise) {
        try {
            val dir = fileManager.getSessionFolder(sessionId)
            if (dir == null) {
                promise.reject("NOT_FOUND", "Session not found")
                return
            }

            val gnssFile = File(dir, "gnss_canonical.csv")
            val gnssPoints = Arguments.createArray()
            if (gnssFile.exists()) {
                gnssFile.useLines { lines ->
                    lines.drop(1).forEach { line ->
                        val parts = line.split(",")
                        if (parts.size >= 7) {
                            val p = Arguments.createMap().apply {
                                putDouble("elapsedNanos", parts[0].toDoubleOrNull() ?: 0.0)
                                putDouble("unixTimeMs", parts[1].toDoubleOrNull() ?: 0.0)
                                putDouble("latitude", parts[2].toDoubleOrNull() ?: 0.0)
                                putDouble("longitude", parts[3].toDoubleOrNull() ?: 0.0)
                                putDouble("altitude", parts[4].toDoubleOrNull() ?: 0.0)
                                putDouble("speedMps", parts[5].toDoubleOrNull() ?: 0.0)
                                putDouble("bearingDeg", parts[6].toDoubleOrNull() ?: 0.0)
                            }
                            gnssPoints.pushMap(p)
                        }
                    }
                }
            }

            val result = Arguments.createMap().apply {
                putString("sessionId", sessionId)
                putArray("gnssPoints", gnssPoints)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message)
        }
    }
}
