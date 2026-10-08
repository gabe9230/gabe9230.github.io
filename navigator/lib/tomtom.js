// Scores a route's live traffic with the TomTom Routing API.
//
// We send the route's geometry as "supportingPoints", and TomTom rebuilds the
// same route on its map. With extendedRouteRepresentation=travelTime it
// returns the travel time (with live traffic, departing now) to points along
// the route; the time between two points gives the current speed on that
// stretch of road. TRAFFIC sections mark jams and road works.
// Docs: https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
// Free tier: 20,000 requests a month, no credit card.

import { pathLength, trimPath } from "./geo.js";
import { averageRoadSpeed } from "./scoring.js";
import { mph, TrafficError } from "./traffic.js";

export const TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute";

/** Keeps the request body small even for long routes. */
const MAX_SUPPORTING_POINTS = 20000;

/** Keeps at most `max` points, evenly spread, always keeping both ends. */
export function limitPoints(coords, max = MAX_SUPPORTING_POINTS) {
  if (coords.length <= max) {
    return coords;
  }
  const out = [];
  for (let i = 0; i < max - 1; i++) {
    out.push(coords[Math.round((i * (coords.length - 1)) / (max - 1))]);
  }
  out.push(coords.at(-1));
  return out;
}

/**
 * Builds the request that rebuilds a route from its geometry.
 * @param mode "update" follows the given points closely; "normal" allows
 *   TomTom some leeway, which can add detours where the maps disagree.
 */
export function buildRouteRequest(coords, apiKey, mode = "update") {
  const points = limitPoints(coords);
  const [startLat, startLng] = points[0];
  const [endLat, endLng] = points.at(-1);
  const url = new URL(
    `${TOMTOM_ROUTE_URL}/${startLat},${startLng}:${endLat},${endLng}/json`,
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("travelMode", "car");
  url.searchParams.set("traffic", "true");
  url.searchParams.set("computeTravelTimeFor", "all");
  url.searchParams.set("sectionType", "traffic");
  // In the "normal" mode, TomTom drives extra loops when OpenStreetMap and
  // TomTom model a road differently (one-way airport and campus roads, for
  // example), inflating the route by miles. "update" follows the given points
  // closely and still uses live traffic, but fails when a point lies on a road
  // TomTom cannot route on at all.
  url.searchParams.set("reconstructionMode", mode);
  url.searchParams.append("extendedRouteRepresentation", "distance");
  url.searchParams.append("extendedRouteRepresentation", "travelTime");
  return {
    url: String(url),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supportingPoints: points.map(([lat, lng]) => ({
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
        })),
      }),
    },
  };
}

/**
 * What to cut from the [start, end] of a route, in meters, when TomTom cannot
 * follow it. The trouble is usually at one end only, so that is tried first.
 */
const TRIMS = [
  [0, 0],
  [0, 1000],
  [1000, 0],
  [0, 3000],
  [3000, 0],
  [3000, 3000],
];

const cannotFollow = (err) =>
  err.status === 400 && /CANNOT_RESTORE_BASEROUTE/.test(err.message);

/**
 * Checks a route's live traffic with TomTom.
 *
 * TomTom fails to follow a route closely when a point lies on a road it cannot
 * route on, which happens at the ends of routes into airports, campuses and
 * parking areas. Then it tries again without the first or last kilometer or
 * three (reported as `trim` and `trimmedM`), and as a last resort lets TomTom
 * deviate from the route (reported as `approximate`).
 *
 * Routes between the same places tend to need the same trim, so a `trimHint`
 * from an earlier route is tried first.
 */
export async function checkRoute(
  coords,
  apiKey,
  fetchImpl = fetch,
  { trimHint = null } = {},
) {
  const totalM = pathLength(coords);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const trims = trimHint
    ? [trimHint, ...TRIMS.filter((trim) => !same(trim, trimHint))]
    : TRIMS;
  for (const trim of trims) {
    if (totalM - trim[0] - trim[1] < 1000) {
      continue;
    }
    const trimmed = trimPath(coords, trim[0], trim[1]);
    try {
      const result = await requestRoute(trimmed, apiKey, "update", fetchImpl);
      return { ...result, trim, trimmedM: totalM - pathLength(trimmed) };
    } catch (err) {
      if (!cannotFollow(err)) {
        throw err;
      }
    }
  }
  const result = await requestRoute(coords, apiKey, "normal", fetchImpl);
  return { ...result, approximate: true };
}

