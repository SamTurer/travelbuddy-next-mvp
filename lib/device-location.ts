export type DeviceLocation = { lat: number; lng: number; label: string };

/** Browser geolocation. Call from a tap so iOS will show the permission prompt. */
export function requestBrowserLocation(): Promise<DeviceLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Your location',
        }),
      () => reject(new Error('Location permission was denied, or the phone could not find you.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 }
    );
  });
}
