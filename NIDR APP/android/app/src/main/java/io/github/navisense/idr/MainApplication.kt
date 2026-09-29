package io.github.navisense.idr

import android.app.Application
import android.os.Environment
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.shell.MainReactPackage
import com.facebook.soloader.SoLoader
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.util.Date

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> {
                return listOf(
                    MainReactPackage(),
                    NavisensePackage()
                )
            }

            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = false // Standalone APK mode without Metro dependency

            override val isNewArchEnabled: Boolean = false
            override val isHermesEnabled: Boolean = true
        }

    override fun onCreate() {
        super.onCreate()

        // Global crash defense: writes any fatal exception to disk for instant diagnosis
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val crashText = "=== NAVISENSE IDR CRASH REPORT ===\nTIME: ${Date()}\nTHREAD: ${thread.name}\nEXCEPTION:\n${sw}\n"

                val extDir = getExternalFilesDir(null)
                if (extDir != null) {
                    File(extDir, "CRASH_LOG.txt").writeText(crashText)
                }
                File(filesDir, "CRASH_LOG.txt").writeText(crashText)
            } catch (e: Exception) {
                // Secondary logging failure ignored
            }
            defaultHandler?.uncaughtException(thread, throwable)
        }

        SoLoader.init(this, false)
    }
}