async function requestRoute(coords, apiKey, mode, fetchImpl) {
  const { url, init } = buildRouteRequest(coords, apiKey, mode);
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    throw new TrafficError("tomtom", 0, `Cannot reach TomTom (${err.message})`);
  }
  if (!response.ok) {
    throw new TrafficError("tomtom", response.status, await errorMessage(response));
  }
  return parseRoute(await response.json());
}

async function errorMessage(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.detailedError?.message ?? body.error?.description ?? "";
  } catch {
    // Not JSON.
  }
  switch (response.status) {
    case 401:
    case 403:
      return `TomTom rejected the API key${detail ? `: ${detail}` : ""}`;
    case 429:
      return "TomTom rate limit or monthly quota reached";
    default:
      return `TomTom error ${response.status}${detail ? `: ${detail}` : ""}`;
  }
}

/** Jam level of a TRAFFIC section, from TomTom's magnitude of delay. */
function sectionLevel({ magnitudeOfDelay, simpleCategory }) {
  // Magnitude 4 means "undefined", which TomTom uses for road works and
  // closures without a known delay.
  if (simpleCategory === "ROAD_CLOSURE" || magnitudeOfDelay === 3) {
    return "jam";
  }
  return "slow";
}

function sectionNote(section) {
  const parts = [
    {
      JAM: "Traffic jam",
      ROAD_WORK: "Road works",
      ROAD_CLOSURE: "Road closed",
    }[section.simpleCategory] ?? "Traffic",
  ];
  if (section.effectiveSpeedInKmh != null) {
    parts.push(`${mph(section.effectiveSpeedInKmh / 3.6)} mph`);
  }
  if (section.delayInSeconds > 0) {
    parts.push(`+${Math.max(1, Math.round(section.delayInSeconds / 60))} min`);
  }
  return parts.join(", ");
}

/** Turns a Calculate Route response into the shared traffic shape. */
export function parseRoute(json) {
  const route = json?.routes?.[0];
  if (!route?.summary || !route.legs?.length) {
    throw new TrafficError("tomtom", 200, "TomTom could not rebuild this route");
  }
  const summary = route.summary;
  const points = route.legs.flatMap((leg) =>
    (leg.points ?? []).map(({ latitude, longitude }) => [latitude, longitude]),
  );
  const lengthM = summary.lengthInMeters;
  const durationS = summary.travelTimeInSeconds;

  // Per-road speeds from the travel time to points along the route.
  const progress = (route.progress ?? [])
    .filter(
      (entry) =>
        entry.travelTimeInSeconds != null && Number.isInteger(entry.pointIndex),
    )
    .sort((a, b) => a.pointIndex - b.pointIndex);
  const stretches = [];
  for (let i = 1; i < progress.length; i++) {
    const a = progress[i - 1];
    const b = progress[i];
    const coords = points.slice(a.pointIndex, b.pointIndex + 1);
    const length =
      a.distanceInMeters != null && b.distanceInMeters != null
        ? b.distanceInMeters - a.distanceInMeters
        : pathLength(coords);
    const time = b.travelTimeInSeconds - a.travelTimeInSeconds;
    if (length > 0 && time > 0) {
      stretches.push({ coords, length, speed: length / time });
    }
  }
  // Without progress, the whole trip is one stretch.
  const avgSpeed =
    averageRoadSpeed(stretches) ??
    (lengthM > 0 && durationS > 0 ? lengthM / durationS : null);
  if (avgSpeed == null) {
    throw new TrafficError("tomtom", 200, "TomTom returned no travel times for this route");
  }

  const jams = (route.sections ?? [])
    .filter((section) => section.sectionType === "TRAFFIC")
    .map((section) => {
      const coords = points.slice(section.startPointIndex, section.endPointIndex + 1);
      return {
        coords,
        length: pathLength(coords),
        level: sectionLevel(section),
        note: sectionNote(section),
      };
    })
    .filter((jam) => jam.coords.length >= 2);
  const jammedLength = jams
    .filter((jam) => jam.level === "jam")
    .reduce((sum, jam) => sum + jam.length, 0);

  return {
    provider: "tomtom",
    approximate: false,
    trim: [0, 0],
    trimmedM: 0,
    lengthM,
    durationS,
    typicalDurationS: summary.historicTrafficTravelTimeInSeconds ?? null,
    baseDurationS: summary.noTrafficTravelTimeInSeconds ?? durationS,
    avgSpeed,
    jamShare: lengthM > 0 ? Math.min(1, jammedLength / lengthM) : 0,
    stretches,
    segments: [
      { coords: points, level: "free", note: "No reported traffic" },
      ...jams.map(({ coords, level, note }) => ({ coords, level, note })),
    ],
  };
}
