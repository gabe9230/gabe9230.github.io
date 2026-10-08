// Small geometry helpers. Coordinates are [lat, lng] pairs in degrees.

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in meters. */
export function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Total length of a path, in meters. */
export function pathLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Inserts points so that consecutive points are at most `maxStep` meters
 * apart. HERE matches dense traces more reliably than sparse ones.
 */
export function densify(coords, maxStep = 50) {
  if (coords.length < 2) {
    return coords.slice();
  }
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const steps = Math.ceil(haversine(coords[i - 1], coords[i]) / maxStep);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t]);
    }
    out.push(coords[i]);
  }
  return out;
}

/**
 * Removes about `startM` meters from the start of a path and `endM` meters
 * from its end, at vertex boundaries.
 */
export function trimPath(coords, startM, endM) {
  let start = 0;
  for (let run = 0; start < coords.length - 1 && run < startM; start++) {
    run += haversine(coords[start], coords[start + 1]);
  }
  let end = coords.length - 1;
  for (let run = 0; end > start && run < endM; end--) {
    run += haversine(coords[end - 1], coords[end]);
  }
  return coords.slice(start, end + 1);
}

/**
 * Decodes a Google-style encoded polyline, as returned by Valhalla
 * (precision 6) or OSRM (precision 5).
 */
export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const deltas = [];
    for (let n = 0; n < 2; n++) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        if (index >= encoded.length) {
          throw new Error("Invalid encoded polyline");
        }
        byte = encoded.charCodeAt(index++) - 63;
        result += (byte & 0x1f) * 2 ** shift;
        shift += 5;
      } while (byte >= 0x20);
      deltas.push(result % 2 === 1 ? -(result + 1) / 2 : result / 2);
    }
    lat += deltas[0];
    lng += deltas[1];
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

/**
 * The set of grid cells (about `cellDeg` degrees wide) a path passes through.
 * Used to tell whether two routes follow mostly the same roads.
 */
export function gridCells(coords, cellDeg = 0.001) {
  const cells = new Set();
  for (const [lat, lng] of densify(coords, 40)) {
    cells.add(`${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`);
  }
  return cells;
}

/** Jaccard similarity of two paths' grid cells, from 0 (disjoint) to 1. */
export function pathSimilarity(a, b) {
  const cellsA = a instanceof Set ? a : gridCells(a);
  const cellsB = b instanceof Set ? b : gridCells(b);
  let shared = 0;
  for (const cell of cellsA) {
    if (cellsB.has(cell)) {
      shared += 1;
    }
  }
  const union = cellsA.size + cellsB.size - shared;
  return union === 0 ? 1 : shared / union;
}
