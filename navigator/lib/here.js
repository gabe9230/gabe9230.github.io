// Scores a route's live traffic with HERE Routing API v8 route import.
//
// We send the route's geometry as a "trace". HERE matches it to its map and
// returns, for every stretch of road (span), the current traffic speed and
// the free-flow speed. Without a departure time, HERE evaluates the route at
// the current time, which includes live traffic.
// Docs: https://docs.here.com/routing/reference/routing-api-v8-importroute

import { decodeFlexiblePolyline } from "./flexpolyline.js";
import { densify, pathLength } from "./geo.js";
import { averageRoadSpeed } from "./scoring.js";
import { levelForRatio, mph, TrafficError } from "./traffic.js";

export const HERE_IMPORT_URL = "https://router.hereapi.com/v8/import";

/** HERE accepts at most 50,000 trace points. */
const MAX_TRACE_POINTS = 45000;

export class HereError extends TrafficError {
  constructor(status, message) {
    super("here", status, message);
    this.name = "HereError";
  }
}

/** Builds the request for importing a route geometry. */
export function buildImportRequest(coords, apiKey) {
  const length = pathLength(coords);
  const step = Math.max(50, length / MAX_TRACE_POINTS);
  const trace = densify(coords, step).map(([lat, lng]) => ({
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  }));
  const url = new URL(HERE_IMPORT_URL);
  url.searchParams.set("transportMode", "car");
  url.searchParams.set("return", "polyline,summary,typicalDuration");
  url.searchParams.set("spans", "dynamicSpeedInfo,length");
  url.searchParams.set("apiKey", apiKey);
  return {
    url: String(url),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trace }),
    },
  };
}

/** Imports a route into HERE and returns its traffic summary. */
export async function importRoute(coords, apiKey, fetchImpl = fetch) {
  const { url, init } = buildImportRequest(coords, apiKey);
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    throw new HereError(0, `Cannot reach HERE (${err.message})`);
  }
  if (!response.ok) {
    throw new HereError(response.status, await errorMessage(response));
  }
  return parseImport(await response.json());
}

async function errorMessage(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail =
      body.title ?? body.error_description ?? body.cause ?? body.error ?? "";
  } catch {
    // Not JSON.
  }
  switch (response.status) {
    case 401:
    case 403:
      return `HERE rejected the API key${detail ? `: ${detail}` : ""}`;
    case 429:
      return "HERE rate limit or monthly quota reached";
    default:
      return `HERE error ${response.status}${detail ? `: ${detail}` : ""}`;
  }
}

/**
 * Turns an import response into a traffic summary.
 * Totals are summed over all sections of all returned routes, because HERE
 * may split an imported trace into several parts.
 */
export function parseImport(json) {
  const sections = (json?.routes ?? []).flatMap((route) => route.sections ?? []);
  if (sections.length === 0) {
    throw new HereError(200, "HERE could not match this route to its map");
  }
  let lengthM = 0;
  let durationS = 0;
  let baseDurationS = 0;
  let typicalDurationS = 0;
  let hasTypical = true;
  const spans = [];
  for (const section of sections) {
    const summary = section.summary ?? {};
    lengthM += summary.length ?? 0;
    durationS += summary.duration ?? 0;
    baseDurationS += summary.baseDuration ?? summary.duration ?? 0;
    if (summary.typicalDuration == null) {
      hasTypical = false;
    } else {
      typicalDurationS += summary.typicalDuration;
    }
    const points = section.polyline
      ? decodeFlexiblePolyline(section.polyline).map(([lat, lng]) => [lat, lng])
      : [];
    const sectionSpans = section.spans ?? [];
    sectionSpans.forEach((span, i) => {
      // A span runs from its offset to the next span's offset.
      const end =
        i + 1 < sectionSpans.length
          ? sectionSpans[i + 1].offset
          : points.length - 1;
      const coords = points.slice(span.offset ?? 0, end + 1);
      const info = span.dynamicSpeedInfo ?? {};
      spans.push({
        coords,
        length: span.length ?? pathLength(coords),
        trafficSpeed: info.trafficSpeed ?? null,
        baseSpeed: info.baseSpeed ?? null,
      });
    });
  }
  const avgSpeed = averageRoadSpeed(
    spans.map(({ length, trafficSpeed }) => ({ length, speed: trafficSpeed })),
  );
  const avgFreeFlowSpeed = averageRoadSpeed(
    spans.map(({ length, baseSpeed }) => ({ length, speed: baseSpeed })),
  );
  if (avgSpeed == null) {
    throw new HereError(200, "HERE returned no road speeds for this route");
  }
  const ratio = ({ trafficSpeed, baseSpeed }) =>
    trafficSpeed != null && baseSpeed > 0 ? trafficSpeed / baseSpeed : null;
  const jammedLength = spans
    .filter((span) => levelForRatio(ratio(span)) === "jam")
    .reduce((sum, span) => sum + span.length, 0);
  const totalLength = spans.reduce((sum, span) => sum + span.length, 0);
  return {
    provider: "here",
    lengthM,
    durationS,
    baseDurationS,
    typicalDurationS: hasTypical ? typicalDurationS : null,
    avgSpeed,
    avgFreeFlowSpeed,
    jamShare: totalLength > 0 ? jammedLength / totalLength : 0,
    spans,
    segments: spans
      .filter((span) => span.coords.length >= 2)
      .map((span) => ({
        coords: span.coords,
        level: levelForRatio(ratio(span)),
        note:
          span.trafficSpeed != null
            ? `${mph(span.trafficSpeed)} mph now` +
              (span.baseSpeed > 0
                ? ` (${mph(span.baseSpeed)} mph without traffic)`
                : "")
            : "No traffic data",
      })),
  };
}

/** Same interface as the TomTom client. */
export const checkRoute = importRoute;
