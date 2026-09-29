import { Alert, PermissionsAndroid, Platform } from 'react-native';

/**
 * Requests all required Android runtime permissions for NaviSense IDR:
 * - ACCESS_FINE_LOCATION (Satellite GNSS)
 * - ACCESS_COARSE_LOCATION
 * - POST_NOTIFICATIONS (Android 13+ Foreground Service indicator)
 */
export async function requestCorePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const permissionsToRequest = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ];

    // Android 13+ (API 33+) requires notification permission for foreground services
    if (Platform.Version >= 33) {
      permissionsToRequest.push('android.permission.POST_NOTIFICATIONS' as any);
    }

    const results = await PermissionsAndroid.requestMultiple(permissionsToRequest);

    const fineGranted =
      results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const coarseGranted =
      results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;

    if (!fineGranted && !coarseGranted) {
      Alert.alert(
        'Location Permission Required',
        'NaviSense IDR requires Fine Location permission to acquire GNSS reference fixes for dead-reckoning calibration and evaluation.',
        [{ text: 'OK' }]
      );
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Error requesting permissions:', err);
    return false;
  }
}
