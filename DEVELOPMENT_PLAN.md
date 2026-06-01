# Development Plan — Sabarmati Riverfront Thermal Comfort Tool
_Last updated after Step 1 completion_

---

## Goal
A web app where a user draws a patch on a map (or runs against a fixed Rhino model stretch),
receives a diagnostic read of current conditions, then sees simulation results for intelligently
placed interventions — ranked by cost-effectiveness. Output is a clear report, not just raw numbers.

---

## Two operating modes

| | Mode A — OSM + area selection | Mode B — Rhino fixed model |
|---|---|---|
| **Trigger** | OSM buildings usable (Step 2B passes) | OSM buildings sparse / missing |
| **Polygon** | User draws on the map | Fixed ~300–500 m stretch from Rhino file |
| **Buildings** | SDK-fetched from OSM | DotBim mesh loaded from Rhino export |
| **Ground materials** | SDK-fetched or OSM `surface=*` | Manually defined (all concrete baseline) |
| **UI** | Map picker + run panel | Run-only panel (polygon shown, not editable) |

Both modes share the same simulation pipeline (Steps 3–8). Only the data ingestion differs.

---

## Key facts from the datasets (confirmed in Step 1)

**Materials** (SDK key mapping applied):

| Material | SDK key | UTCI benefit | 10yr cost/sqm incl. demolition |
|---|---|---|---|
| soil | `soil` | +5°C | INR 1530 |
| concrete | `concrete` | baseline | INR 3800 |
| grass | `vegetation` | +8°C | INR 8730 |
| water_feature | `water` | +12°C | INR 16880 |
| asphalt | `asphalt` | −2°C | **excluded** |

**Top tree shortlist** (by cost_per_sqm_shade, canopy ≥ 75 sqm):

| Species | Common name | Canopy sqm | Cost/sqm shade |
|---|---|---|---|
| Delonix regia | Krishnachura | 300 | INR 4 |
| Areca catechu | Betel palm | 300 | INR 4 |
| Ficus religiosa | Peepul | 300 | INR 4 |
| Acacia auriculacformis | Akashmoni | 150 | INR 4.67 |
| Aegle marmelos | Bel | 300 | INR 5 |

**Demolition:** INR 380/sqm (concrete removal before any material swap).

---

## SDK constraints (carry through all steps)

- Ground material keys: only `concrete`, `asphalt`, `soil`, `vegetation`, `water`.
- `TimePeriod` must be a **single month** (server limit as of 2026-04).
- `Location(latitude, longitude)` required for UTCI/TCS and direct-sun-hours.
- Pass the **same** `TimePeriod` to `filter_weather_data` and to the payload.
- Pin polygon + EPW identifier + TimePeriod across all scenarios; vary only the layer being redesigned.
- TCS grid = absolute hours; divide by window length to get fraction.
- `result.bounds` (not polygon bounds) to geo-reference the bitmap in any map viewer.

---

## Site constants (updated after OSM visualisation)

```python
POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [72.572, 23.027],
        [72.576, 23.027],
        [72.576, 23.031],
        [72.572, 23.031],
        [72.572, 23.027],
    ]],
}
# 410 m x 445 m at 23°N — single tile confirmed.
# Shifted 0.0025 deg west from original to cover:
#   left half  = Sabarmati River (water layer present, evaporative cooling)
#   right half = promenade strip + minimal east-bank buildings (183 buildings)
LOCATION = Location(latitude=23.029, longitude=72.574)
```

---

## Steps

### Step 0 — Environment setup ✅ DONE
Single tile confirmed. API key valid.

### Step 1 — Load and validate datasets ✅ DONE
All 34 trees, 5 materials, demolition cost validated. SDK key mapping applied. Tree shortlist built.

---

### Step 2A — Decision branch: surface data

**Goal:** establish the baseline `ground_materials` for the promenade (all concrete).

#### Path A1 — OSM `surface=*` tags (preferred)

Query Overpass API:
```
[out:json][timeout:30];
(
  way["surface"](23.027,72.5745,23.031,72.5785);
  relation["surface"](23.027,72.5745,23.031,72.5785);
);
out geom;
```
Convert to GeoJSON FeatureCollection; extract polygons where `surface` in
{`concrete`, `paved`, `asphalt`}.

**Test to pass:** retrieved polygons cover ≥ 80% of the promenade footprint area.
If pass → `ground_materials_baseline = {"concrete": <osm_fc>}`.
If fail → Path A2.

#### Path A2 — Blanket concrete polygon (fallback)

