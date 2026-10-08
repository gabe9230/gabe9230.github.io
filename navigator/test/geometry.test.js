import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeFlexiblePolyline } from "../lib/flexpolyline.js";
import {
  decodePolyline,
  densify,
  haversine,
  pathLength,
  pathSimilarity,
  trimPath,
} from "../lib/geo.js";
import { encodeFlexiblePolyline, encodePolyline } from "./helpers.js";

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("flexible polyline", () => {
  test("decodes the example from the format specification", () => {
    const coords = decodeFlexiblePolyline("BFoz5xJ67i1B1B7PzIhaxL7Y");
    const expected = [
      [50.10228, 8.69821],
      [50.10201, 8.69567],
      [50.10063, 8.6915],
      [50.09878, 8.68752],
    ];
    assert.equal(coords.length, expected.length);
    coords.forEach(([lat, lng], i) => {
      close(lat, expected[i][0]);
      close(lng, expected[i][1]);
    });
  });

  test("round trips high precision values beyond 32 bits", () => {
    const input = [
      [41.8789123, -87.6359456],
      [-33.8688197, 151.2092955],
      [64.1265205, -21.8174393],
    ];
    const coords = decodeFlexiblePolyline(
      encodeFlexiblePolyline(input, { precision: 7 }),
    );
    coords.forEach(([lat, lng], i) => {
      close(lat, input[i][0]);
      close(lng, input[i][1]);
    });
  });

  test("decodes a third dimension", () => {
    const input = [
      [41.87891, -87.63594, 181.5],
      [41.88, -87.64, 190.25],
    ];
    const coords = decodeFlexiblePolyline(
      encodeFlexiblePolyline(input, {
        precision: 5,
        thirdDim: 2,
        thirdDimPrecision: 2,
      }),
    );
    assert.deepEqual(
      coords.map((point) => point.map((v) => Number(v.toFixed(5)))),
      input,
    );
  });

  test("rejects invalid input", () => {
    assert.throws(() => decodeFlexiblePolyline("B!"));
    assert.throws(() => decodeFlexiblePolyline("CF"));
    assert.throws(() => decodeFlexiblePolyline("BFoz5x"));
  });
});

describe("encoded polyline", () => {
  test("decodes the classic precision 5 example", () => {
    assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5), [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  test("round trips precision 6 (Valhalla)", () => {
    const input = [
      [41.878901, -87.635901],
      [41.974201, -87.907301],
    ];
    assert.deepEqual(decodePolyline(encodePolyline(input, 6), 6), input);
  });
});

describe("distances", () => {
  test("haversine", () => {
    // One degree of latitude is about 111.2 km.
    close(haversine([41, -87], [42, -87]), 111195, 50);
  });

  test("densify keeps the ends and limits the step", () => {
    const path = [
      [41.88, -87.63],
      [41.89, -87.63],
    ];
    const dense = densify(path, 50);
    assert.deepEqual(dense[0], path[0]);
    assert.deepEqual(dense.at(-1), path[1]);
    for (let i = 1; i < dense.length; i++) {
      assert.ok(haversine(dense[i - 1], dense[i]) <= 50.0001);
    }
    close(pathLength(dense), pathLength(path), 0.01);
  });

  test("trimPath removes about the given distance from each end", () => {
    const path = densify(
      [
        [41.8, -87.7],
        [41.9, -87.7],
      ],
      100,
    );
    const total = pathLength(path);
    const both = trimPath(path, 1000, 1000);
    close(total - pathLength(both), 2000, 200);
    const endOnly = trimPath(path, 0, 1000);
    assert.deepEqual(endOnly[0], path[0]);
    close(total - pathLength(endOnly), 1000, 100);
    const startOnly = trimPath(path, 1000, 0);
    assert.deepEqual(startOnly.at(-1), path.at(-1));
    assert.deepEqual(trimPath(path, 0, 0), path);
    assert.ok(trimPath(path, 1e9, 1e9).length <= 1);
  });

  test("path similarity", () => {
    const a = [
      [41.88, -87.63],
      [41.9, -87.63],
    ];
    const b = [
      [41.88, -87.63],
      [41.9, -87.63],
    ];
    const c = [
      [41.88, -87.7],
      [41.9, -87.7],
    ];
    assert.equal(pathSimilarity(a, b), 1);
    assert.equal(pathSimilarity(a, c), 0);
  });
});
