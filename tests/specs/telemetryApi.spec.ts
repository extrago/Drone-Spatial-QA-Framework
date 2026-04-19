import { test, expect } from '../fixtures/base.fixture';

/**
 * Telemetry API Contract Test Suite
 *
 * Purpose: Validate the REST API surface — request validation, response
 * schema, GeoJSON shape, error cases, and concurrent throughput.
 *
 * These tests run without a browser (pure APIRequestContext) for speed.
 * They form the first layer of the test pyramid — fast, deterministic,
 * and independent of UI rendering.
 */

const API_BASE  = process.env.API_BASE_URL ?? 'http://localhost:3001';
const DRONE_ID  = 'DRONE-001';
const DRONE_ID2 = 'DRONE-002';

test.describe('Telemetry API — Contract Tests', () => {

  test.afterEach(async ({ dbClient }) => {
    await dbClient.clearTelemetry(DRONE_ID);
    await dbClient.clearTelemetry(DRONE_ID2);
  });

  // ─── Test 1: Valid Telemetry POST → 201 ────────────────────────────────────
  test('POST /telemetry should return 201 with correct response schema', async ({ request }) => {
    const payload = {
      drone_id:    DRONE_ID,
      latitude:    40.7484,
      longitude:  -73.9857,
      altitude:    120.5,
      battery_pct: 87.3,
    };

    const response = await request.post(`${API_BASE}/telemetry`, { data: payload });

    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.data).toMatchObject({
      drone_id:  DRONE_ID,
      latitude:  payload.latitude,
      longitude: payload.longitude,
      altitude:  payload.altitude,
    });

    // GeoJSON response from ST_AsGeoJSON
    expect(body.data.position_geojson).toMatchObject({
      type: 'Point',
      coordinates: expect.arrayContaining([
        expect.closeTo(payload.longitude, 4),
        expect.closeTo(payload.latitude, 4),
      ]),
    });

    // Geofence flag present
    expect(typeof body.data.inside_geofence).toBe('boolean');
    expect(typeof body.data.geofence_alert).toBe('boolean');

    // recorded_at is an ISO8601 string
    expect(() => new Date(body.data.recorded_at)).not.toThrow();

    console.log(`[API] recorded_at: ${body.data.recorded_at}, inside_geofence: ${body.data.inside_geofence}`);
  });

  // ─── Test 2: Unknown Drone → 404 ──────────────────────────────────────────
  test('POST /telemetry should return 404 for unknown drone_id', async ({ request }) => {
    const response = await request.post(`${API_BASE}/telemetry`, {
      data: {
        drone_id:  'DRONE-GHOST-999',
        latitude:   40.7484,
        longitude: -73.9857,
        altitude:   100,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.status).toBe('error');
    expect(body.message).toContain('DRONE-GHOST-999');
  });

  // ─── Test 3: Missing Required Fields → 400 ────────────────────────────────
  test('POST /telemetry should return 400 when latitude/longitude are missing', async ({ request }) => {
    const response = await request.post(`${API_BASE}/telemetry`, {
      data: { drone_id: DRONE_ID, altitude: 100 },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.status).toBe('error');
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // ─── Test 4: Invalid Coordinate Ranges → 400 ──────────────────────────────
  test('POST /telemetry should return 400 for out-of-range latitude', async ({ request }) => {
    const response = await request.post(`${API_BASE}/telemetry`, {
      data: { drone_id: DRONE_ID, latitude: 999, longitude: -73.9, altitude: 100 },
    });
    expect(response.status()).toBe(400);
  });

  // ─── Test 5: GET Latest Telemetry → 200 with GeoJSON ──────────────────────
  test('GET /telemetry/:droneId/latest should return GeoJSON position', async ({ dbClient, request }) => {
    const lat = 40.7499;
    const lng = -73.9849;
    await dbClient.seedTelemetry(DRONE_ID, lat, lng, 100);

    const response = await request.get(`${API_BASE}/telemetry/${DRONE_ID}/latest`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.drone_id).toBe(DRONE_ID);
    expect(parseFloat(body.data.latitude)).toBeCloseTo(lat, 4);
    expect(parseFloat(body.data.longitude)).toBeCloseTo(lng, 4);
    expect(body.data.position_geojson.type).toBe('Point');
    expect(body.data.position_geojson.coordinates[0]).toBeCloseTo(lng, 4); // GeoJSON: [lng, lat]
    expect(body.data.position_geojson.coordinates[1]).toBeCloseTo(lat, 4);
  });

  // ─── Test 6: GET Latest for Unknown Drone → 404 ───────────────────────────
  test('GET /telemetry/:droneId/latest should return 404 for drone with no telemetry', async ({ dbClient, request }) => {
    await dbClient.clearTelemetry(DRONE_ID);
    const response = await request.get(`${API_BASE}/telemetry/${DRONE_ID}/latest`);
    expect(response.status()).toBe(404);
  });

  // ─── Test 7: GET /drones returns all active drones ────────────────────────
  test('GET /drones should list all active drones with latest position', async ({ dbClient, request }) => {
    await dbClient.seedTelemetry(DRONE_ID,  40.7484, -73.9857, 120);
    await dbClient.seedTelemetry(DRONE_ID2, 40.7520, -73.9812, 85);

    const response = await request.get(`${API_BASE}/drones`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.data)).toBe(true);

    const drone = body.data.find((d: { drone_id: string }) => d.drone_id === DRONE_ID);
    expect(drone).toBeDefined();
    expect(parseFloat(drone.latitude)).toBeCloseTo(40.7484, 4);
  });

  // ─── Test 8: GET /health ───────────────────────────────────────────────────
  test('GET /health should return 200 with service status', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('drone-telemetry-api');
  });

  // ─── Test 9: Concurrent POSTs — 10 simultaneous requests ─────────────────
  test('Should handle 10 concurrent telemetry POSTs and persist all records', async ({ dbClient, request }) => {
    // Clear slate
    await dbClient.clearTelemetry(DRONE_ID);

    const CONCURRENCY = 10;

    // Generate 10 distinct positions with minor offsets
    const payloads = Array.from({ length: CONCURRENCY }, (_, i) => ({
      drone_id:  DRONE_ID,
      latitude:  40.7484 + (i * 0.0001),
      longitude: -73.9857 + (i * 0.0001),
      altitude:  100 + i,
    }));

    // Fire all requests concurrently
    const responses = await Promise.all(
      payloads.map(data => request.post(`${API_BASE}/telemetry`, { data }))
    );

    // All should succeed
    responses.forEach((resp, i) => {
      expect(resp.status(), `Request ${i + 1} should return 201`).toBe(201);
    });

    // Verify all 10 rows persisted in the DB
    const rows = await dbClient.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM telemetry_logs WHERE drone_id = $1',
      [DRONE_ID]
    );
    expect(parseInt(rows[0].count, 10)).toBe(CONCURRENCY);

    console.log(`[Concurrency] ✅ All ${CONCURRENCY} concurrent POSTs persisted`);
  });
});
