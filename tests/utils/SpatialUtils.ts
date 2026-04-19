import * as turf from '@turf/turf';
import {
  Feature,
  Point,
  LineString,
  Polygon,
  Position,
  FeatureCollection,
} from 'geojson';

/**
 * SpatialUtils — Turf.js Wrapper for Client-Side Spatial Calculations
 *
 * Design Decision: Wrapping Turf.js methods provides:
 * 1. A clean, domain-specific API (drone-centric method names)
 * 2. Consistent unit handling (always output meters, input WGS84)
 * 3. Single point of change if Turf.js API changes between versions
 *
 * How Turf.js complements PostGIS:
 * - PostGIS: authoritative server-side spatial checks (ST_Within, ST_Distance)
 * - Turf.js: fast client-side geometry (test assertions, deviation math)
 *   No DB round-trip needed for path deviation calculations.
 */
export class SpatialUtils {

  /**
   * Creates a GeoJSON Feature<Point> from lat/lng.
   * Note: GeoJSON uses [longitude, latitude] ordering per RFC 7946.
   */
  pointToFeature(lat: number, lng: number): Feature<Point> {
    return turf.point([lng, lat]);
  }

  /**
   * Builds a GeoJSON LineString from an array of [lat, lng] coordinate pairs.
   */
  buildLineString(coords: Array<[number, number]>): Feature<LineString> {
    // Convert [lat, lng] → [lng, lat] for GeoJSON
    const positions: Position[] = coords.map(([lat, lng]) => [lng, lat]);
    return turf.lineString(positions);
  }

  /**
   * Calculates whether a point is inside a polygon.
   * @param lat        Point latitude
   * @param lng        Point longitude
   * @param polygonCoords  Array of [lat, lng] pairs (ring) — auto-closed
   * @returns true if the point is inside the polygon
   */
  isInsidePolygon(
    lat: number,
    lng: number,
    polygonCoords: Array<[number, number]>
  ): boolean {
    const pt = this.pointToFeature(lat, lng);
    // Convert and close the ring (first == last)
    const positions: Position[] = polygonCoords.map(([rlat, rlng]) => [rlng, rlat]);
    if (
      positions[0][0] !== positions[positions.length - 1][0] ||
      positions[0][1] !== positions[positions.length - 1][1]
    ) {
      positions.push(positions[0]);
    }
    const poly = turf.polygon([positions]);
    return turf.booleanPointInPolygon(pt, poly);
  }

  /**
   * Great-circle distance in meters between two lat/lng points.
   */
  distanceBetweenMeters(
    lat1: number, lng1: number,
    lat2: number, lng2: number
  ): number {
    const from = this.pointToFeature(lat1, lng1);
    const to   = this.pointToFeature(lat2, lng2);
    return turf.distance(from, to, { units: 'meters' });
  }

  /**
   * Computes the MAXIMUM perpendicular deviation (in meters) between a
   * planned path (LineString) and a set of actual telemetry coordinates.
   *
   * Algorithm:
   *   For each actual point, find the nearest point on the planned LineString
   *   using turf.nearestPointOnLine, then measure the distance. Return max.
   *
   * This is the core assertion in pathDeviation.spec.ts:
   *   assert maxDeviationMeters ≤ 5
   */
  maxDeviationMeters(
    plannedCoords: Array<[number, number]>,
    actualCoords: Array<[number, number]>
  ): number {
    const plannedLine = this.buildLineString(plannedCoords);
    let maxDeviation = 0;

    for (const [lat, lng] of actualCoords) {
      const actualPt     = this.pointToFeature(lat, lng);
      const nearestPt    = turf.nearestPointOnLine(plannedLine, actualPt, { units: 'meters' });
      const deviation    = nearestPt.properties?.dist ?? 0;
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
      }
    }

    return maxDeviation;
  }

  /**
   * Computes the mean deviation for all actual points against planned path.
   * Useful for trend analysis beyond the max-deviation assertion.
   */
  meanDeviationMeters(
    plannedCoords: Array<[number, number]>,
    actualCoords: Array<[number, number]>
  ): number {
    const plannedLine = this.buildLineString(plannedCoords);
    const deviations  = actualCoords.map(([lat, lng]) => {
      const pt      = this.pointToFeature(lat, lng);
      const nearest = turf.nearestPointOnLine(plannedLine, pt, { units: 'meters' });
      return nearest.properties?.dist ?? 0;
    });
    return deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
  }

  /**
   * Builds a GeoJSON FeatureCollection from telemetry rows for visualisation
   * or further Turf.js operations.
   */
  buildDroneGeoJSONTrail(
    coords: Array<{ lat: number; lng: number; altitude?: number }>
  ): FeatureCollection<Point> {
    const features: Feature<Point>[] = coords.map(({ lat, lng, altitude }) =>
      turf.point([lng, lat], { altitude: altitude ?? 0 })
    );
    return turf.featureCollection(features);
  }
}
