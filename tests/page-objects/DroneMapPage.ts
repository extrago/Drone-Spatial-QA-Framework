import { Page, Locator, expect } from '@playwright/test';

/**
 * DroneMapPage — Page Object Model for the Leaflet Fleet Dashboard
 *
 * Design Decision: POM encapsulates all selector and interaction logic.
 * Tests express intent ("show alert visible") not mechanics ("find element
 * by data-testid and check display property"). This makes tests readable
 * and resilient to DOM refactors.
 */
export class DroneMapPage {
  private readonly page: Page;

  // ─── Locators ──────────────────────────────────────────────────────────────
  readonly geofenceAlert: Locator;
  readonly mapContainer: Locator;
  readonly droneList: Locator;
  readonly connectionStatus: Locator;
  readonly lastUpdated: Locator;

  constructor(page: Page) {
    this.page            = page;
    this.geofenceAlert   = page.getByTestId('geofence-alert');
    this.mapContainer    = page.locator('#map');
    this.droneList       = page.locator('#drone-list');
    this.connectionStatus = page.locator('#connection-status');
    this.lastUpdated     = page.locator('#last-updated');
  }

  // ─── Navigation ────────────────────────────────────────────────────────────
  async navigate(): Promise<void> {
    await this.page.goto('/');
    await this.waitForMapLoad();
  }

  /**
   * Waits for the Leaflet map tiles to render.
   * The Leaflet attribution control is the most reliable "map ready" signal
   * since it only appears after the tile layer is initialised.
   */
  async waitForMapLoad(): Promise<void> {
    await this.page.waitForSelector('.leaflet-control-attribution', { timeout: 15_000 });
    await expect(this.mapContainer).toBeVisible();
  }

  // ─── Geofence Alert ─────────────────────────────────────────────────────────
  async isGeofenceAlertVisible(): Promise<boolean> {
    return this.geofenceAlert.isVisible();
  }

  async waitForGeofenceAlert(visible: boolean, timeout = 10_000): Promise<void> {
    if (visible) {
      await expect(this.geofenceAlert).toBeVisible({ timeout });
    } else {
      await expect(this.geofenceAlert).toBeHidden({ timeout });
    }
  }

  async getGeofenceAlertText(): Promise<string> {
    return this.geofenceAlert.textContent() ?? '';
  }

  // ─── Drone Position ──────────────────────────────────────────────────────────
  /**
   * Reads the displayed lat/lng for a drone from sidebar data-testid elements.
   */
  async getDroneDisplayedCoordinates(droneId: string): Promise<{ lat: number; lng: number }> {
    const latLocator = this.page.getByTestId(`drone-lat-${droneId}`);
    const lngLocator = this.page.getByTestId(`drone-lng-${droneId}`);

    await expect(latLocator).toBeVisible({ timeout: 10_000 });
    await expect(lngLocator).toBeVisible({ timeout: 10_000 });

    const latText = await latLocator.textContent();
    const lngText = await lngLocator.textContent();

    return {
      lat: parseFloat(latText ?? '0'),
      lng: parseFloat(lngText ?? '0'),
    };
  }

  /**
   * Polls the sidebar until the displayed drone lat/lng matches the expected
   * values within a tolerance. Used for DB-to-UI integrity tests.
   *
   * @param droneId     Drone identifier
   * @param expectedLat Expected latitude
   * @param expectedLng Expected longitude
   * @param toleranceDeg Max allowed difference in degrees (default: 0.0001°)
   * @param timeout     Max wait in ms (default: 15s — allows 7 poll cycles)
   */
  async waitForDronePositionUpdate(
    droneId: string,
    expectedLat: number,
    expectedLng: number,
    toleranceDeg = 0.0001,
    timeout = 15_000
  ): Promise<void> {
    await expect(async () => {
      const coords = await this.getDroneDisplayedCoordinates(droneId);
      const latDiff = Math.abs(coords.lat - expectedLat);
      const lngDiff = Math.abs(coords.lng - expectedLng);

      if (latDiff > toleranceDeg || lngDiff > toleranceDeg) {
        throw new Error(
          `Drone ${droneId} position not updated yet. ` +
          `Got (${coords.lat}, ${coords.lng}), ` +
          `expected (${expectedLat}, ${expectedLng}) ±${toleranceDeg}°`
        );
      }
    }).toPass({ timeout, intervals: [2_000, 2_000, 2_000, 2_000, 2_000] });
  }

  // ─── Connection ─────────────────────────────────────────────────────────────
  async waitForLiveConnection(timeout = 10_000): Promise<void> {
    await expect(this.connectionStatus).toHaveText('Live', { timeout });
  }

  // ─── Drone Card ─────────────────────────────────────────────────────────────
  getDroneCard(droneId: string): Locator {
    return this.page.getByTestId(`drone-card-${droneId}`);
  }

  async isDroneCardBreached(droneId: string): Promise<boolean> {
    const card = this.getDroneCard(droneId);
    const classes = await card.getAttribute('class') ?? '';
    return classes.includes('breached');
  }
}
