import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PROVIDERS } from "../lib/providers.js";
import {
  buildRouteRequest,
  checkRoute,
  limitPoints,
  parseRoute,
} from "../lib/tomtom.js";
import { TrafficError } from "../lib/traffic.js";
import { fakeFetch } from "./helpers.js";

const A = [41.8789, -87.6359];
const B = [41.9742, -87.9073];
const route = [A, [41.92, -87.75], B];

const points = [
  [41.8789, -87.6359],
  [41.885, -87.65],
  [41.89, -87.67],
  [41.9, -87.7],
  [41.91, -87.73],
];

// 6 km in 20 minutes. Point 0 -> 2: 2 km in 60 s (33.3 m/s);
// point 2 -> 3: 1 km of jam in 400 s (2.5 m/s);
// point 3 -> 4: 3 km in 740 s.
const response = {
  formatVersion: "0.0.12",
  routes: [
    {
      summary: {
        lengthInMeters: 6000,
        travelTimeInSeconds: 1200,
        trafficDelayInSeconds: 300,
        noTrafficTravelTimeInSeconds: 800,
        historicTrafficTravelTimeInSeconds: 1000,
        liveTrafficIncidentsTravelTimeInSeconds: 1200,
      },
      legs: [
        {
          points: points.map(([latitude, longitude]) => ({ latitude, longitude })),
        },
      ],
      sections: [
        { startPointIndex: 0, endPointIndex: 4, sectionType: "TRAVEL_MODE" },
        {
          startPointIndex: 2,
          endPointIndex: 3,
          sectionType: "TRAFFIC",
          simpleCategory: "JAM",
          effectiveSpeedInKmh: 9,
          delayInSeconds: 300,
          magnitudeOfDelay: 3,
        },
      ],
      progress: [
        { pointIndex: 0, distanceInMeters: 0, travelTimeInSeconds: 0 },
        { pointIndex: 2, distanceInMeters: 2000, travelTimeInSeconds: 60 },
        { pointIndex: 3, distanceInMeters: 3000, travelTimeInSeconds: 460 },
        { pointIndex: 4, distanceInMeters: 6000, travelTimeInSeconds: 1200 },
      ],
    },
  ],
};

describe("TomTom request", () => {
  test("rebuilds the route from its points, with live traffic", () => {
    const { url, init } = buildRouteRequest(route, "KEY");
    const parsed = new URL(url);

    assert.equal(
      parsed.pathname,
      `/routing/1/calculateRoute/${A[0]},${A[1]}:${B[0]},${B[1]}/json`,
    );
    assert.equal(parsed.searchParams.get("key"), "KEY");
    assert.equal(parsed.searchParams.get("traffic"), "true");
    assert.equal(parsed.searchParams.get("computeTravelTimeFor"), "all");
    assert.equal(parsed.searchParams.get("sectionType"), "traffic");
    assert.deepEqual(parsed.searchParams.getAll("extendedRouteRepresentation"), [
      "distance",
      "travelTime",
    ]);
    assert.equal(parsed.searchParams.get("reconstructionMode"), "update");
    assert.equal(parsed.searchParams.get("departAt"), null); // Now.
    assert.equal(init.method, "POST");
    const { supportingPoints } = JSON.parse(init.body);
    assert.deepEqual(
      supportingPoints,
      route.map(([latitude, longitude]) => ({ latitude, longitude })),
    );
  });

  test("limits very long routes to a bounded number of points", () => {
    const long = Array.from({ length: 101 }, (_, i) => [41 + i / 1000, -87]);
    const limited = limitPoints(long, 11);
    assert.equal(limited.length, 11);
    assert.deepEqual(limited[0], long[0]);
    assert.deepEqual(limited[5], long[50]);
    assert.deepEqual(limited.at(-1), long[100]);
    assert.equal(limitPoints(long, 500), long);
  });
});

