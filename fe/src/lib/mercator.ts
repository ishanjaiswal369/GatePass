/**
 * Web Mercator, the projection every slippy map uses.
 *
 * Only what a pin picker needs: turning a pixel offset from the centre of a
 * map image into a change in latitude and longitude. Longitude is linear in
 * this projection, latitude is not -- a pixel near the equator covers more
 * ground north to south than the same pixel near a pole, which is why the two
 * axes cannot share one formula.
 */

/** Tile size every provider builds its zoom levels from. */
const TILE_SIZE = 256;

/** Width of the whole world, in logical pixels, at this zoom. */
function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Latitude to its 0..1 position down the Mercator world. */
function latitudeToWorldY(latitude: number): number {
  // Clamped: Mercator sends the poles to infinity, and a map image cannot
  // show them anyway.
  const clamped = Math.max(Math.min(latitude, 85.05112878), -85.05112878);
  const sin = Math.sin((clamped * Math.PI) / 180);

  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function worldYToLatitude(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;

  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Where a point lands after moving it by a pixel offset on screen.
 *
 * dx is positive to the right, dy positive downwards -- screen coordinates,
 * so moving down decreases latitude.
 */
export function offsetByPixels(
  centre: { latitude: number; longitude: number },
  offset: { dx: number; dy: number },
  zoom: number
): { latitude: number; longitude: number } {
  const size = worldSize(zoom);

  const longitude = centre.longitude + (offset.dx / size) * 360;
  const latitude = worldYToLatitude(
    latitudeToWorldY(centre.latitude) + offset.dy / size
  );

  return {
    // Six decimals is about 0.1m, well past what a pin on a driveway means.
    latitude: Number(latitude.toFixed(6)),
    // Wrapped into [-180, 180) so dragging across the date line stays valid.
    longitude: Number(((((longitude + 540) % 360) - 180)).toFixed(6)),
  };
}

/** Metres per logical pixel at a latitude and zoom, for a scale hint. */
export function metresPerPixel(latitude: number, zoom: number): number {
  const EQUATOR_METRES = 40075016.686;

  return (
    (EQUATOR_METRES * Math.cos((latitude * Math.PI) / 180)) / worldSize(zoom)
  );
}