The entire promenade polygon becomes one concrete FeatureCollection:
```python
ground_materials_baseline = {
    "concrete": {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": POLYGON, "properties": {}}]
    }
}
```
This is coarser but valid for comparison — all scenarios are compared against the same baseline.

**Test to pass:** dict has `"concrete"` key, polygon is valid GeoJSON, no UUID keys.

**Record which path was taken** at the top of `simulate.py` as `SURFACE_DATA_PATH = "A1"` or `"A2"`.

---

### Step 2B — Decision branch: 3D building model

#### Path B1 — SDK-fetched OSM buildings (Mode A)

```python
area = client.buildings.get_area(POLYGON)
buildings = area.buildings
```

**Test to pass:** `len(buildings) >= 5` AND at least one building centroid east of 72.577°.
If pass → Mode A is active; enable map area-selection in the webapp.

#### Path B2 — User-supplied .obj model (Mode B / supplement)

The user will supply a `.obj` model of the riverfront with trees and structures.
Place it as `rhino_model.obj` in the repo root and run `python convert_obj.py`.

**`convert_obj.py` must do:**

```python
import trimesh, math, json
from pathlib import Path

# Load .obj
scene = trimesh.load("rhino_model.obj", force="scene")

# Origin for coordinate frame: SW corner of POLYGON bbox
ORIGIN_LON, ORIGIN_LAT = 72.572, 23.027
LON_SCALE = 111320 * math.cos(math.radians(23.029))   # m per deg lon
LAT_SCALE = 111320                                      # m per deg lat

buildings = {}
veg_points = []

for name, geom in scene.geometry.items():
    verts = geom.vertices.copy()     # (N, 3) XYZ in model space
    # Convert model coords -> local meter frame:
    #   if model is in meters with (0,0) = ORIGIN, no change needed.
    #   if model is in lon/lat, convert: x = (lon - ORIGIN_LON)*LON_SCALE etc.
    flat_coords = verts.flatten().tolist()   # [x0,y0,z0, x1,y1,z1, ...]
    flat_idx    = geom.faces.flatten().tolist()
    if "tree" in name.lower() or "veg" in name.lower():
        # Use centroid as a vegetation Point
        c = geom.centroid
        veg_points.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [
                ORIGIN_LON + c[0] / LON_SCALE,
                ORIGIN_LAT + c[1] / LAT_SCALE,
            ]},
            "properties": {"species": name, "crown_radius": 5.0, "height": 10},
        })
    else:
        buildings[name] = {"coordinates": flat_coords, "indices": flat_idx}

json.dump({"buildings": buildings, "vegetation": veg_points},
          open("results/obj_model.json", "w"), indent=2)
print(f"Converted: {len(buildings)} buildings, {len(veg_points)} trees")
```

Install trimesh: `pip install trimesh`.

**Coordinate frame note:** the SDK needs buildings in polygon-bbox-SW frame
(SW corner of POLYGON = origin, X = east meters, Y = north meters, Z = height).
If the .obj uses real-world coordinates, subtract the SW corner before flattening.

**Test to pass:** `buildings` dict has ≥ 1 entry; all `coordinates` are flat float lists;
`veg_points` has at least as many trees as the .obj contains; no NaN in coordinates.

**Mode B consequence:** the webapp shows a fixed polygon overlay (not editable).
The user selects scenario parameters and sees before/after impact clearly.

---

### Step 3 — Weather data

```python
locations = client.weather.get_weather_file_from_location(
    lat=23.029, lon=72.5765, radius=150
)
WEATHER_ID = locations[0]["uuid"]
TP = TimePeriod(
    start_month=5, start_day=1, start_hour=9,
    end_month=5, end_day=31, end_hour=18,
)
weather_data = client.weather.filter_weather_data(
    identifier=WEATHER_ID, time_period=TP,
)
```

**Month: May** — peak Ahmedabad summer (Tmax ~42°C, pre-monsoon, worst heat stress).
Hours 9–18 = peak outdoor use window. Single month enforced by server limitation.

Store `WEATHER_ID` and `TP` as module constants. Never change them between scenario runs.

**Test to pass:** `len(locations) >= 1`; station `fileName` contains "IND" or "India";
`len(weather_data)` is approximately `31 × 9 = 279` entries (EPW resolution may vary).

---

### Step 4 — Diagnostic runs (NEW)

Run three analyses in one pooled call before designing any scenarios.
The outputs drive **where** trees are placed and **which zones** get material swaps.

