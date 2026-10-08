import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dedupeRoutes, findCandidates } from "../lib/candidates.js";
import { haversine } from "../lib/geo.js";
import {
  buildImportRequest,
  HereError,
  importRoute,
  parseImport,
} from "../lib/here.js";
import { encodeFlexiblePolyline, encodePolyline, fakeFetch } from "./helpers.js";

const A = [41.8789, -87.6359];
const B = [41.9742, -87.9073];

// A straight line from A to B, and a dog-leg through a different area.
const direct = [A, [41.92, -87.75], B];
const detour = [A, [41.95, -87.65], [41.98, -87.8], B];

function valhallaTrip(coords, lengthKm, time) {
  return {
    legs: [{ shape: encodePolyline(coords, 6) }],
    summary: { length: lengthKm, time },
  };
}

describe("candidates", () => {
  test("collects, deduplicates and orders routes from both routers", async () => {
    const fetchImpl = fakeFetch([
      [
        "valhalla",
        (url) => {
          const query = JSON.parse(
            decodeURIComponent(new URL(url).searchParams.get("json")),
          );
          if (query.costing_options?.auto?.use_highways === 0) {
            return { trip: valhallaTrip(detour, 40, 3000) };
          }
          if (query.costing_options?.auto?.shortest) {
            return { trip: valhallaTrip(direct, 30, 2600) };
          }
          return {
            trip: valhallaTrip(direct, 30, 2500),
            alternates: [{ trip: valhallaTrip(detour, 41, 2900) }],
          };
        },
      ],
      [
        "routed-car",
        () => ({
          code: "Ok",
          routes: [
            {
              distance: 30100,
              duration: 2550,
              geometry: {
                coordinates: direct.map(([lat, lng]) => [lng, lat]),
              },
            },
          ],
        }),
      ],
    ]);

    const { candidates, errors } = await findCandidates(A, B, {
      fetch: fetchImpl,
    });

    assert.deepEqual(errors, []);
    assert.equal(fetchImpl.calls.length, 4);
    // Three direct routes collapse into one; two detours into another.
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].label, "Fastest");
    assert.equal(candidates[0].lengthM, 30000);
    assert.deepEqual(candidates[0].alsoFoundBy, ["OSRM fastest", "Shortest"]);
    assert.equal(candidates[1].label, "Fastest, alternative 1");
    assert.deepEqual(candidates[1].alsoFoundBy, ["Fewer highways"]);
    assert.deepEqual(
      candidates.map((c) => c.id),
      [1, 2],
    );
  });

  test("keeps going when one router fails", async () => {
    const fetchImpl = fakeFetch([
      ["valhalla", () => new Response("busy", { status: 503 })],
      [
        "routed-car",
        () => ({
          code: "Ok",
          routes: [
            {
              distance: 30100,
              duration: 2550,
              geometry: {
                coordinates: direct.map(([lat, lng]) => [lng, lat]),
              },
            },
          ],
        }),
      ],
    ]);

    const { candidates, errors } = await findCandidates(A, B, {
      fetch: fetchImpl,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].label, "OSRM fastest");
    assert.equal(errors.length, 3);
    assert.match(errors[0], /503/);
  });

  test("fails when no router answers", async () => {
    const fetchImpl = fakeFetch([
      [
        "openstreetmap.de",
        () => {
          throw new TypeError("Failed to fetch");
        },
      ],
    ]);

    await assert.rejects(
      findCandidates(A, B, { fetch: fetchImpl }),
      /No route found/,
    );
  });

  test("respects the limit", async () => {
    const routes = Array.from({ length: 6 }, (_, i) => ({
      label: `Route ${i}`,
      coords: [A, [41.9 + i * 0.02, -87.7 - i * 0.05], B],
      lengthM: 30000 + i,
      durationS: 2500 + i,
    }));
    assert.equal(dedupeRoutes(routes).length, 6);
  });
});

