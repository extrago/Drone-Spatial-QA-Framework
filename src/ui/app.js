/**
 * Drone Fleet Dashboard — Leaflet Map Application
 *
 * Architecture:
 * - Polls GET /api/drones every POLL_INTERVAL ms (configurable)
 * - Maintains a map of active Leaflet markers indexed by drone_id
 * - Checks geofence breach by testing if any drone marker is flagged
 * - Updates data-testid attributes so Playwright can assert DOM state
 */

'use strict';

const API_BASE       = '/api';
const POLL_INTERVAL  = 2000;  // ms — must match UI_POLL_INTERVAL_MS in .env
const MAP_CENTER     = [40.7484, -73.9857]; // NYC Midtown
const MAP_ZOOM       = 14;

// ─── Geofence polygon (mirrors DB seed in init.sql — WGS84) ───────────────────
const GEOFENCE_COORDS = [
  [40.7380, -74.0010],
  [40.7380, -73.9700],
  [40.7600, -73.9700],
  [40.7600, -74.0010],
];

// ─── Leaflet Map Setup ────────────────────────────────────────────────────────
const map = L.map('map', {
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  zoomControl: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

// Geofence polygon overlay — dashed blue border
L.polygon(GEOFENCE_COORDS, {
  color:       '#58a6ff',
  weight:      2,
  dashArray:   '8 4',
  fillColor:   '#58a6ff',
  fillOpacity: 0.05,
}).addTo(map).bindPopup('<b>Operational Geofence Zone</b><br>MIDTOWN_OPS_ZONE');

// ─── State ────────────────────────────────────────────────────────────────────
const markers       = {};   // { drone_id: L.Marker }
let   globalBreached = false;

// ─── Drone Icon Factory ────────────────────────────────────────────────────────
function makeDroneIcon(breached) {
  return L.divIcon({
    className: '',
    html: `<div class="drone-icon ${breached ? 'breached' : ''}">✈</div>`,
    iconSize:   [32, 32],
    iconAnchor: [16, 16],
  });
}

// ─── Geofence Alert UI ────────────────────────────────────────────────────────
function showGeofenceAlert(droneIds) {
  const el  = document.getElementById('geofence-alert');
  const msg = document.getElementById('geofence-alert-message');
  if (el && msg) {
    msg.textContent = `⚠ GEOFENCE BREACH: ${droneIds.join(', ')} outside operational zone`;
    el.classList.remove('hidden');
  }
}
function hideGeofenceAlert() {
  const el = document.getElementById('geofence-alert');
  if (el) el.classList.add('hidden');
}
function dismissAlert() {
  hideGeofenceAlert();
}

// ─── Sidebar Update ───────────────────────────────────────────────────────────
function updateSidebar(drones) {
  const list = document.getElementById('drone-list');
  if (!list) return;
  list.innerHTML = drones.map((d) => {
    const lat  = d.latitude  != null ? Number(d.latitude).toFixed(5)  : 'N/A';
    const lng  = d.longitude != null ? Number(d.longitude).toFixed(5) : 'N/A';
    const batt = d.battery_pct != null ? `${Number(d.battery_pct).toFixed(1)}%` : 'N/A';
    const alt  = d.altitude  != null ? `${Number(d.altitude).toFixed(1)} m` : 'N/A';
    return `
      <li class="drone-card ${d.geofence_alert ? 'breached' : ''}"
          data-testid="drone-card-${d.drone_id}"
          onclick="focusDrone('${d.drone_id}')">
        <div class="drone-card-header">
          <span class="drone-id">${d.drone_id}</span>
          <span class="drone-badge ${d.geofence_alert ? 'danger' : ''}">
            ${d.geofence_alert ? 'BREACH' : 'IN ZONE'}
          </span>
        </div>
        <div class="drone-meta">
          <span>Lat: <span class="value" data-testid="drone-lat-${d.drone_id}">${lat}</span></span>
          <span>Lng: <span class="value" data-testid="drone-lng-${d.drone_id}">${lng}</span></span>
          <span>Alt: <span class="value">${alt}</span></span>
          <span>Bat: <span class="value">${batt}</span></span>
        </div>
      </li>`;
  }).join('');
}

// ─── Focus on Drone ───────────────────────────────────────────────────────────
function focusDrone(droneId) {
  const marker = markers[droneId];
  if (marker) {
    map.setView(marker.getLatLng(), 16, { animate: true });
    marker.openPopup();
  }
}

// ─── Main Poll Function ───────────────────────────────────────────────────────
async function fetchAndRender() {
  const statusEl = document.getElementById('connection-status');
  const dotEl    = document.getElementById('status-dot');
  const countEl  = document.getElementById('drone-count');

  try {
    const res  = await fetch(`${API_BASE}/drones`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const json = await res.json();
    const drones = json.data || [];

    // Update connection status
    if (statusEl) statusEl.textContent = 'Live';
    if (dotEl)    { dotEl.className = 'status-dot'; dotEl.classList.add('online'); }
    if (countEl)  countEl.textContent = `${drones.length} drone${drones.length !== 1 ? 's' : ''} active`;

    const breachedDrones = [];

    drones.forEach((drone) => {
      const lat   = parseFloat(drone.latitude);
      const lng   = parseFloat(drone.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const breached = !!drone.geofence_alert;
      if (breached) breachedDrones.push(drone.drone_id);

      if (markers[drone.drone_id]) {
        // Update existing marker
        markers[drone.drone_id].setLatLng([lat, lng]);
        markers[drone.drone_id].setIcon(makeDroneIcon(breached));
      } else {
        // Create new marker
        const marker = L.marker([lat, lng], { icon: makeDroneIcon(breached) })
          .addTo(map)
          .bindPopup(`
            <b>${drone.drone_id}</b><br>
            <span data-testid="popup-lat-${drone.drone_id}">Lat: ${lat}</span><br>
            <span data-testid="popup-lng-${drone.drone_id}">Lng: ${lng}</span><br>
            Alt: ${drone.altitude ?? 'N/A'} m
          `);

        // Attach testid to the marker element after adding to DOM
        marker.on('add', () => {
          const el = marker.getElement();
          if (el) el.setAttribute('data-testid', `drone-marker-${drone.drone_id}`);
        });

        markers[drone.drone_id] = marker;
      }
    });

    // Geofence alert management
    if (breachedDrones.length > 0) {
      if (!globalBreached) {
        showGeofenceAlert(breachedDrones);
        globalBreached = true;
      }
    } else {
      if (globalBreached) {
        hideGeofenceAlert();
        globalBreached = false;
      }
    }

    updateSidebar(drones);

    const updated = document.getElementById('last-updated');
    if (updated) updated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    console.error('[Dashboard] Poll error:', err);
    if (statusEl) statusEl.textContent = 'Disconnected';
    if (dotEl)    { dotEl.className = 'status-dot'; dotEl.classList.add('offline'); }
  }
}

// ─── Drone Icon CSS (injected) ────────────────────────────────────────────────
const iconStyle = document.createElement('style');
iconStyle.textContent = `
  .drone-icon {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
    background: rgba(88, 166, 255, 0.15);
    border: 1px solid #58a6ff;
    border-radius: 50%;
    color: #58a6ff;
    transition: all 0.2s;
  }
  .drone-icon.breached {
    background: rgba(248, 81, 73, 0.2);
    border-color: #f85149;
    color: #f85149;
    animation: pulse 1.2s infinite;
  }
`;
document.head.appendChild(iconStyle);

// ─── Init & Poll Loop ─────────────────────────────────────────────────────────
fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL);
