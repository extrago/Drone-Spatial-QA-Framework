import { test, expect } from '../fixtures/base.fixture';

/**
 * Geofencing Validation Test Suite
 *
 * Purpose: Validate that the system correctly detects and surfaces geofence
 * breaches — both at the API/DB level (PostGIS ST_Within) and at the UI level
 * (geofence alert banner visibility).
 *
 * Why PostGIS for geofencing?
 * PostGIS ST_Within operates on indexed GEOMETRY columns, making spatial
 * containment checks O(log n) rather than iterating coordinates in application
 * code. This is the authoritative truth — UI must reflect it within 2 poll cycles.
 */

const DRONE_ID = 'DRONE-001';

// Geofence: MIDTOWN_OPS_ZONE polygon from init.sql
// [lat, lng] pairs
const GEOFENCE_POLYGON: Array<[number, number]> = [
  [40.7380, -74.0010],
  [40.7380, -73.9700],
  [40.7600, -73.9700],
  [40.7600, -74.0010],
];

// Coordinates confirmed INSIDE the geofence
const INSIDE_COORD  = { lat: 40.7484, lng: -73.9857, label: 'Midtown Manhattan' };

// Coordinates confirmed OUTSIDE the geofence (JFK Airport area)
const OUTSIDE_COORD = { lat: 40.6413, lng: -73.7781, label: 'JFK Airport' };

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

test.describe('Geofencing Validation', () => {

  test.afterEach(async ({ dbClient }) => {
    // Hermetic: remove test telemetry so subsequent tests start clean
    await dbClient.clearTelemetry(DRONE_ID);
  });

  // ─── Test 1: PostGIS ST_Within — Inside Geofence ───────────────────────────
  test('Should confirm drone INSIDE geofence via PostGIS ST_Within', async ({ dbClient, spatialUtils }) => {
    await dbClient.seedTelemetry(DRONE_ID, INSIDE_COORD.lat, INSIDE_COORD.lng, 120);

    // PostGIS verification — authoritative spatial truth
    const insideDb = await dbClient.isDroneInsideGeofence(DRONE_ID);
    expect(insideDb, `PostGIS ST_Within should return TRUE for ${INSIDE_COORD.label}`).toBe(true);

    // Client-side corroboration via Turf.js
    const insideTurf = spatialUtils.isInsidePolygon(
      INSIDE_COORD.lat, INSIDE_COORD.lng, GEOFENCE_POLYGON
    );
    expect(insideTurf, 'Turf.js booleanPointInPolygon should agree with PostGIS').toBe(true);
  });

  // ─── Test 2: PostGIS ST_Within — Outside Geofence ─────────────────────────
  test('Should detect drone OUTSIDE geofence via PostGIS ST_Within', async ({ dbClient, spatialUtils }) => {
    await dbClient.seedTelemetry(DRONE_ID, OUTSIDE_COORD.lat, OUTSIDE_COORD.lng, 85);

    const insideDb = await dbClient.isDroneInsideGeofence(DRONE_ID);
    expect(insideDb, `PostGIS ST_Within should return FALSE for ${OUTSIDE_COORD.label}`).toBe(false);

    // Client-side corroboration
    const insideTurf = spatialUtils.isInsidePolygon(
      OUTSIDE_COORD.lat, OUTSIDE_COORD.lng, GEOFENCE_POLYGON
    );
    expect(insideTurf, 'Turf.js should also flag as outside geofence').toBe(false);
  });

  // ─── Test 3: API-level geofence_alert flag — Outside ─────────────────────
  test('Should set geofence_alert=true in API response for out-of-bounds telemetry', async ({ request }) => {
    const response = await request.post(`${API_BASE}/telemetry`, {
      data: {
        drone_id:    DRONE_ID,
        latitude:    OUTSIDE_COORD.lat,
        longitude:   OUTSIDE_COORD.lng,
        altitude:    85,
        battery_pct: 72,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.data.geofence_alert, 'API should flag geofence breach').toBe(true);
    expect(body.data.inside_geofence, 'inside_geofence should be false').toBe(false);
  });

  // ─── Test 4: UI Alert Banner — Out-of-Bounds ─────────────────────────────
  test('Should show geofence alert banner on UI when drone is outside geofence', async ({
    request,
    droneMapPage,
  }) => {
    // Seed out-of-bounds telemetry via API
    await request.post(`${API_BASE}/telemetry`, {
      data: {
        drone_id:  DRONE_ID,
        latitude:  OUTSIDE_COORD.lat,
        longitude: OUTSIDE_COORD.lng,
        altitude:  85,
      },
    });

    await droneMapPage.navigate();
    await droneMapPage.waitForLiveConnection();

    // Wait for the UI to poll and show the alert (max 3 poll cycles = 6 s)
    await droneMapPage.waitForGeofenceAlert(true, 8_000);

    const alertText = await droneMapPage.getGeofenceAlertText();
    expect(alertText).toContain('GEOFENCE');
    expect(alertText).toContain(DRONE_ID);
  });

  // ─── Test 5: UI Alert Banner — In-Bounds (Cleared) ───────────────────────
  test('Should dismiss geofence alert when drone returns inside geofence', async ({
    request,
    droneMapPage,
  }) => {
    // Start outside
    await request.post(`${API_BASE}/telemetry`, {
      data: { drone_id: DRONE_ID, latitude: OUTSIDE_COORD.lat, longitude: OUTSIDE_COORD.lng, altitude: 85 },
    });

    await droneMapPage.navigate();
    await droneMapPage.waitForLiveConnection();
    await droneMapPage.waitForGeofenceAlert(true, 8_000);

    // Move back inside
    await request.post(`${API_BASE}/telemetry`, {
      data: { drone_id: DRONE_ID, latitude: INSIDE_COORD.lat, longitude: INSIDE_COORD.lng, altitude: 120 },
    });

    // Alert should disappear within next poll cycle
    await droneMapPage.waitForGeofenceAlert(false, 8_000);
  });
});
