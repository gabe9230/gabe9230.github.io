// Ranks candidate routes with the user's two knobs:
//
//   score = q * x + k * y
//
// q - trip length, normalized to [0, 1] so that SHORTER is better:
//     q = (shortest candidate length) / (this route's length).
//     The shortest route gets q = 1.
// k - average per-road speed, normalized to [0, 1] so that FASTER is better:
//     k = (this route's average road speed) / (best average road speed).
//     The route with the fastest-moving roads gets k = 1.
// x, y - the user's knobs in [0, 1]: how much trip length and road speed
//     matter. The highest score wins.
//
// The average per-road speed is the length-weighted mean of the speed on each
// stretch of road, so a long jammed stretch counts for more than a short one.

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/**
 * Length-weighted mean speed of road stretches.
 * @param {{length: number, speed: number | null}[]} stretches
 * @returns {number | null} meters per second, or null without speed data
 */
export function averageRoadSpeed(stretches) {
  let weighted = 0;
  let total = 0;
  for (const { length, speed } of stretches) {
    if (speed != null && speed > 0 && length > 0) {
      weighted += length * speed;
      total += length;
    }
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Scores and sorts routes, best first.
 * @param {{lengthM: number, avgSpeed: number, durationS?: number}[]} routes
 * @param {{x: number, y: number}} knobs
 */
export function scoreRoutes(routes, { x, y }) {
  const kx = clamp01(x);
  const ky = clamp01(y);
  const usable = routes.filter(
    (route) => route.lengthM > 0 && route.avgSpeed > 0,
  );
  if (usable.length === 0) {
    return [];
  }
  const shortest = Math.min(...usable.map((route) => route.lengthM));
  const fastest = Math.max(...usable.map((route) => route.avgSpeed));
  return usable
    .map((route) => {
      const q = shortest / route.lengthM;
      const k = route.avgSpeed / fastest;
      return { ...route, q, k, score: q * kx + k * ky };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.durationS ?? Infinity) - (b.durationS ?? Infinity),
    );
}
