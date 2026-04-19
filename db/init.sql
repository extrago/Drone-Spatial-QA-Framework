-- ─────────────────────────────────────────────────────────────────────────────
-- Drone Spatial QA Framework — Database Initialization
-- PostGIS spatial extension + schema + seed data
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable PostGIS spatial capabilities
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- ─── Drones Table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drones (
  id          SERIAL PRIMARY KEY,
  drone_id    VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  model       VARCHAR(100) DEFAULT 'DJI-Phantom-X',
  status      VARCHAR(20)  DEFAULT 'active'
                           CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── Telemetry Logs Table ─────────────────────────────────────────────────────
-- Uses GEOMETRY(Point, 4326) — WGS84 coordinate system (standard GPS)
-- ST_SetSRID(ST_MakePoint(lng, lat), 4326) on insert
CREATE TABLE IF NOT EXISTS telemetry_logs (
  id          SERIAL PRIMARY KEY,
  drone_id    VARCHAR(50)  NOT NULL REFERENCES drones(drone_id) ON DELETE CASCADE,
  position    GEOMETRY(Point, 4326) NOT NULL,
  altitude    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  battery_pct NUMERIC(5, 2)  CHECK (battery_pct BETWEEN 0 AND 100),
  speed_ms    NUMERIC(6, 2)  DEFAULT 0,
  heading_deg NUMERIC(5, 2)  DEFAULT 0,
  recorded_at TIMESTAMPTZ   DEFAULT NOW()
);

-- ─── Geofence Zones Table ─────────────────────────────────────────────────────
-- Stores named polygon zones used for boundary validation
CREATE TABLE IF NOT EXISTS geofence_zones (
  id          SERIAL PRIMARY KEY,
  zone_name   VARCHAR(100) UNIQUE NOT NULL,
  boundary    GEOMETRY(Polygon, 4326) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- GiST index accelerates spatial queries (ST_Within, ST_Distance, etc.)
CREATE INDEX IF NOT EXISTS idx_telemetry_position
  ON telemetry_logs USING GIST(position);

CREATE INDEX IF NOT EXISTS idx_telemetry_drone_time
  ON telemetry_logs(drone_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_boundary
  ON geofence_zones USING GIST(boundary);

-- ─── Seed Data ────────────────────────────────────────────────────────────────
INSERT INTO drones (drone_id, name, model, status) VALUES
  ('DRONE-001', 'Alpha Delivery',   'DJI-Phantom-X', 'active'),
  ('DRONE-002', 'Beta Scout',       'DJI-Mavic-Pro',  'active'),
  ('DRONE-003', 'Gamma Cargo',      'DJI-Cargo-X',    'active')
ON CONFLICT (drone_id) DO NOTHING;

-- Seed initial positions (downtown area — WGS84: lng, lat)
INSERT INTO telemetry_logs (drone_id, position, altitude, battery_pct) VALUES
  ('DRONE-001',
    ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326),  -- New York, Midtown
    120.5, 87.3),
  ('DRONE-002',
    ST_SetSRID(ST_MakePoint(-73.9812, 40.7520), 4326),
    85.0, 64.2),
  ('DRONE-003',
    ST_SetSRID(ST_MakePoint(-73.9880, 40.7460), 4326),
    200.0, 45.8);

-- Seed default operational geofence (Midtown Manhattan bounding box)
INSERT INTO geofence_zones (zone_name, boundary) VALUES (
  'MIDTOWN_OPS_ZONE',
  ST_SetSRID(
    ST_MakePolygon(
      ST_GeomFromText(
        'LINESTRING(
          -74.0010 40.7380,
          -73.9700 40.7380,
          -73.9700 40.7600,
          -74.0010 40.7600,
          -74.0010 40.7380
        )'
      )
    ),
  4326)
) ON CONFLICT (zone_name) DO NOTHING;
