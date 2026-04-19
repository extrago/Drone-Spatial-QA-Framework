# Drone-Spatial-QA-Framework

> **Production-grade Playwright + TypeScript automation framework** for an Autonomous Drone-Delivery system with Spatial Data Quality (GIS) validation using PostGIS and Turf.js.

[![CI](https://github.com/your-org/drone-spatial-qa-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/drone-spatial-qa-framework/actions)
[![Playwright](https://img.shields.io/badge/Playwright-1.44-45ba4b?logo=playwright)](https://playwright.dev)
[![PostGIS](https://img.shields.io/badge/PostGIS-15--3.3-336791?logo=postgresql)](https://postgis.net)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?logo=typescript)](https://www.typescriptlang.org)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Drone-Spatial-QA-Framework                      │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐   │
│  │  Playwright  │    │   Express API    │    │  Leaflet UI     │   │
│  │  Test Suite  │───▶│  /telemetry      │───▶│  Drone Map      │   │
│  │  (TypeScript)│    │  /drones         │    │  (Port 8080)    │   │
│  └──────┬───────┘    └────────┬─────────┘    └─────────────────┘   │
│         │                    │                                      │
│  ┌──────▼───────┐    ┌────────▼─────────┐                          │
│  │  DbClient.ts │    │  PostgreSQL       │                          │
│  │  (Singleton) │───▶│  + PostGIS 15    │                          │
│  └──────────────┘    │  (Port 5432)      │                          │
│                      └───────────────────┘                          │
│  ┌──────────────────────────────────────┐                          │
│  │  SpatialUtils.ts — Turf.js wrapper   │                          │
│  │  (maxDeviationMeters, isInsidePoly)  │                          │
│  └──────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
drone-spatial-qa-framework/
├── .github/workflows/ci.yml          # GitHub Actions CI
├── db/
│   └── init.sql                      # PostGIS schema + seed data
├── nginx/nginx.conf                   # Reverse proxy config
├── src/
│   ├── api/
│   │   ├── server.ts                 # Express entrypoint
│   │   ├── logger.ts                 # Winston structured logger
│   │   ├── db/postgresClient.ts      # Singleton pg.Pool (API)
│   │   └── routes/
│   │       ├── telemetry.ts          # POST /telemetry, GET /telemetry/:id/latest
│   │       └── drones.ts             # GET /drones
│   └── ui/
│       ├── index.html                # Leaflet map dashboard
│       ├── app.js                    # Polling + marker management
│       └── style.css                 # Dark-themed dashboard styles
├── tests/
│   ├── fixtures/base.fixture.ts      # Custom Playwright fixtures
│   ├── page-objects/DroneMapPage.ts  # POM for the drone map UI
│   ├── setup/
│   │   ├── globalSetup.ts            # DB connectivity + seed verification
│   │   └── globalTeardown.ts         # Pool cleanup
│   ├── specs/
│   │   ├── geofencing.spec.ts        # 5 tests — PostGIS ST_Within + UI alert
│   │   ├── pathDeviation.spec.ts     # 5 tests — Turf.js deviation assertions
│   │   ├── dbToUiIntegrity.spec.ts   # 4 tests — DB→API→UI round-trip
│   │   └── telemetryApi.spec.ts      # 9 tests — API contracts + concurrency
│   └── utils/
│       ├── DbClient.ts               # Singleton PostGIS query helper
│       └── SpatialUtils.ts           # Turf.js spatial calculations
├── docker-compose.yml
├── Dockerfile
├── playwright.config.ts
├── tsconfig.json
└── package.json
```

---

## Quick Start

### Prerequisites
- Docker Desktop ≥ 24
- Node.js 20 LTS
- npm ≥ 10

### 1 — Start infrastructure
```bash
# Clone and enter project
cd drone-spatial-qa-framework

# Copy env file
cp .env.example .env

# Spin up PostGIS + API + UI (one command)
docker compose up -d
```

### 2 — Install dependencies & browsers
```bash
npm ci
npx playwright install chromium firefox --with-deps
```

### 3 — Run all tests
```bash
npx playwright test
```

### 4 — Run a single suite
```bash
npm run test:geo        # Geofencing tests
npm run test:path       # Path deviation tests
npm run test:integrity  # DB-to-UI integrity tests
npm run test:api        # API contract tests
```

### 5 — View the Allure Report
```bash
npm run report
```

---

## Senior Engineering Decisions

### Why Playwright over Cypress or Selenium?

| Criterion | Playwright | Cypress | Selenium |
|---|---|---|---|
| Multi-browser (incl. Firefox) | ✅ Native | ⚠️ Chromium-only by default | ✅ With WebDriver |
| API testing in same framework | ✅ `APIRequestContext` | ❌ Separate tool needed | ❌ |
| Parallel worker control | ✅ `workers` config | ⚠️ Paid tier | ✅ Grid setup |
| Custom fixtures & dependency injection | ✅ First-class | ❌ | ❌ |
| TypeScript support | ✅ First-class | ⚠️ Configuration-heavy | ⚠️ |
| Network interception | ✅ `page.route()` | ✅ `cy.intercept()` | ❌ |

> **Decision**: Playwright's unified API context lets our test suite cover API contracts, database validation, and UI rendering in a single coherent framework — no tool-switching required.

---

### Why PostGIS for Spatial Integrity?

Standard relational databases store coordinates as plain `FLOAT` columns. This means:
- ❌ No indexed spatial queries (range scans on lat/lng columns scan full table)
- ❌ Polygon containment requires application-layer math on every row
- ❌ Distance calculations ignore Earth's curvature

**PostGIS with `GEOMETRY(Point, 4326)`** provides:

```sql
-- O(log n) spatial containment — uses GiST index
SELECT ST_Within(position, boundary)
FROM geofence_zones WHERE is_active = TRUE;

-- Geodesic distance with geographic cast — accounts for Earth's curvature
SELECT ST_Distance(
  position::geography,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
) AS distance_m;
```

> **Decision**: PostGIS is the **authoritative source of truth** for all spatial data. Tests that validate geofence logic query PostGIS directly (`ST_Within`), not the application layer. This eliminates bugs where the application logic contradicts the stored spatial data.

---

### How Turf.js Complements PostGIS

| Operation | Tool | Why |
|---|---|---|
| Geofence containment (persisted) | **PostGIS** `ST_Within` | Indexed, authoritative, runs server-side |
| Path deviation calculation | **Turf.js** `nearestPointOnLine` | Pure math assertion in test layer — no DB round-trip |
| GeoJSON feature construction | **Turf.js** | Browser-compatible, zero DB dependency |
| Coordinate distance (test assertion) | **Turf.js** `distance` | Haversine formula, fast for small sets |

> **Decision**: Turf.js handles **read-only spatial assertions in tests** where a DB query would add unnecessary latency. PostGIS handles all **persistent spatial data operations**. No duplication — each tool owns its layer.

---

### Singleton DB Pattern

`DbClient.ts` exposes a single `pg.Pool` via `getInstance()`:

```typescript
public static getInstance(): DbClient {
  if (!DbClient.instance) {
    DbClient.instance = new DbClient();
  }
  return DbClient.instance;
}
```

**Why**: Playwright runs tests in parallel workers. Without a Singleton, each test file would create its own pool — quickly exhausting PostgreSQL's `max_connections`. The singleton is safe in Node.js's single-threaded model and shared via the `globalSetup` lifecycle.

---

### SOLID Principles Applied

| Principle | Implementation |
|---|---|
| **S** — Single Responsibility | `DbClient` only manages DB I/O; `SpatialUtils` only calculates geometry; `DroneMapPage` only localises DOM elements |
| **O** — Open/Closed | `SpatialUtils` can be extended with new spatial methods without modifying existing ones |
| **L** — Liskov | All Playwright fixtures extend the base `test` type without breaking contract |
| **I** — Interface Segregation | `TelemetryRow` interface only exposes fields relevant to tests |
| **D** — Dependency Inversion | Test specs depend on `DbClient` abstraction, not directly on `pg.Pool` |

---

### Structured Logging for RCA

Winston is configured to emit **JSON in production** and **pretty-printed in development**:

```json
{
  "event": "telemetry_ingested",
  "drone_id": "DRONE-001",
  "latitude": 40.7484,
  "longitude": -73.9857,
  "altitude": 120,
  "inside_geofence": false,
  "timestamp": "2026-04-19T00:23:00.000Z"
}
```

When a test fails in CI, the Allure report includes the Playwright trace, screenshot, and the API server logs captured as an artifact — providing a complete RCA trail without requiring local reproduction.

---

## Test Coverage Summary

| Suite | Tests | Validates |
|---|---|---|
| `geofencing.spec.ts` | 5 | PostGIS `ST_Within`, API `geofence_alert`, UI alert banner |
| `pathDeviation.spec.ts` | 5 | Turf.js `nearestPointOnLine`, max/mean deviation, GeoJSON trail |
| `dbToUiIntegrity.spec.ts` | 4 | DB→API→UI round-trip, coordinate precision, last-write-wins |
| `telemetryApi.spec.ts` | 9 | API schema, validation errors, GeoJSON, concurrency (10 req) |
| **Total** | **23** | |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `dronedb` | Database name |
| `API_BASE_URL` | `http://localhost:3001` | Express API base |
| `UI_BASE_URL` | `http://localhost:8080` | Leaflet UI base |
| `MAX_PATH_DEVIATION_METERS` | `5` | Path deviation threshold |

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`):
1. Spins up `postgis/postgis:15-3.3` as a service container with health checks
2. Runs `db/init.sql` to initialise the PostGIS schema
3. Starts the Express API server and waits for `/health`
4. Runs `nginx:alpine` in Docker for the Leaflet UI
5. Executes the full Playwright test suite
6. Uploads Allure results as a persistent artifact (30-day retention)
7. Uploads traces, screenshots, and videos on failure for RCA
