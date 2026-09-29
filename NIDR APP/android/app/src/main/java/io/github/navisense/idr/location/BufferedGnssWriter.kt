package io.github.navisense.idr.location

import io.github.navisense.idr.models.GnssFrame
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.io.IOException

class BufferedGnssWriter(file: File) {

    private val writer: BufferedWriter = BufferedWriter(FileWriter(file, false), 4096)
    private var fixCount: Long = 0L

    init {
        try {
            writer.write(GnssFrame.CSV_HEADER)
        } catch (e: IOException) {
            e.printStackTrace()
        }
    }

    @Synchronized
    fun writeFix(fix: GnssFrame) {
        try {
            writer.write(fix.toCsvLine())
            fixCount++
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
        return fixCount
    }

    fun getFixCount(): Long = fixCount
}
