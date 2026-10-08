// Finds a diverse set of candidate routes with free OpenStreetMap routers,
// without traffic. HERE then scores them with live traffic.
//
// The routers are the FOSSGIS-hosted Valhalla and OSRM instances that
// openstreetmap.org uses. They are free for light use; a real app should
// host its own router.

import { decodePolyline, gridCells, pathSimilarity } from "./geo.js";

export const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";
export const OSRM_URL =
  "https://routing.openstreetmap.de/routed-car/route/v1/driving";

/** Routes that share more than this fraction of roads count as duplicates. */
const DUPLICATE_SIMILARITY = 0.9;

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}`);
  }
  return response.json();
}

function valhallaRoutes(json, label) {
  const trips = [json.trip, ...(json.alternates ?? []).map((alt) => alt.trip)];
  return trips
    .filter((trip) => trip?.legs?.length)
    .map((trip, i) => ({
      label: i === 0 ? label : `${label}, alternative ${i}`,
      coords: trip.legs.flatMap((leg) => decodePolyline(leg.shape, 6)),
      lengthM: trip.summary.length * 1000, // Requested in kilometers.
      durationS: trip.summary.time,
    }));
}

async function valhalla(from, to, extra, label, fetchImpl) {
  const query = {
    locations: [
      { lat: from[0], lon: from[1] },
      { lat: to[0], lon: to[1] },
    ],
    costing: "auto",
    directions_type: "none",
    units: "kilometers",
    ...extra,
  };
  const url = `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(query))}`;
  return valhallaRoutes(await getJson(url, fetchImpl), label);
}

async function osrm(from, to, fetchImpl) {
  const url =
    `${OSRM_URL}/${from[1]},${from[0]};${to[1]},${to[0]}` +
    `?alternatives=3&overview=full&geometries=geojson`;
  const json = await getJson(url, fetchImpl);
  return (json.routes ?? []).map((route, i) => ({
    label: i === 0 ? "OSRM fastest" : `OSRM alternative ${i}`,
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    lengthM: route.distance,
    durationS: route.duration,
  }));
}

/** Removes routes that follow almost the same roads as an earlier one. */
export function dedupeRoutes(routes, threshold = DUPLICATE_SIMILARITY) {
  const kept = [];
  for (const route of routes) {
    const cells = gridCells(route.coords);
    const duplicate = kept.find(
      (other) => pathSimilarity(cells, other.cells) >= threshold,
    );
    if (duplicate) {
      duplicate.alsoFoundBy.push(route.label);
    } else {
      kept.push({ ...route, cells, alsoFoundBy: [] });
    }
  }
  return kept.map(({ cells, ...route }) => route);
}

/**
 * Asks the routers for the fastest route, their alternatives, a route that
 * avoids highways and the shortest route, then keeps up to `limit` distinct
 * routes, fastest first.
 */
export async function findCandidates(
  from,
  to,
  { limit = 5, fetch: fetchImpl = fetch } = {},
) {
  const requests = [
    valhalla(from, to, { alternates: 2 }, "Fastest", fetchImpl),
    valhalla(
      from,
      to,
      { costing_options: { auto: { use_highways: 0 } } },
      "Fewer highways",
      fetchImpl,
    ),
    valhalla(
      from,
      to,
      { costing_options: { auto: { shortest: true } } },
      "Shortest",
      fetchImpl,
    ),
    osrm(from, to, fetchImpl),
  ];
  const settled = await Promise.allSettled(requests);
  const routes = settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .filter((route) => route.coords.length >= 2 && route.lengthM > 0);
  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? String(result.reason));
  if (routes.length === 0) {
    throw new Error(
      `No route found${errors.length ? ` (${errors.join("; ")})` : ""}`,
    );
  }
  routes.sort((a, b) => a.durationS - b.durationS);
  const candidates = dedupeRoutes(routes)
    .slice(0, limit)
    .map((route, i) => ({ ...route, id: i + 1 }));
  return { candidates, errors };
}
