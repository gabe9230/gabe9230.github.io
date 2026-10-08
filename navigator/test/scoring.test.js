import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { averageRoadSpeed, scoreRoutes } from "../lib/scoring.js";

// Speeds in meters per second; 13.4 m/s is about 30 mph.
const routes = [
  { id: "highway", lengthM: 30000, avgSpeed: 10, durationS: 3000 },
  { id: "short", lengthM: 20000, avgSpeed: 8, durationS: 2500 },
  { id: "detour", lengthM: 36000, avgSpeed: 16, durationS: 2250 },
];

describe("average road speed", () => {
  test("weights each stretch by its length", () => {
    // 9 km at 20 m/s and 1 km of jam at 2 m/s.
    assert.equal(
      averageRoadSpeed([
        { length: 9000, speed: 20 },
        { length: 1000, speed: 2 },
      ]),
      18.2,
    );
  });

  test("ignores stretches without speed data", () => {
    assert.equal(
      averageRoadSpeed([
        { length: 1000, speed: 10 },
        { length: 5000, speed: null },
        { length: 0, speed: 50 },
      ]),
      10,
    );
    assert.equal(averageRoadSpeed([]), null);
  });
});

describe("score", () => {
  test("normalizes q and k so the best route gets 1", () => {
    const scored = scoreRoutes(routes, { x: 1, y: 1 });
    const byId = Object.fromEntries(scored.map((r) => [r.id, r]));
    assert.equal(byId.short.q, 1);
    assert.equal(byId.highway.q, 20000 / 30000);
    assert.equal(byId.detour.q, 20000 / 36000);
    assert.equal(byId.detour.k, 1);
    assert.equal(byId.highway.k, 10 / 16);
    assert.equal(byId.short.k, 8 / 16);
    for (const r of scored) {
      assert.equal(r.score, r.q * 1 + r.k * 1);
    }
  });

  test("x only picks the shortest trip", () => {
    assert.equal(scoreRoutes(routes, { x: 1, y: 0 })[0].id, "short");
  });

  test("y only picks the fastest-moving roads, even if longer", () => {
    assert.equal(scoreRoutes(routes, { x: 0, y: 1 })[0].id, "detour");
  });

  test("the knobs trade length against road speed", () => {
    // short: q = 1, k = 0.5; detour: q = 0.556, k = 1.
    // short wins when x > 0.444 / 0.5 * y, i.e. x > 1.125 * y.
    assert.equal(scoreRoutes(routes, { x: 1, y: 0.8 })[0].id, "short");
    assert.equal(scoreRoutes(routes, { x: 0.8, y: 1 })[0].id, "detour");
  });

  test("clamps knobs to [0, 1]", () => {
    const scored = scoreRoutes(routes, { x: 5, y: -2 });
    assert.equal(scored[0].id, "short");
    assert.equal(scored[0].score, 1);
  });

  test("breaks ties by travel time", () => {
    const scored = scoreRoutes(routes, { x: 0, y: 0 });
    assert.deepEqual(
      scored.map((r) => r.id),
      ["detour", "short", "highway"],
    );
  });

  test("skips routes without speed data", () => {
    const scored = scoreRoutes(
      [...routes, { id: "unknown", lengthM: 10000, avgSpeed: null }],
      { x: 1, y: 0 },
    );
    assert.equal(scored.length, 3);
    assert.equal(scored[0].id, "short");
    assert.deepEqual(scoreRoutes([], { x: 1, y: 1 }), []);
  });
});
