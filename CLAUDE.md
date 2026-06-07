# UrbanShade — CLAUDE.md

## What this project is

**UrbanShade** is a full-stack web application for urban thermal comfort analysis and cooling intervention planning. Users draw a polygon anywhere in Europe, run a UTCI simulation via the Infrared SDK, and explore how tree planting and surface material changes affect the felt temperature — with a focus on the hottest 25% of the analysed area (hotspot zones).

Stack: **React + MapLibre GL** (frontend) · **FastAPI + Shapely** (backend) · **Infrared SDK** (UTCI model)

---

## Running the project

### Backend
```bash
cd backend
# activate venv, then:
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm run dev   # served at http://localhost:5173, proxied to :8000
```

Environment variable required in `backend/.env`:
```
INFRARED_API_KEY=your_key_here
```

---

## Architecture

```
Sabarmati-riverfront/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI entry point
│   │   ├── schemas.py           Pydantic models
│   │   ├── settings.py          Reads .env
│   │   ├── routers/
│   │   │   └── sims.py          API endpoints
│   │   └── services/
│   │       ├── infrared.py      Infrared SDK wrapper — baseline + scenario
│   │       └── auto_sim.py      Auto-simulate engine — best-scenario finder
│   └── .env                     (gitignored)
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── AreaPicker.jsx   Polygon draw + Nominatim search
│       │   ├── SplitViewer.jsx  Main viewer: left=3D axo, right=UTCI heatmap
│       │   ├── Sidebar.jsx      Stats panel (hotspot analysis prominently)
│       │   ├── TreePanel.jsx    Manual tree picker
│       │   └── AutoSimPanel.jsx Auto-simulate controls + result card + PDF
│       ├── utils/
│       │   └── hotspot.js       Hotspot cell stats + raster overlay builders
│       ├── store.js             Zustand state
│       └── api.js               fetch wrappers for all endpoints
└── datasets/
    ├── tree_species.csv         12 European species (canopy, cost, dimensions)
    └── surface_materials-costs.csv
```

---

## API endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/baseline` | Run baseline UTCI for a drawn polygon |
| `POST` | `/api/scenario` | Run manual scenario (painted zones + placed trees) |
| `POST` | `/api/best-scenario` | Auto-simulate: find best cooling intervention |
| `GET`  | `/api/trees` | Return all 12 tree species from CSV |

---

## SDK constraints — never forget

- Ground material keys: **only** `concrete`, `asphalt`, `soil`, `vegetation`, `water`
- `TimePeriod` must be a **single month** — multi-month fails server-side
- Pass the **same** `TimePeriod` object to `filter_weather_data` AND `_make_payload`
- `result.bounds` (not polygon bounds) to geo-reference the returned heatmap grid
- Buildings are in a **local metre frame** (SW corner = origin); ground materials are in lon/lat GeoJSON
- `run_area_and_wait()` accepts ground materials as `{sdk_key: FeatureCollection}` dicts
- Material zone geometry must be **clean** — always run `buffer(0)` and filter area < 1e-10 deg² before the SDK call (done in `infrared.py:run_scenario`)
- **Max reliable painted zones per call**: ~5 individual features. Passing all OSM features (can be 100+) causes the SDK call to fail silently

---

## Key decisions

| Decision | Outcome | Why |
|---|---|---|
| Geography | **Europe-wide** (Nominatim geocoder) | Not limited to Barcelona |
| Simulation month | **July**, 9am–18pm | Peak summer pedestrian heat stress |
| Hotspot metric | **Top 25% of cells by UTCI** | Mean across whole area dilutes impact of local interventions |
| Auto-sim species | **Tipuana tipu** (largest canopy, 10m radius) | Best UTCI impact per placement in hotspot zones |
| Auto-sim tree count | Up to **50 trees** per attempt, placed hottest-first | Reliable SDK limit; meaningful hotspot coverage |
| Material zones (auto-sim) | **Top 5 largest features** per material type | All-features approach causes SDK failures |
| Visual tree scale | `min(canopy_radius_m, 4.5)` for 3D display | Match scale of existing OSM trees; actual radius used for simulation |
| Tree colour (auto-placed) | **Lime green** `#84cc16` | Distinguishable from OSM trees (`#15803d`) |
| PDF screenshots | `preserveDrawingBuffer: true` + `map.getCanvas().toDataURL()` | Only reliable WebGL capture method in MapLibre |
| Costs | **EUR** | European context |

---

## Hotspot analysis (hotspot.js)

The core insight of UrbanShade: report improvement in the worst zones, not the whole area.

- **Threshold**: 75th percentile of baseline UTCI values (top 25% of cells)
- **Hotspot cells**: fixed from baseline — same indices used across all scenarios
- **`computeHotspotStats(baselineGrid, scenarioGrid)`**: returns `{baselineMean, scenarioMean, delta, threshold, cells}`
- **`buildHotspotOverlayUrl`**: renders hotspot cells as a semi-transparent red raster (shown on right map when no scenario active)
- **`buildImprovementOverlayUrl`**: renders per-cell improvement as red→green gradient (shown when scenario is active)

---

## Auto-simulate flow (auto_sim.py)

`run_best_scenario()` tries this ladder, stopping at first success:

1. Top-5 material zones + 50 trees in hottest zones
2. Top-5 material zones + 30 trees
3. Top-3 material zones + 30 trees
4. Trees only, 50
5. Trees only, 30
6. Trees only, 15

Tree placement: regular grid inside polygon with `spacing = canopy_radius × 2.5` (non-overlapping), sorted by descending UTCI value at each grid point using the baseline grid.

Returns: full scenario result + `meta.tree_placements` (for 3D map rendering) + `meta.species_name`, `meta.trees_count`, `meta.mat_zones`.

---

## Tree species dataset (datasets/tree_species.csv)

12 European/Mediterranean species. Key columns:

| Column | Notes |
|---|---|
| `id` | Used as `species_id` in all API calls |
| `canopy_radius_m` | Radius of canopy (half of displayed ⌀) |
| `trunk_height_m` | = `canopy_radius_m` for all species (min half-diameter rule) |
| `canopy_depth_m` | Vertical depth of canopy sphere |
| `planting_cost_eur` | One-time install cost |
| `annual_maintenance_eur` | Per-year upkeep |

3D rendering: sphere approximated by 10 horizontal ring slices (`fill-extrusion` in MapLibre). Display radius capped at 4.5m to match OSM tree scale; simulation uses actual `canopy_radius_m`.

---

## Surface material costs (infrared.py)

```python
MATERIAL_COSTS = {
    "concrete":   {"install": 55,  "demo": 8},
    "asphalt":    {"install": 32,  "demo": 8},
    "soil":       {"install": 22,  "demo": 8},
    "vegetation": {"install": 28,  "demo": 8},
    "water":      {"install": 180, "demo": 8},
}
# cost = area_m2 * (install + demo)
```

---

## Known limitations

- **Mean UTCI sensitivity**: ground material changes (asphalt→vegetation) have limited effect on mean UTCI across large areas — hotspot reporting is the correct framing
- **OSM material geometry**: can have self-intersections and slivers — always apply `buffer(0)` cleanup before SDK call
- **All-features material zones**: passing > ~10 individual polygon features as painted zones causes silent SDK failures; limit to top 5 by area
- **PDF image capture**: relies on `preserveDrawingBuffer: true` at map creation — cannot be changed after init; if images are blank, check this option is set
- **Simulation time**: each `run_area_and_wait()` call takes 25–60s depending on area size and SDK load
