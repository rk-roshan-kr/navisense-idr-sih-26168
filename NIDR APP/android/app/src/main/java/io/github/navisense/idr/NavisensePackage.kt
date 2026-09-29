package io.github.navisense.idr

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import io.github.navisense.idr.ble.BleModule
import io.github.navisense.idr.idr.IdrModule
import io.github.navisense.idr.location.LocationModule
import io.github.navisense.idr.sensors.SensorModule
import io.github.navisense.idr.storage.SessionStorageModule

class NavisensePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            SensorModule(reactContext),
            LocationModule(reactContext),
            IdrModule(reactContext),
            BleModule(reactContext),
            SessionStorageModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
