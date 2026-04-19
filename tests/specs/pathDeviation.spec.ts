import { test, expect } from '../fixtures/base.fixture';

/**
 * Path Deviation Test Suite
 *
 * Purpose: Validate that a drone's actual flight path stays within an
 * acceptable deviation from the planned GeoJSON route.
 *
 * Algorithm: For each actual GPS point, find the nearest point on the
 * planned LineString using Turf.js nearestPointOnLine, measure the
 * perpendicular distance, and assert the maximum is ≤ MAX_DEVIATION_M.
 *
 * Why Turf.js here instead of PostGIS?
 * Path deviation is a read-only assertion computed in the test layer.
 * Turf.js avoids a DB round-trip and runs orders of magnitude faster
 * for small coordinate sets (< 1000 points), which is typical for
 * drone waypoint data.
 */

const MAX_DEVIATION_M = 5; // per spec requirements — 5-metre tolerance

// Planned delivery route: 5 waypoints through Midtown Manhattan
// All coordinates [latitude, longitude]
const PLANNED_PATH: Array<[number, number]> = [
  [40.7484, -73.9857],  // Waypoint 1: Origin
  [40.7495, -73.9840],  // Waypoint 2
  [40.7510, -73.9820],  // Waypoint 3
  [40.7525, -73.9800],  // Waypoint 4
  [40.7540, -73.9780],  // Waypoint 5: Destination
];

// Actual path with realistic GPS noise (2-4 m off planned points)
// Offsets are ~0.00003° ≈ 3 m at NYC latitude
const ACTUAL_PATH_WITHIN_TOLERANCE: Array<[number, number]> = [
  [40.74842, -73.98568],  // +2 m deviation
  [40.74953, -73.98397],  // +3 m deviation
  [40.75103, -73.98197],  // +3 m deviation
  [40.75253, -73.97997],  // +4 m deviation
  [40.75403, -73.97797],  // +3 m deviation
];

// Actual path with a significant detour at waypoint 3 (~20 m off)
// Offset of 0.0002° ≈ 20 m — used for negative assertion
const ACTUAL_PATH_EXCEEDS_TOLERANCE: Array<[number, number]> = [
  [40.74842, -73.98568],  // OK
  [40.74953, -73.98397],  // OK
  [40.75118, -73.98180],  // ~20 m off — significant detour
  [40.75253, -73.97997],  // OK
  [40.75403, -73.97797],  // OK
];

test.describe('Path Deviation Validation', () => {

  // ─── Test 1: Within Tolerance ───────────────────────────────────────────────
  test('Should pass when actual path deviation is within 5m tolerance', ({ spatialUtils }) => {
    const maxDev = spatialUtils.maxDeviationMeters(PLANNED_PATH, ACTUAL_PATH_WITHIN_TOLERANCE);
    const meanDev = spatialUtils.meanDeviationMeters(PLANNED_PATH, ACTUAL_PATH_WITHIN_TOLERANCE);

    console.log(`[PathDeviation] Max deviation: ${maxDev.toFixed(3)} m`);
    console.log(`[PathDeviation] Mean deviation: ${meanDev.toFixed(3)} m`);

    expect(maxDev).toBeLessThanOrEqual(
      MAX_DEVIATION_M,
      `Max deviation ${maxDev.toFixed(2)} m exceeds ${MAX_DEVIATION_M} m tolerance`
    );
    expect(meanDev).toBeLessThan(MAX_DEVIATION_M);
  });

  // ─── Test 2: Exceeds Tolerance ─────────────────────────────────────────────
  test('Should fail deviation assertion when drone deviates > 5m from planned path', ({ spatialUtils }) => {
    const maxDev = spatialUtils.maxDeviationMeters(PLANNED_PATH, ACTUAL_PATH_EXCEEDS_TOLERANCE);

    console.log(`[PathDeviation] Max deviation (bad path): ${maxDev.toFixed(3)} m`);

    // This test INTENTIONALLY asserts that deviation IS greater than tolerance
    // It validates our detection mechanism catches real problems
    expect(maxDev).toBeGreaterThan(
      MAX_DEVIATION_M,
      `Expected deviation > ${MAX_DEVIATION_M} m, got ${maxDev.toFixed(2)} m`
    );
  });

  // ─── Test 3: Per-Waypoint Deviation Analysis ───────────────────────────────
  test('Should compute per-waypoint deviation for RCA logging', ({ spatialUtils }) => {
    const deviations = ACTUAL_PATH_WITHIN_TOLERANCE.map(([lat, lng], idx) => {
      // Measure distance to nearest planned waypoint for human-readable RCA
      const nearestWaypoint = PLANNED_PATH.reduce((best, [plt, plg], pi) => {
        const dist = spatialUtils.distanceBetweenMeters(lat, lng, plt, plg);
        return dist < best.dist ? { idx: pi, dist } : best;
      }, { idx: 0, dist: Infinity });

      return { waypoint: idx + 1, deviationM: nearestWaypoint.dist };
    });

    console.table(deviations.map(d => ({
      Waypoint: d.waypoint,
      'Deviation (m)': d.deviationM.toFixed(3),
      Status: d.deviationM <= MAX_DEVIATION_M ? '✅ OK' : '❌ BREACH',
    })));

    for (const { waypoint, deviationM } of deviations) {
      expect(deviationM, `Waypoint ${waypoint} deviation`).toBeLessThanOrEqual(MAX_DEVIATION_M);
    }
  });

  // ─── Test 4: Single Point Exact Match ─────────────────────────────────────
  test('Should report zero deviation when actual matches planned exactly', ({ spatialUtils }) => {
    const maxDev = spatialUtils.maxDeviationMeters(PLANNED_PATH, PLANNED_PATH);
    expect(maxDev).toBeCloseTo(0, 1);
  });

  // ─── Test 5: GeoJSON Trail Construction ────────────────────────────────────
  test('Should build drone GeoJSON trail with correct feature count', ({ spatialUtils }) => {
    const trail = spatialUtils.buildDroneGeoJSONTrail(
      ACTUAL_PATH_WITHIN_TOLERANCE.map(([lat, lng]) => ({ lat, lng, altitude: 100 }))
    );

    expect(trail.type).toBe('FeatureCollection');
    expect(trail.features).toHaveLength(ACTUAL_PATH_WITHIN_TOLERANCE.length);
    trail.features.forEach((f) => {
      expect(f.type).toBe('Feature');
      expect(f.geometry.type).toBe('Point');
    });
  });
});
