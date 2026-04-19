import { Router, Request, Response } from 'express';
import { getPool } from '../db/postgresClient';
import { logger } from '../logger';

const router = Router();

// ─── GET /drones ──────────────────────────────────────────────────────────────
// Returns all active drones with their latest telemetry position.
// Uses a LATERAL JOIN so we only hit the telemetry table once per drone.
router.get('/', async (_req: Request, res: Response) => {
  const pool = getPool();

  const result = await pool.query(
    `SELECT
       d.drone_id,
       d.name,
       d.model,
       d.status,
       d.created_at,
       latest.latitude,
       latest.longitude,
       latest.altitude,
       latest.battery_pct,
       latest.recorded_at   AS last_seen,
       latest.position_geojson
     FROM drones d
     LEFT JOIN LATERAL (
       SELECT
         ST_Y(position::geometry)  AS latitude,
         ST_X(position::geometry)  AS longitude,
         altitude,
         battery_pct,
         recorded_at,
         ST_AsGeoJSON(position)    AS position_geojson
       FROM telemetry_logs
       WHERE drone_id = d.drone_id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE d.status = 'active'
     ORDER BY d.drone_id`
  );

  logger.info({ event: 'drones_listed', count: result.rowCount });

  return res.status(200).json({
    status: 'ok',
    data: result.rows.map((row) => ({
      ...row,
      position_geojson: row.position_geojson ? JSON.parse(row.position_geojson) : null,
    })),
  });
});

// ─── GET /drones/:droneId ───────────────────────────────────────────────────
router.get('/:droneId', async (req: Request, res: Response) => {
  const { droneId } = req.params;
  const pool = getPool();

  const result = await pool.query(
    `SELECT drone_id, name, model, status, created_at FROM drones WHERE drone_id = $1`,
    [droneId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ status: 'error', message: `Drone '${droneId}' not found` });
  }

  return res.status(200).json({ status: 'ok', data: result.rows[0] });
});

export default router;
