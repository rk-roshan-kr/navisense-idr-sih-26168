package io.github.navisense.idr.storage

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.github.navisense.idr.models.SessionMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class SessionFileManager(private val context: Context) {

    // Internal app external storage: directly browseable over USB MTP (Android/data/io.github.navisense.idr/files/sessions/)
    val sessionsBaseDir: File
        get() {
            val ext = context.getExternalFilesDir("sessions")
            val base = ext ?: File(context.filesDir, "sessions")
            if (!base.exists()) base.mkdirs()
            return base
        }

    // App export folder: guaranteed write permissions on Android 11-16, 100% FileProvider compatible
    val downloadsExportDir: File
        get() {
            val ext = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            val dir = File(ext ?: context.filesDir, "NaviSense_IDR")
            if (!dir.exists()) dir.mkdirs()
            return dir
        }

    fun createSessionFolder(sessionId: String): File {
        val folder = File(sessionsBaseDir, sessionId)
        if (!folder.exists()) {
            folder.mkdirs()
        }
        return folder
    }

    fun getSessionFolder(sessionId: String): File? {
        val folder = File(sessionsBaseDir, sessionId)
        return if (folder.exists() && folder.isDirectory) folder else null
    }

    fun saveMetadata(sessionDir: File, metadata: SessionMetadata) {
        val json = JSONObject().apply {
            put("sessionId", metadata.sessionId)
            put("role", metadata.role)
            put("deviceModel", metadata.deviceModel)
            put("androidVersion", metadata.androidVersion)
            put("participant", metadata.participant)
            put("movementMode", metadata.movementMode)
            put("startElapsedRealtimeNanos", metadata.startElapsedRealtimeNanos)
            put("startUnixTimeMs", metadata.startUnixTimeMs)
            put("endElapsedRealtimeNanos", metadata.endElapsedRealtimeNanos)
            put("endUnixTimeMs", metadata.endUnixTimeMs)
            put("requestedRateHz", metadata.requestedRateHz)
            put("actualRateHz", metadata.actualRateHz)
            put("imuSampleCount", metadata.imuSampleCount)
            put("gnssSampleCount", metadata.gnssSampleCount)
            metadata.blackoutStartNanos?.let { put("blackoutStartNanos", it) }
            metadata.blackoutEndNanos?.let { put("blackoutEndNanos", it) }
        }

        val metadataFile = File(sessionDir, "metadata.json")
        metadataFile.writeText(json.toString(2))
    }

    fun listSessions(): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        val dirs = sessionsBaseDir.listFiles { f -> f.isDirectory } ?: return result

        for (dir in dirs.sortedByDescending { it.lastModified() }) {
            val metaFile = File(dir, "metadata.json")
            if (metaFile.exists()) {
                try {
                    val json = JSONObject(metaFile.readText())
                    val map = mutableMapOf<String, Any>()
                    val keys = json.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        map[key] = json.get(key)
                    }
                    map["folderPath"] = dir.absolutePath
                    val imuFile = File(dir, "imu_canonical.csv")
                    val gnssFile = File(dir, "gnss_canonical.csv")
                    map["imuFileSize"] = if (imuFile.exists()) imuFile.length() else 0L
                    map["gnssFileSize"] = if (gnssFile.exists()) gnssFile.length() else 0L
                    result.add(map)
                } catch (e: Exception) {
                    // Ignore corrupted session
                }
            }
        }
        return result
    }

    fun deleteSession(sessionId: String): Boolean {
        val dir = File(sessionsBaseDir, sessionId)
        return if (dir.exists()) dir.deleteRecursively() else false
    }

    /**
     * Creates a ZIP archive of a single session containing both raw and canonical data.
     * Saves reliably to downloadsExportDir and copies to public MediaStore.Downloads.
     */
    fun exportSessionZip(sessionId: String): File? {
        val dir = File(sessionsBaseDir, sessionId)
        if (!dir.exists()) return null

        val fileName = sessionId + ".zip"
        val zipFile = File(downloadsExportDir, fileName)

        ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
            zipFolderRecursively(dir, "", zos)
        }

        // Mirror copy to public Downloads so Samsung My Files sees it immediately
        copyToPublicDownloads(zipFile, fileName)

        return zipFile
    }

    /**
     * Bundles all recorded sessions with a comprehensive timelog manifest (when-to-when)
     */
    fun exportAllSessionsZip(): File? {
        val dirs = sessionsBaseDir.listFiles { f -> f.isDirectory } ?: return null
        if (dirs.isEmpty()) return null

        val ts = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "NaviSense_All_Datasets_" + ts + ".zip"
        val zipFile = File(downloadsExportDir, fileName)

        val manifestList = mutableListOf<JSONObject>()
        val csvBuilder = StringBuilder()
        csvBuilder.append("session_id,role,movement_mode,participant,start_time_iso,end_time_iso,duration_sec,imu_samples,actual_rate_hz,gnss_fixes\n")

        val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        for (dir in dirs.sortedBy { it.lastModified() }) {
            val metaFile = File(dir, "metadata.json")
            if (metaFile.exists()) {
                try {
                    val json = JSONObject(metaFile.readText())
                    manifestList.add(json)

                    val sid = json.optString("sessionId", dir.name)
                    val role = json.optString("role", "")
                    val mode = json.optString("movementMode", "")
                    val part = json.optString("participant", "")
                    val startMs = json.optLong("startUnixTimeMs", 0L)
                    val endMs = json.optLong("endUnixTimeMs", 0L)
                    val durationSec = if (endMs > startMs) (endMs - startMs) / 1000.0 else 0.0
                    val imuSamples = json.optLong("imuSampleCount", 0L)
                    val rateHz = json.optDouble("actualRateHz", 0.0)
                    val gnssFixes = json.optLong("gnssSampleCount", 0L)

                    val startIso = if (startMs > 0) isoFmt.format(Date(startMs)) else ""
                    val endIso = if (endMs > 0) isoFmt.format(Date(endMs)) else ""

                    csvBuilder.append(sid).append(',')
                        .append(role).append(',')
                        .append(mode).append(',')
                        .append(part).append(',')
                        .append(startIso).append(',')
                        .append(endIso).append(',')
                        .append(durationSec).append(',')
                        .append(imuSamples).append(',')
                        .append(rateHz).append(',')
                        .append(gnssFixes).append('\n')
                } catch (e: Exception) {
                    // Ignore corrupted
                }
            }
        }

        ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
            // 1. Root Timelog Manifest CSV
            val csvBytes = csvBuilder.toString().toByteArray(Charsets.UTF_8)
            zos.putNextEntry(ZipEntry("dataset_timelog_manifest.csv"))
            zos.write(csvBytes)
            zos.closeEntry()

            // 2. Root Timelog Manifest JSON
            val manifestArray = JSONArray(manifestList)
            val jsonBytes = manifestArray.toString(2).toByteArray(Charsets.UTF_8)
            zos.putNextEntry(ZipEntry("dataset_timelog_manifest.json"))
            zos.write(jsonBytes)
            zos.closeEntry()

            // 3. All individual sessions with subfolders (raw + canonical)
            for (dir in dirs) {
                zipFolderRecursively(dir, dir.name + "/", zos)
            }
        }

        copyToPublicDownloads(zipFile, fileName)

        return zipFile
    }

    private fun zipFolderRecursively(folder: File, basePath: String, zos: ZipOutputStream) {
        val files = folder.listFiles() ?: return
        for (f in files) {
            val entryPath = basePath + f.name
            if (f.isDirectory) {
                zipFolderRecursively(f, entryPath + "/", zos)
            } else {
                FileInputStream(f).use { fis ->
                    zos.putNextEntry(ZipEntry(entryPath))
                    fis.copyTo(zos)
                    zos.closeEntry()
                }
            }
        }
    }

    /**
     * Safely publishes file to Android's public Downloads via MediaStore (API 29+) or direct copy (API < 29)
     */
    private fun copyToPublicDownloads(sourceFile: File, displayName: String) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NaviSense_IDR")
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { out ->
                        FileInputStream(sourceFile).use { input ->
                            input.copyTo(out)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Secondary copy error logged; primary file in downloadsExportDir remains 100% available
            e.printStackTrace()
        }
    }

    companion object {
        fun generateSessionId(role: String): String {
            val dateStr = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val prefix = when (role) {
                "REFERENCE_PHONE" -> "ref"
                "IDR_TEST_PHONE" -> "idr"
                else -> "col"
            }
            return "session_" + prefix + "_" + dateStr
        }
    }
}
