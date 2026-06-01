"""
Generate a satellite view HTML map of the simulation polygon.
Opens in browser — no extra packages required beyond what's already installed.

Also saves a QGIS-importable coordinate info file so you can fetch a
georeferenced tile for Rhino.

Run:
  python get_satellite.py
"""
import json
import math
import webbrowser
from pathlib import Path

BBOX_W, BBOX_S = 72.572, 23.025
BBOX_E, BBOX_N = 72.576, 23.029
CENTER_LAT = (BBOX_S + BBOX_N) / 2
CENTER_LON = (BBOX_W + BBOX_E) / 2

# Approximate real-world size for reference
W_M = (BBOX_E - BBOX_W) * 111320 * math.cos(math.radians(CENTER_LAT))
H_M = (BBOX_N - BBOX_S) * 111320

html = f"""<!DOCTYPE html>
<html>
<head>
  <title>Sabarmati Riverfront — Satellite Patch</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body {{ margin: 0; font-family: monospace; }}
    #map {{ height: calc(100vh - 48px); width: 100vw; }}
    #info {{
      height: 48px; padding: 0 16px;
      display: flex; align-items: center; gap: 24px;
      background: #1a1a1a; color: #ccc; font-size: 12px;
    }}
    #info b {{ color: #00e5ff; }}
  </style>
</head>
<body>
<div id="info">
  <span><b>SW:</b> {BBOX_W}, {BBOX_S}</span>
  <span><b>NE:</b> {BBOX_E}, {BBOX_N}</span>
  <span><b>Size:</b> {W_M:.0f} m &times; {H_M:.0f} m</span>
  <span><b>Center:</b> {CENTER_LAT:.4f} N, {CENTER_LON:.4f} E</span>
  <span style="color:#aaa">Tiles: ESRI World Imagery | Labels: ESRI Boundaries</span>
</div>
<div id="map"></div>
<script>
  var map = L.map('map', {{ zoomControl: true }}).setView([{CENTER_LAT}, {CENTER_LON}], 18);

  // ESRI World Imagery (satellite — free, no token)
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}',
    {{ attribution: 'Tiles &copy; Esri &mdash; USDA, USGS, AEX, GeoEye, i-cubed', maxZoom: 20 }}
  ).addTo(map);

  // Transparent label overlay
  L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{{z}}/{{y}}/{{x}}',
    {{ maxZoom: 20, opacity: 0.6 }}
  ).addTo(map);

  // Simulation polygon (dashed cyan)
  var bounds = [[{BBOX_S}, {BBOX_W}], [{BBOX_N}, {BBOX_E}]];
  var poly = L.rectangle(bounds, {{
    color: '#00e5ff', weight: 2.5, fill: false, dashArray: '8 5'
  }}).addTo(map);
  poly.bindTooltip('Simulation polygon — {W_M:.0f} m x {H_M:.0f} m', {{ permanent: false }});

  // Corner markers with coordinates
  var corners = [
    ["{BBOX_S},{BBOX_W}", {BBOX_S}, {BBOX_W}],
    ["{BBOX_S},{BBOX_E}", {BBOX_S}, {BBOX_E}],
    ["{BBOX_N},{BBOX_E}", {BBOX_N}, {BBOX_E}],
    ["{BBOX_N},{BBOX_W}", {BBOX_N}, {BBOX_W}],
  ];
  corners.forEach(function(c) {{
    L.circleMarker([c[1], c[2]], {{ radius: 4, color: '#00e5ff', fillColor: '#fff', fillOpacity: 1, weight: 2 }})
      .bindTooltip(c[0]).addTo(map);
  }});

  map.fitBounds(bounds, {{ padding: [30, 30] }});
</script>
</body>
</html>"""

out = Path("results/satellite_view.html")
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"Saved: {out.resolve()}")

# Also save bbox as JSON for QGIS / Rhino import reference
bbox_info = {
    "crs": "WGS84 / EPSG:4326",
    "bbox": {"west": BBOX_W, "south": BBOX_S, "east": BBOX_E, "north": BBOX_N},
    "center": {"lon": CENTER_LON, "lat": CENTER_LAT},
    "size_m": {"width": round(W_M), "height": round(H_M)},
    "rhino_origin_sw_corner": {
        "lon": BBOX_W, "lat": BBOX_S,
        "note": "DotBim origin: X=east(m), Y=north(m), Z=height(m)"
    },
    "esri_satellite_url_template": (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/{z}/{y}/{x}"
    ),
    "google_earth_link": (
        f"https://earth.google.com/web/@{CENTER_LAT},{CENTER_LON},0a,600d,35y,0h,45t,0r"
    ),
}
(out.parent / "patch_bbox.json").write_text(json.dumps(bbox_info, indent=2))
print(f"Saved: results/patch_bbox.json  (bbox + Rhino origin reference)")
print(f"\nGoogle Earth direct link:")
print(f"  {bbox_info['google_earth_link']}")

webbrowser.open(out.resolve().as_uri())
print("\nOpened satellite view in browser.")
