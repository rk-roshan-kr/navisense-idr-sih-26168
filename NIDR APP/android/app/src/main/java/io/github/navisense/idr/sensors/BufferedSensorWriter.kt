package io.github.navisense.idr.sensors

import io.github.navisense.idr.models.SynchronizedImuFrame
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.io.IOException

class BufferedSensorWriter(file: File) {

    private val writer: BufferedWriter = BufferedWriter(FileWriter(file, false), 8192)
    private var sampleCount: Long = 0L

    init {
        try {
            writer.write(SynchronizedImuFrame.CSV_HEADER)
        } catch (e: IOException) {
            e.printStackTrace()
        }
    }

    @Synchronized
    fun writeFrame(frame: SynchronizedImuFrame) {
        try {
            writer.write(frame.toCsvLine())
            sampleCount++
        } catch (e: IOException) {
            e.printStackTrace()
        }
    }

    @Synchronized
    fun flush() {
        try {
            writer.flush()
        } catch (e: IOException) {
            e.printStackTrace()
        }
    }

    @Synchronized
    fun close(): Long {
        try {
            writer.flush()
            writer.close()
        } catch (e: IOException) {
            e.printStackTrace()
        }
        return sampleCount
    }

    fun getSampleCount(): Long = sampleCount
}