describe("TomTom response", () => {
  test("derives per-road speeds from travel times along the route", () => {
    const result = parseRoute(response);

    assert.equal(result.provider, "tomtom");
    assert.equal(result.lengthM, 6000);
    assert.equal(result.durationS, 1200);
    assert.equal(result.typicalDurationS, 1000);
    assert.equal(result.baseDurationS, 800);
    assert.deepEqual(
      result.stretches.map(({ length, speed }) => [length, Number(speed.toFixed(3))]),
      [
        [2000, 33.333],
        [1000, 2.5],
        [3000, 4.054],
      ],
    );
    // Length-weighted mean: (2000 * 33.33 + 1000 * 2.5 + 3000 * 4.054) / 6000.
    assert.equal(
      result.avgSpeed.toFixed(3),
      ((2000 * (2000 / 60) + 1000 * 2.5 + 3000 * (3000 / 740)) / 6000).toFixed(3),
    );
    assert.equal(result.stretches[0].coords.length, 3);
  });

  test("marks traffic sections on the map", () => {
    const { segments, jamShare } = parseRoute(response);

    assert.equal(segments.length, 2);
    assert.equal(segments[0].level, "free");
    assert.equal(segments[0].coords.length, points.length);
    assert.equal(segments[1].level, "jam");
    assert.deepEqual(segments[1].coords, [points[2], points[3]]);
    assert.equal(segments[1].note, "Traffic jam, 6 mph, +5 min");
    assert.ok(jamShare > 0 && jamShare < 1);
  });

  test("minor delays are slow, not jammed", () => {
    const route0 = response.routes[0];
    const { segments, jamShare } = parseRoute({
      routes: [
        {
          ...route0,
          sections: [
            {
              ...route0.sections[1],
              simpleCategory: "ROAD_WORK",
              magnitudeOfDelay: 4,
            },
          ],
        },
      ],
    });
    assert.equal(segments[1].level, "slow");
    assert.match(segments[1].note, /^Road works/);
    assert.equal(jamShare, 0);
  });

  test("falls back to the trip average without progress", () => {
    const { progress, ...route0 } = response.routes[0];
    const result = parseRoute({ routes: [route0] });
    assert.equal(result.avgSpeed, 6000 / 1200);
    assert.deepEqual(result.stretches, []);
  });

  test("rejects responses it cannot use", () => {
    assert.throws(() => parseRoute({ routes: [] }), TrafficError);
    assert.throws(() => parseRoute({}), /could not rebuild/);
  });
});

