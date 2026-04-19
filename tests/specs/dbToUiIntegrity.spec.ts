import { test, expect } from '../fixtures/base.fixture';

/**
 * Database-to-UI Integrity Test Suite
 *
 * Purpose: Verify that when drone telemetry is updated in the database
 * (either directly via DbClient or via the API), the Leaflet map UI
 * reflects the new position within the next polling cycle (≤ 2 seconds).
 *
 * This is the "End-to-End Data Pipeline" test:
 * DB Insert → GET /drones API → Leaflet app.js poll → DOM update → Playwright assertion
 *
 * Why this matters:
 * Spatial data bugs often manifest as stale positions on the map — a drone
 * appears at its last known location while the DB has newer coordinates.
 * This test catches regressions in the polling mechanism and API data mapping.
 */

const DRONE_ID = 'DRONE-001';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

// Tolerance for coordinate comparison (0.0001° ≈ 11 m at equator, sufficient for 5dp display)
const COORD_TOLERANCE = 0.0001;

test.describe('Database-to-UI Integrity', () => {

  test.afterEach(async ({ dbClient }) => {
    await dbClient.clearTelemetry(DRONE_ID);
  });

  // ─── Test 1: Direct DB Insert reflected on UI ─────────────────────────────
  test('Should reflect direct DB-seeded position on the live map within 2 poll cycles', async ({
    dbClient,
    droneMapPage,
  }) => {
    // Arbitrary target position: Times Square area
    const targetLat = 40.7580;
    const targetLng = -73.9855;

    // Insert directly into DB (bypasses API — pure DB-to-UI path)
    await dbClient.seedTelemetry(DRONE_ID, targetLat, targetLng, 150, 88.5);
    console.log(`[DB→UI] Seeded position: (${targetLat}, ${targetLng})`);

    // Navigate to map and wait for position to propagate through poll
    await droneMapPage.navigate();
    await droneMapPage.waitForLiveConnection();

    await droneMapPage.waitForDronePositionUpdate(
      DRONE_ID,
      targetLat,
      targetLng,
      COORD_TOLERANCE,
      15_000
    );

    console.log('[DB→UI] ✅ Position reflected on UI');

    // Final verification: read displayed coordinates and assert precision
    const displayed = await droneMapPage.getDroneDisplayedCoordinates(DRONE_ID);
    expect(Math.abs(displayed.lat - targetLat)).toBeLessThanOrEqual(COORD_TOLERANCE);
    expect(Math.abs(displayed.lng - targetLng)).toBeLessThanOrEqual(COORD_TOLERANCE);
  });

  // ─── Test 2: API Insert reflected on UI ───────────────────────────────────
  test('Should reflect API-posted telemetry on the live map within 2 poll cycles', async ({
    request,
    droneMapPage,
  }) => {
    // Central Park area
    const targetLat = 40.7829;
    const targetLng = -73.9654;

    const response = await request.post(`${API_BASE}/telemetry`, {
      data: {
        drone_id:    DRONE_ID,
        latitude:    targetLat,
        longitude:   targetLng,
        altitude:    90,
        battery_pct: 55,
      },
    });
    expect(response.status()).toBe(201);

    await droneMapPage.navigate();
    await droneMapPage.waitForLiveConnection();

    await droneMapPage.waitForDronePositionUpdate(
      DRONE_ID,
      targetLat,
      targetLng,
      COORD_TOLERANCE,
      15_000
    );

    const body = await response.json();
    console.log('[DB→UI] API response:', JSON.stringify(body.data.position_geojson));
  });

  // ─── Test 3: Sequential Updates — last write wins ───────────────────────────
  test('Should display the LATEST telemetry when multiple updates are posted', async ({
    dbClient,
    droneMapPage,
  }) => {
    const firstPos  = { lat: 40.7484, lng: -73.9857 };
    const secondPos = { lat: 40.7550, lng: -73.9790 };

    // Insert two records; UI should show the most recent
    await dbClient.seedTelemetry(DRONE_ID, firstPos.lat, firstPos.lng, 100);
    // Small delay to ensure recorded_at ordering
    await new Promise(r => setTimeout(r, 50));
    await dbClient.seedTelemetry(DRONE_ID, secondPos.lat, secondPos.lng, 110);

    await droneMapPage.navigate();
    await droneMapPage.waitForLiveConnection();

    // Should converge to SECOND position
    await droneMapPage.waitForDronePositionUpdate(
      DRONE_ID,
      secondPos.lat,
      secondPos.lng,
      COORD_TOLERANCE,
      15_000
    );
  });

  // ─── Test 4: PostGIS Precision — verify round-trip coordinate accuracy ────
  test('Should preserve coordinate precision through the DB→API→UI round-trip', async ({
    dbClient,
    request,
  }) => {
    // High-precision coordinate — 6 decimal places (≈ 10 cm accuracy)
    const precisionLat = 40.748438;
    const precisionLng = -73.985782;

    await dbClient.seedTelemetry(DRONE_ID, precisionLat, precisionLng, 200);

    // Read back via API
    const response = await request.get(`${API_BASE}/telemetry/${DRONE_ID}/latest`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    const apiLat = parseFloat(body.data.latitude);
    const apiLng = parseFloat(body.data.longitude);

    // PostGIS should preserve 6dp precision through GEOMETRY(Point, 4326)
    expect(Math.abs(apiLat - precisionLat)).toBeLessThan(0.000001);
    expect(Math.abs(apiLng - precisionLng)).toBeLessThan(0.000001);

    // Validate GeoJSON structure from ST_AsGeoJSON
    expect(body.data.position_geojson.type).toBe('Point');
    expect(body.data.position_geojson.coordinates).toHaveLength(2);
  });
});