```python
from infrared_sdk.analyses.types import SolarModelRequest, AnalysesName

sun_payload = SolarModelRequest(
    analysis_type=AnalysesName.direct_sun_hours,
    latitude=LOCATION.latitude,
    longitude=LOCATION.longitude,
    time_period=TP,
)
utci_baseline_payload = UtciModelRequest.from_weatherfile_payload(
    payload=UtciModelBaseRequest(analysis_type=AnalysesName.thermal_comfort_index),
    location=LOCATION, time_period=TP, weather_data=weather_data,
)
tcs_baseline_payload = TcsModelRequest.from_weatherfile_payload(
    payload=TcsModelBaseRequest(
        analysis_type=AnalysesName.thermal_comfort_statistics,
        subtype=TcsSubtype.heat_stress,
    ),
    location=LOCATION, time_period=TP, weather_data=weather_data,
)

sun_result, utci_baseline, tcs_baseline = client.run_area_and_wait(
    [sun_payload, utci_baseline_payload, tcs_baseline_payload],
    POLYGON,
    buildings=buildings,
    vegetation={},
    ground_materials=ground_materials_baseline,
)
```

Save all three grids to `results/diag_sun.npy`, `results/diag_utci.npy`, `results/diag_tcs.npy`.

**Test to pass:**
- All three jobs succeeded (`succeeded_jobs == total_jobs` for each result)
- `nanmean(utci_baseline.merged_grid) > 35` — promenade is in strong heat stress
- `nanmean(tcs_baseline.merged_grid) / 279 > 0.7` — >70% of daytime hours are heat-stressed
- `nanmean(sun_result.merged_grid) > 50` — promenade receives significant direct sun

---

### Step 5 — Smart scenario design (REVISED)

Scenarios are no longer whole-promenade swaps. Interventions are placed only where
diagnostics show they will do the most work.

#### 5a — Define smart zones from diagnostics

```python
import numpy as np

valid = ~np.isnan(utci_baseline.merged_grid)
sun_grid = sun_result.merged_grid

# UTCI hotspot zone: top 40% hottest cells
utci_vals = utci_baseline.merged_grid[valid]
utci_threshold = np.percentile(utci_vals, 60)   # top 40% = above 60th percentile
hotspot_mask = (utci_baseline.merged_grid > utci_threshold) & valid

# High-sun zone: top 30% highest direct sun hours (best locations for tree planting)
sun_vals = sun_grid[valid]
sun_threshold = np.percentile(sun_vals, 70)     # top 30% = above 70th percentile
high_sun_mask = (sun_grid > sun_threshold) & valid
```

Convert pixel masks → GeoJSON FeatureCollections (via rasterio vectorize or shapely):
- `hotspot_fc` — polygon(s) covering the UTCI hotspot zone → used as target area for material swaps
- `high_sun_fc` — polygon(s) covering the high-sun zone → used as target area for tree placement

**Test to pass:** `hotspot_mask.sum() / valid.sum()` ≈ 0.38–0.42 (tolerance ±5%);
`high_sun_mask.sum() / valid.sum()` ≈ 0.28–0.32. Both FCs are valid GeoJSON.

#### 5b — Smart tree placement

Place tree GeoJSON Points **only inside `high_sun_mask` zones**, at a spacing of
`crown_diameter + 1 m` buffer (species-dependent):

```python
import math

def place_trees(species_row, zone_fc, lon_origin, lat_origin):
    crown_radius = math.sqrt(species_row["canopy_area_sqm"] / math.pi)
    spacing_m = crown_radius * 2 + 1.0
    # Generate a lon/lat grid inside the zone polygon bounding box,
    # test each point for containment, output GeoJSON Points
    ...
```

Tree properties per Point:
```python
{
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [lon, lat]},
    "properties": {
        "species": species_row["Species"],
        "crown_radius": crown_radius,
        "height": 12,
        "trunk_height": 2.5,
    }
}
```

**Scenarios T1–T3:** Krishnachura, Peepul, Bel — each placed in the high-sun zone.
Record `n_trees` and `upfront_cost = n_trees * cost_per_tree_inr`.

#### 5c — Smart material swap zones

Replace **only** the `hotspot_fc` polygon with the target material (not the whole promenade):

```python
def make_material_swap(baseline_gm, hotspot_fc, sdk_key):
    # Remove hotspot area from existing concrete layer, add it as new material
    remaining_concrete = subtract_polygon(baseline_gm["concrete"], hotspot_fc)
    new_layers = {**baseline_gm, "concrete": remaining_concrete, sdk_key: hotspot_fc}
    return new_layers
```

