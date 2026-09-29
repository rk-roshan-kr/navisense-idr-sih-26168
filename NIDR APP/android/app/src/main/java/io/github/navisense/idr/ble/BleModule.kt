package io.github.navisense.idr.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Bluetooth LE module dedicated SOLELY to pre-test session handshake and clock synchronization.
 * INVARIANT: At blackout trigger, BLE is strictly disconnected. Zero location data may cross BLE.
 */
class BleModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val bluetoothManager by lazy {
        try {
            reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        } catch (e: Exception) {
            null
        }
    }
    private val bluetoothAdapter: BluetoothAdapter?
        get() = try {
            bluetoothManager?.adapter
        } catch (e: Exception) {
            null
        }
    private var bleAdvertiser: BluetoothLeAdvertiser? = null
    private var bleScanner: BluetoothLeScanner? = null

    private val SERVICE_UUID: UUID = UUID.fromString("0000fe90-0000-1000-8000-00805f9b34fb")
    private val SYNC_CHAR_UUID: UUID = UUID.fromString("0000fe91-0000-1000-8000-00805f9b34fb")

    override fun getName(): String = "BleModule"

    @ReactMethod
    fun startAdvertising(sessionId: String, promise: Promise) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            promise.reject("BLE_DISABLED", "Bluetooth is disabled or not supported")
            return
        }

        bleAdvertiser = adapter.bluetoothLeAdvertiser
        if (bleAdvertiser == null) {
            promise.reject("BLE_ADV_UNAVAILABLE", "BLE advertising not supported on this device")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .addServiceData(ParcelUuid(SERVICE_UUID), sessionId.toByteArray(StandardCharsets.UTF_8).take(8).toByteArray())
            .build()

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                promise.resolve(true)
            }

            override fun onStartFailure(errorCode: Int) {
                promise.reject("ADV_FAIL", "Advertising failed with code $errorCode")
            }
        }

        try {
            bleAdvertiser?.startAdvertising(settings, data, callback)
        } catch (e: SecurityException) {
            promise.reject("PERMISSION_DENIED", e.message)
        }
    }

    @ReactMethod
    fun startScanning(promise: Promise) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            promise.reject("BLE_DISABLED", "Bluetooth is disabled")
            return
        }

        bleScanner = adapter.bluetoothLeScanner
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                val device = result?.device ?: return
                val map = Arguments.createMap().apply {
                    putString("address", device.address)
                    putString("name", device.name ?: "Unknown")
                    putInt("rssi", result.rssi)
                }
                sendEvent("onBlePeerDiscovered", map)
            }
        }

        try {
            bleScanner?.startScan(listOf(filter), settings, callback)
            promise.resolve(true)
        } catch (e: SecurityException) {
            promise.reject("PERMISSION_DENIED", e.message)
        }
    }

    /**
     * Strict Blackout Enforcement: Shuts down all BLE radios and callbacks.
     */
    @ReactMethod
    fun disconnect(promise: Promise) {
        try {
            bleScanner?.stopScan(object : ScanCallback() {})
            bleScanner = null
            bleAdvertiser = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }
}