describe("TomTom errors", () => {
  test("explains a rejected key", async () => {
    const unauthorized = fakeFetch([
      [
        "tomtom",
        () =>
          new Response(
            JSON.stringify({
              detailedError: {
                code: "Unauthorized",
                message: "You are missing valid authentication credentials",
              },
            }),
            { status: 401 },
          ),
      ],
    ]);
    await assert.rejects(checkRoute(route, "BAD", unauthorized), (err) => {
      assert.ok(err instanceof TrafficError);
      assert.equal(err.provider, "tomtom");
      assert.equal(err.status, 401);
      assert.match(err.message, /rejected the API key: You are missing/);
      return true;
    });
  });

  test("explains a failed route rebuild, quota and network errors", async () => {
    const rebuild = fakeFetch([
      [
        "tomtom",
        () =>
          new Response(
            JSON.stringify({
              detailedError: {
                code: "CANNOT_RESTORE_BASEROUTE",
                message: "The route reconstruction using supportingPoints failed.",
              },
            }),
            { status: 400 },
          ),
      ],
    ]);
    await assert.rejects(checkRoute(route, "KEY", rebuild), /error 400: The route reconstruction/);

    const quota = fakeFetch([["tomtom", () => new Response("", { status: 429 })]]);
    await assert.rejects(checkRoute(route, "KEY", quota), /quota/);

    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(checkRoute(route, "KEY", offline), /Cannot reach TomTom/);
  });

  test("returns parsed traffic on success", async () => {
    const ok = fakeFetch([["tomtom", () => response]]);
    const result = await checkRoute(route, "KEY", ok);
    assert.equal(result.durationS, 1200);
    assert.equal(result.approximate, false);
    assert.equal(ok.calls.length, 1);
  });

  const cannotFollow = () =>
    new Response(
      JSON.stringify({
        detailedError: {
          code: "BAD_INPUT",
          message:
            "Engine error while executing route request: CANNOT_RESTORE_BASEROUTE: No valid route found.",
        },
      }),
      { status: 400 },
    );

  // A straight 11 km route, sampled every 100 m.
  const longRoute = Array.from({ length: 101 }, (_, i) => [41.8 + i * 0.0009, -87.7]);

  const sentPoints = (call) => JSON.parse(call.init.body).supportingPoints;

  test("skips the end of a route TomTom cannot follow", async () => {
    let attempt = 0;
    const fetchImpl = fakeFetch([
      ["tomtom", () => (++attempt === 1 ? cannotFollow() : response)],
    ]);
    const result = await checkRoute(longRoute, "KEY", fetchImpl);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(result.approximate, false);
    assert.deepEqual(result.trim, [0, 1000]);
    assert.ok(result.trimmedM >= 1000 && result.trimmedM < 1200);
    const [first, second] = fetchImpl.calls.map(sentPoints);
    assert.equal(first.length, 101);
    assert.deepEqual(second[0], first[0]); // The start is kept.
    assert.ok(second.length < 95);
    assert.match(fetchImpl.calls[1].url, /reconstructionMode=update/);
  });

  test("tries the trim that worked for an earlier route first", async () => {
    const fetchImpl = fakeFetch([["tomtom", () => response]]);
    const result = await checkRoute(longRoute, "KEY", fetchImpl, {
      trimHint: [3000, 0],
    });
    assert.equal(fetchImpl.calls.length, 1);
    assert.deepEqual(result.trim, [3000, 0]);
    assert.deepEqual(sentPoints(fetchImpl.calls[0]).at(-1), {
      latitude: longRoute.at(-1)[0],
      longitude: longRoute.at(-1)[1],
    });
  });

  test("falls back to an approximate route as a last resort", async () => {
    const fetchImpl = fakeFetch([
      ["reconstructionMode=update", cannotFollow],
      ["reconstructionMode=normal", () => response],
    ]);
    const result = await checkRoute(longRoute, "KEY", fetchImpl);
    // The full route, five trims, then the loose mode.
    assert.equal(fetchImpl.calls.length, 7);
    assert.equal(result.approximate, true);
    assert.equal(result.durationS, 1200);
  });

  test("does not trim short routes", async () => {
    const fetchImpl = fakeFetch([
      ["reconstructionMode=update", cannotFollow],
      ["reconstructionMode=normal", () => response],
    ]);
    const short = longRoute.slice(0, 20); // About 2 km.
    const result = await checkRoute(short, "KEY", fetchImpl);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(result.approximate, true);
  });

  test("does not retry other errors", async () => {
    const fetchImpl = fakeFetch([
      ["tomtom", () => new Response("{}", { status: 400 })],
    ]);
    await assert.rejects(checkRoute(route, "KEY", fetchImpl), /error 400/);
    assert.equal(fetchImpl.calls.length, 1);
  });
});

describe("providers", () => {
  test("TomTom is the default and both share the same interface", () => {
    for (const provider of Object.values(PROVIDERS)) {
      assert.equal(typeof provider.checkRoute, "function");
      assert.ok(provider.keyStorage.startsWith("navigator."));
      assert.ok(new URL(provider.signupUrl));
    }
    assert.notEqual(PROVIDERS.tomtom.keyStorage, PROVIDERS.here.keyStorage);
  });
});

describe("built-in key", () => {
  test("obfuscation round trips", async () => {
    const { obfuscate, deobfuscate } = await import("../lib/obfuscate.js");
    const key = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const hidden = obfuscate(key);
    assert.notEqual(hidden, key);
    assert.ok(!hidden.includes(key));
    assert.equal(deobfuscate(hidden), key);
  });

  test("TomTom has a usable built-in key; HERE has none", () => {
    assert.match(PROVIDERS.tomtom.builtInKey(), /^[A-Za-z0-9]{32}$/);
    assert.equal(PROVIDERS.here.builtInKey, null);
  });
});
