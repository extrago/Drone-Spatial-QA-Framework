import { Pool, PoolClient, QueryResult } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.example') });

export interface TelemetryRow {
  id: number;
  drone_id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  battery_pct: number | null;
  recorded_at: Date;
  position_geojson: GeoJSON.Point;
}

/**
 * DbClient — Singleton PostGIS Query Helper for Tests
 *
 * Design Decisions:
 * 1. Singleton pattern ensures a single Pool across all test files, preventing
 *    connection exhaustion during parallel test execution.
 * 2. All spatial inserts use ST_SetSRID(ST_MakePoint(lng, lat), 4326) — note
 *    PostGIS convention: X=longitude, Y=latitude.
 * 3. Cleanup methods ensure tests are hermetic (no cross-test data pollution).
 */
export class DbClient {
  private static instance: DbClient;
  private pool: Pool;

  private constructor() {
    this.pool = new Pool({
      host:     process.env.DB_HOST     ?? 'localhost',
      port:     parseInt(process.env.DB_PORT ?? '5432', 10),
      database: process.env.DB_NAME     ?? 'dronedb',
      user:     process.env.DB_USER     ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    this.pool.on('error', (err: Error) => {
      console.error('[DbClient] Idle pool error:', err.message);
    });
  }

  /** Returns the singleton instance. Thread-safe for Node.js single-threaded runtime. */
  public static getInstance(): DbClient {
    if (!DbClient.instance) {
      DbClient.instance = new DbClient();
    }
    return DbClient.instance;
  }

  // ─── Telemetry Operations ────────────────────────────────────────────────────

  /**
   * Inserts a telemetry record directly into the DB (bypassing the API).
   * Used for DB-to-UI integrity tests and negative geofence scenarios.
   */
  async seedTelemetry(
    droneId: string,
    lat: number,
    lng: number,
    altitude = 100,
    batteryPct?: number
  ): Promise<TelemetryRow> {
    const result: QueryResult = await this.pool.query(
      `INSERT INTO telemetry_logs (drone_id, position, altitude, battery_pct)
       VALUES (
         $1,
         ST_SetSRID(ST_MakePoint($3, $2), 4326),
         $4,
         $5
       )
       RETURNING
         id,
         drone_id,
         ST_Y(position::geometry) AS latitude,
         ST_X(position::geometry) AS longitude,
         altitude,
         battery_pct,
         recorded_at,
         ST_AsGeoJSON(position)   AS position_geojson`,
      [droneId, lat, lng, altitude, batteryPct ?? null]
    );
    const row = result.rows[0];
    return { ...row, position_geojson: JSON.parse(row.position_geojson) };
  }

  /**
   * Fetches the most recent telemetry for a drone.
   */
  async getLatestTelemetry(droneId: string): Promise<TelemetryRow | null> {
    const result: QueryResult = await this.pool.query(
      `SELECT
         id,
         drone_id,
         ST_Y(position::geometry) AS latitude,
         ST_X(position::geometry) AS longitude,
         altitude,
         battery_pct,
         recorded_at,
         ST_AsGeoJSON(position)   AS position_geojson
       FROM telemetry_logs
       WHERE drone_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [droneId]
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return { ...row, position_geojson: JSON.parse(row.position_geojson) };
  }

  /**
   * PostGIS spatial query: returns true if the drone's latest position is
   * inside the geofence polygon. Uses ST_Within for containment check.
   */
  async isDroneInsideGeofence(droneId: string): Promise<boolean> {
    const result: QueryResult = await this.pool.query(
      `SELECT ST_Within(
          (SELECT position FROM telemetry_logs
           WHERE drone_id = $1
           ORDER BY recorded_at DESC
           LIMIT 1),
          boundary
       ) AS inside_geofence
       FROM geofence_zones
       WHERE is_active = TRUE
       LIMIT 1`,
      [droneId]
    );
    return result.rows[0]?.inside_geofence === true;
  }

  /**
   * Returns the distance in meters between a drone's latest position and
   * an arbitrary point using PostGIS ST_Distance on a geography cast.
   */
  async distanceFromPointMeters(
    droneId: string,
    refLat: number,
    refLng: number
  ): Promise<number> {
    const result: QueryResult = await this.pool.query(
      `SELECT ST_Distance(
          (SELECT position::geography FROM telemetry_logs
           WHERE drone_id = $1
           ORDER BY recorded_at DESC
           LIMIT 1),
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
       ) AS distance_m`,
      [droneId, refLat, refLng]
    );
    return parseFloat(result.rows[0]?.distance_m ?? '0');
  }

  /**
   * Clears all telemetry logs for a drone. Call in afterEach for isolation.
   */
  async clearTelemetry(droneId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM telemetry_logs WHERE drone_id = $1',
      [droneId]
    );
  }

  /** Raw query access for ad-hoc test queries */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const result: QueryResult<T> = await this.pool.query(sql, params);
    return result.rows;
  }

  /** Gracefully shut down the pool. Called in globalTeardown. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
