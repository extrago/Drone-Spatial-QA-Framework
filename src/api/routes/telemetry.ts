import { Router, Request, Response } from 'express';
import { param, body, validationResult } from 'express-validator';
import { getPool } from '../db/postgresClient';
import { logger } from '../logger';

const router = Router();

// ─── POST /telemetry ──────────────────────────────────────────────────────────
// Ingest a drone telemetry record. Runs a PostGIS ST_Within check against
// the active geofence zone to flag out-of-bounds positions.
router.post(
  '/',
  [
    body('drone_id').isString().trim().notEmpty().withMessage('drone_id is required'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('latitude must be between -90 and 90'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('longitude must be between -180 and 180'),
    body('altitude').isFloat({ min: 0 }).withMessage('altitude must be a non-negative number'),
    body('battery_pct').optional().isFloat({ min: 0, max: 100 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', errors: errors.array() });
    }

    const { drone_id, latitude, longitude, altitude, battery_pct } = req.body as {
      drone_id: string;
      latitude: number;
      longitude: number;
      altitude: number;
      battery_pct?: number;
    };

    const pool = getPool();

    // Verify drone exists
    const droneCheck = await pool.query(
      'SELECT drone_id FROM drones WHERE drone_id = $1',
      [drone_id]
    );
    if (droneCheck.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: `Drone '${drone_id}' not found` });
    }

    // Insert telemetry using ST_MakePoint(lng, lat) — PostGIS convention: X=lng, Y=lat
    const insertResult = await pool.query<{
      id: number;
      recorded_at: string;
      position_geojson: string;
    }>(
      `INSERT INTO telemetry_logs (drone_id, position, altitude, battery_pct)
       VALUES (
         $1,
         ST_SetSRID(ST_MakePoint($3, $2), 4326),
         $4,
         $5
       )
       RETURNING
         id,
         recorded_at,
         ST_AsGeoJSON(position) AS position_geojson`,
      [drone_id, latitude, longitude, altitude, battery_pct ?? null]
    );

    const row = insertResult.rows[0];

    // PostGIS geofence check: ST_Within returns true if point is inside active zone
    const geofenceResult = await pool.query<{ inside_geofence: boolean }>(
      `SELECT ST_Within(
          ST_SetSRID(ST_MakePoint($2, $1), 4326),
          boundary
       ) AS inside_geofence
       FROM geofence_zones
       WHERE is_active = TRUE
       LIMIT 1`,
      [latitude, longitude]
    );

    const insideGeofence: boolean = geofenceResult.rows[0]?.inside_geofence ?? false;

    logger.info({
      event: 'telemetry_ingested',
      drone_id,
      latitude,
      longitude,
      altitude,
      inside_geofence: insideGeofence,
    });

    return res.status(201).json({
      status: 'ok',
      data: {
        id: row.id,
        drone_id,
        latitude,
        longitude,
        altitude,
        battery_pct: battery_pct ?? null,
        position_geojson: JSON.parse(row.position_geojson),
        inside_geofence: insideGeofence,
        geofence_alert: !insideGeofence,
        recorded_at: row.recorded_at,
      },
    });
  }
);

// ─── GET /telemetry/:droneId/latest ──────────────────────────────────────────
// Returns the most recent telemetry entry for a drone, including GeoJSON position
router.get(
  '/:droneId/latest',
  [
    param('droneId').isString().trim().notEmpty(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', errors: errors.array() });
    }

    const { droneId } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT
         t.id,
         t.drone_id,
         ST_Y(t.position::geometry) AS latitude,
         ST_X(t.position::geometry) AS longitude,
         t.altitude,
         t.battery_pct,
         t.recorded_at,
         ST_AsGeoJSON(t.position) AS position_geojson
       FROM telemetry_logs t
       WHERE t.drone_id = $1
       ORDER BY t.recorded_at DESC
       LIMIT 1`,
      [droneId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: `No telemetry found for drone '${droneId}'` });
    }

    const row = result.rows[0];
    return res.status(200).json({
      status: 'ok',
      data: {
        ...row,
        position_geojson: JSON.parse(row.position_geojson),
      },
    });
  }
);

export default router;