describe("HERE import", () => {
  test("builds a dense trace and asks for per-road speeds", () => {
    const { url, init } = buildImportRequest(direct, "KEY");
    const params = new URL(url).searchParams;

    assert.equal(params.get("transportMode"), "car");
    assert.equal(params.get("spans"), "dynamicSpeedInfo,length");
    assert.match(params.get("return"), /summary/);
    assert.equal(params.get("apiKey"), "KEY");
    assert.equal(params.get("departureTime"), null); // Now, with live traffic.
    assert.equal(init.method, "POST");
    const { trace } = JSON.parse(init.body);
    assert.deepEqual(trace[0], { lat: A[0], lng: A[1] });
    assert.deepEqual(trace.at(-1), { lat: B[0], lng: B[1] });
    for (let i = 1; i < trace.length; i++) {
      const a = [trace[i - 1].lat, trace[i - 1].lng];
      const b = [trace[i].lat, trace[i].lng];
      assert.ok(haversine(a, b) <= 51);
    }
  });

  const points = [
    [41.8789, -87.6359],
    [41.885, -87.65],
    [41.89, -87.67],
    [41.9, -87.7],
  ];
  const response = {
    routes: [
      {
        id: "r1",
        sections: [
          {
            summary: {
              length: 6000,
              duration: 900,
              baseDuration: 500,
              typicalDuration: 700,
            },
            polyline: encodeFlexiblePolyline(points),
            spans: [
              {
                offset: 0,
                length: 4000,
                dynamicSpeedInfo: { trafficSpeed: 4, baseSpeed: 15 },
              },
              {
                offset: 2,
                length: 2000,
                dynamicSpeedInfo: { trafficSpeed: 13, baseSpeed: 14 },
              },
            ],
          },
        ],
      },
    ],
  };

  test("parses totals and per-road speeds", () => {
    const result = parseImport(response);

    assert.equal(result.lengthM, 6000);
    assert.equal(result.durationS, 900);
    assert.equal(result.baseDurationS, 500);
    assert.equal(result.typicalDurationS, 700);
    // (4000 * 4 + 2000 * 13) / 6000 = 7 m/s.
    assert.equal(result.avgSpeed, 7);
    assert.equal(result.avgFreeFlowSpeed, (4000 * 15 + 2000 * 14) / 6000);
    assert.equal(result.spans.length, 2);
    assert.equal(result.spans[0].coords.length, 3); // Points 0, 1, 2.
    assert.equal(result.spans[1].coords.length, 2); // Points 2, 3.
    assert.equal(result.spans[0].trafficSpeed, 4);
    // 4 of 15 m/s is a jam; 13 of 14 m/s is moving freely.
    assert.equal(result.provider, "here");
    assert.deepEqual(
      result.segments.map((segment) => segment.level),
      ["jam", "free"],
    );
    assert.equal(result.segments[0].note, "9 mph now (34 mph without traffic)");
    assert.equal(result.jamShare, 4000 / 6000);
  });

  test("sums sections when HERE splits a trace", () => {
    const section = response.routes[0].sections[0];
    const result = parseImport({
      routes: [
        { sections: [section] },
        { sections: [{ ...section, summary: { ...section.summary } }] },
      ],
    });
    assert.equal(result.lengthM, 12000);
    assert.equal(result.durationS, 1800);
    assert.equal(result.avgSpeed, 7);
  });

  test("handles a missing typical duration", () => {
    const section = response.routes[0].sections[0];
    const { typicalDuration, ...summary } = section.summary;
    const result = parseImport({
      routes: [{ sections: [{ ...section, summary }] }],
    });
    assert.equal(result.typicalDurationS, null);
  });

  test("rejects responses it cannot use", () => {
    assert.throws(() => parseImport({ routes: [] }), HereError);
    assert.throws(
      () =>
        parseImport({
          routes: [
            {
              sections: [
                {
                  summary: { length: 1, duration: 1 },
                  polyline: encodeFlexiblePolyline(points),
                  spans: [{ offset: 0, length: 100 }],
                },
              ],
            },
          ],
        }),
      /no road speeds/,
    );
  });

  test("explains HTTP errors", async () => {
    const unauthorized = fakeFetch([
      [
        "hereapi",
        () =>
          new Response(
            JSON.stringify({
              error: "Unauthorized",
              error_description: "apiKey invalid. apiKey not found.",
            }),
            { status: 401 },
          ),
      ],
    ]);
    await assert.rejects(importRoute(direct, "BAD", unauthorized), (err) => {
      assert.ok(err instanceof HereError);
      assert.equal(err.status, 401);
      assert.match(err.message, /rejected the API key/);
      return true;
    });

    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(importRoute(direct, "KEY", offline), /Cannot reach HERE/);

    const quota = fakeFetch([["hereapi", () => new Response("", { status: 429 })]]);
    await assert.rejects(importRoute(direct, "KEY", quota), /quota/);
  });

  test("returns parsed traffic on success", async () => {
    const ok = fakeFetch([["hereapi", () => response]]);
    const result = await importRoute(direct, "KEY", ok);
    assert.equal(result.avgSpeed, 7);
    assert.equal(ok.calls.length, 1);
  });
});
