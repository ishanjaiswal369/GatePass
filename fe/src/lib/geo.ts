/** Straight-line distance between two points, in km (haversine). */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "300 m" under a kilometre, "1.4 km" above -- and 998 m, which rounds up, is "1.0 km", not "1000 m". */
export function distanceLabel(km: number): string {
  const metres = Math.max(50, Math.round((km * 1000) / 50) * 50);
  return metres < 1000 ? `${metres} m` : `${km.toFixed(1)} km`;
}