Scenarios:
- **S1 — Soil in hotspots** (hotspot_fc → `soil`)
- **S2 — Grass in hotspots** (hotspot_fc → `vegetation`)
- **S3 — Water feature in hotspots** (hotspot_fc → `water`)
- **C1 — Soil + Krishnachura trees** (material swap + tree scenario combined)

Budget scenarios (how much of the hotspot area can a given budget treat):
- **B1 — INR 10 L:** `floor(budget / total_10yr_cost_per_sqm)` sqm of soil from hotspot
- **B2 — INR 50 L:** soil swap + as many Krishnachura trees as budget allows

**Test to pass:** all `ground_materials` dicts use only valid SDK keys; no UUID keys;
hotspot polygon subtraction yields valid, non-self-intersecting GeoJSON;
all vegetation Point coordinates fall inside the promenade polygon bbox.

---

### Step 6 — Run all scenarios

```python
results = {}

for scenario in scenarios:
    utci_r, tcs_r = client.run_area_and_wait(
        [utci_payload, tcs_payload],
        POLYGON,
        buildings=buildings,
        vegetation=scenario["vegetation"],
        ground_materials=scenario["ground_materials"],
    )
    results[scenario["name"]] = {"utci": utci_r, "tcs": tcs_r}
    np.save(f"results/{scenario['name']}_utci.npy", utci_r.merged_grid)
    np.save(f"results/{scenario['name']}_tcs.npy", tcs_r.merged_grid)
```

Run sequentially. Each single-tile UTCI+TCS pair takes ~30–60 s; budget ~15 min for 8 scenarios.

**Test to pass:** zero failed jobs across all scenarios.
If a job fails, re-run that scenario once before stopping.

---

### Step 7 — Scoring and report generation (REVISED)

#### 7a — Cost-effectiveness metrics

```python
valid = ~np.isnan(utci_baseline.merged_grid)
window_hours = 279   # approximate, use exact len(weather_data)

for name, r in results.items():
    delta_utci = utci_baseline.merged_grid - r["utci"].merged_grid  # positive = cooler
    delta_tcs  = tcs_baseline.merged_grid  - r["tcs"].merged_grid   # positive = fewer stress hrs

    mean_delta_utci = delta_utci[valid].mean()
    delta_tcs_pct   = delta_tcs[valid].mean() / window_hours

    treated_sqm = scenarios[name]["treated_area_sqm"]
    cost_per_sqm = scenarios[name]["total_10yr_cost_per_sqm"]

    utci_per_inr = mean_delta_utci / cost_per_sqm     # °C per INR (per sqm, 10yr)
    tcs_per_inr  = delta_tcs_pct   / cost_per_sqm     # fraction per INR

    # Co-benefits (for tree scenarios):
    n_trees = scenarios[name].get("n_trees", 0)
    carbon_kg_yr = n_trees * species_row["carbon_sequestration_kg_yr"]
    o2_kg_yr     = n_trees * species_row["o2_generation_kg_yr"]
    shade_sqm    = n_trees * species_row["canopy_area_sqm"]
```

#### 7b — Report content (per scenario)

Each scenario's report card contains:
1. **UTCI improvement map** — delta heatmap (diverging colormap, 0-centred)
2. **Thermal stress reduction** — % of previously stressed hours now comfortable
3. **Intervention map** — where trees/material swaps are placed, overlaid on the promenade outline
4. **Cost breakdown** — upfront INR, 10yr INR, INR per °C of improvement
5. **Co-benefits** — shade sqm, carbon kg/yr, O2 kg/yr (tree scenarios only)
6. **Recommendation text** — one sentence: "Planting X Krishnachura trees in high-sun zones
   reduces heat stress hours by Y% at INR Z per sqm over 10 years."

Export `results/ranking.csv` and `results/report_cards.json`.

**Test to pass:** ranking table has all columns populated; at least one scenario achieves
`mean_delta_utci > 3°C`; report cards JSON is valid; UTCI and TCS scores correlate directionally
(scenarios with higher UTCI improvement should also have lower heat-stress hours).

---

### Step 8 — Gradio web app (NEW)

**Stack:** Gradio 6.13.0 + Leaflet iframe + Plotly heatmaps.
Deployable to HuggingFace Spaces (set `INFRARED_API_KEY` as a Space Secret).

#### Layout

```
┌─────────────────────────────────────┬──────────────────────────┐
│  [Tabs: Map | Diagnostics | Results]│  [Run panel]             │
│                                     │  Scenario dropdown       │
│  Map tab:                           │  Run button              │
│    Leaflet map (area selection)     │  Status / progress       │
│    OR fixed polygon (Mode B)        │                          │
│                                     │                          │
│  Diagnostics tab:                   │  [Report panel]          │
│    Sun hours heatmap                │  Cost/sqm                │
│    Baseline UTCI heatmap            │  UTCI improvement        │
│    Smart zone overlay               │  Heat stress reduction   │
│                                     │  Co-benefits             │
│  Results tab:                       │  Recommendation text     │
│    Scenario selector                │                          │
│    Delta UTCI heatmap               │                          │
│    Ranked scenario table            │                          │
└─────────────────────────────────────┴──────────────────────────┘
```

#### Mode A (OSM + area selection)

- User clicks on the Leaflet map → lat/lon written to Gradio number inputs.
- "Fetch area" button → calls SDK for buildings, vegetation, ground_materials.
- Layer outlines rendered on the map (buildings as polygons, trees as dots, materials colour-coded).
- "Run diagnostics" → Step 4 (sun hours + baseline UTCI + TCS).
- Smart zones shown as overlays on the map.
- "Run all scenarios" → Steps 5–6.
- Results tab auto-selected when simulations complete.

#### Mode B (Rhino fixed polygon)

- Map shows fixed polygon outline (non-editable).
- No "Fetch area" step.
- User goes directly to "Run diagnostics" → "Run all scenarios".
- All other tabs behave identically.

#### Key Gradio implementation notes

- Use one `gr.State` dict as the single source of truth: `area`, `layers`, `diagnostics`, `runs`.
- Auto-switch to `Results` tab after the last scenario completes.
- Guard the run path: if "Run all scenarios" is clicked before diagnostics, run diagnostics first silently.
- Use `result.bounds` (not polygon coords) to geo-reference heatmap PNGs in Leaflet.
- Never show empty `gr.HTML` or `gr.Markdown` blocks — use `visible=False`.
- Use `gr.update(selected="results_tab")` to switch tabs programmatically.
- All SDK calls run in a background thread via `gr.State` + `asyncio` to avoid blocking the UI.

#### Acceptance checklist

- [ ] Leaflet map renders in the Map tab; clicks update lat/lon inputs (Mode A)
- [ ] Fixed polygon visible on map in Mode B
- [ ] Diagnostics tab shows sun hours + baseline UTCI side by side
- [ ] Smart zone overlay shows where trees / material swaps will be placed
- [ ] Running a scenario auto-switches to Results tab
- [ ] Delta UTCI heatmap renders with diverging colormap centred at 0
- [ ] Ranked table shows all 8 scenarios sorted by UTCI/INR score
- [ ] Report card text is human-readable for the top scenario
- [ ] All SDK calls do not block the UI thread

**Test to pass:** app launches with `python app.py` and all tabs render without error.
A full run from map click → diagnostics → scenarios → report completes without manual intervention.

---

## Updated file layout

```
Sabarmati-riverfront/
├── datasets/
│   ├── trees_shade-cost.csv
│   ├── surface_materials-costs.csv
│   └── demolition_costs.csv
├── rhino_model.bim          # Mode B only — Rhino DotBim export
├── simulate.py              # Steps 0–7 as functions, CLI runner
├── scenarios.py             # Step 5 scenario builder (smart zone logic)
├── scoring.py               # Step 7 metrics + report card generation
├── app.py                   # Step 8 Gradio webapp
├── results/                 # .npy grids, ranking.csv, report_cards.json (gitignored)
├── .env                     # INFRARED_API_KEY (gitignored)
├── .env.example
├── .gitignore
└── DEVELOPMENT_PLAN.md
```

---

## Decision summary

```
Step 2A: surface data
├── OSM ≥80% coverage → OSM polygons as concrete baseline
└── <80% → blanket concrete polygon (entire promenade outline)

Step 2B: buildings
├── SDK fetch ≥5 buildings with east-bank coverage → Mode A (user area selection)
└── sparse / missing → Rhino DotBim → Mode B (fixed polygon, no selection)

Both decisions are independent. Any combination is valid.
Smart zone logic (Step 5) is identical in both modes.
```

---

## Dependency graph

```
0 ✅ → 1 ✅ → 2A → 2B ─┐
                        ├→ 3 (weather)
                        ├→ 4 (diagnostics: sun + baseline UTCI/TCS)
                        ├→ 5 (smart zones from diagnostic grids)
                        ├→ 6 (run all scenarios)
                        ├→ 7 (score + report)
                        └→ 8 (Gradio webapp — parallel with 3–7,
                               integrates all prior steps at runtime)
```
