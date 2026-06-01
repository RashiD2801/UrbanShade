# Sabarmati Riverfront — Thermal Comfort Tool

## What this project is
A simulation tool that takes a patch of the Sabarmati Riverfront promenade in Ahmedabad,
runs UTCI (thermal comfort) and TCS (heat stress hours) analyses via the Infrared SDK,
and ranks material-swap / tree-planting interventions by cost-effectiveness.

End deliverable: a Gradio web app where a user selects an area on a map, sees a diagnostic
report (baseline heat stress, sun exposure), and gets ranked recommendations with delta heatmaps
and a cost-per-degree-improvement score.

## Running the steps

```
python simulate.py --step 0    # API key + tile count smoke test
python simulate.py --step 1    # load and validate CSVs
python simulate.py --step 2    # OSM surface check (2a) + building fetch (2b)
python explore_osm.py          # fetch all layers, render interactive HTML map
```

## Key constants — defined in simulate.py AND explore_osm.py (keep in sync)

```python
POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [72.572, 23.025], [72.576, 23.025],
        [72.576, 23.029], [72.572, 23.029],
        [72.572, 23.025],
    ]],
}
# 410 m x 445 m at 23°N — single 512 m tile confirmed
# Bridge (lat~23.027) centred in polygon; covers river + promenade + bridge context
```

If POLYGON changes, update both files and re-run `--step 0` to confirm tile count = 1.

## Decisions locked in

| Decision | Outcome | Why |
|---|---|---|
| Surface data path | **A2** — blanket concrete polygon | Overpass unreachable from this network; OSM has no concrete tags for promenade anyway |
| Building model | **Mode A** — SDK-fetched OSM buildings (290 buildings) | Passes east-bank centroid test |
| Ground materials baseline | SDK layers (river + asphalt road) + blanket concrete | River is in OSM `water` layer, must be preserved for realistic UTCI |
| Operating month | **May** (start_month=5) | Peak Ahmedabad summer, pre-monsoon |
| Time window | **9–18** (9 am – 6 pm) | Peak outdoor use hours |
| 3D model | **User-supplied .obj** file with trees and structures | Rhino model in progress; will be converted to DotBim for SDK |

## .obj model input (Mode B fallback / supplement)

When the user provides a `.obj` model:
1. Place it as `rhino_model.obj` in the repo root.
2. Run `python convert_obj.py` (to be written in Step 2B-obj) — converts to DotBim
   using `trimesh`, maps coordinates to polygon-bbox-SW meter frame.
3. Update `MODE = "B"` in `simulate.py` if switching away from SDK buildings.
4. Trees in the .obj should be extracted as GeoJSON Points for the vegetation layer.

DotBim coordinate frame: origin = SW corner of POLYGON bbox, X = east, Y = north, Z = height.
SW corner in meters: lon=72.572, lat=23.025 → (0, 0, 0).

## Dataset files (datasets/)

| File | Rows | Key columns |
|---|---|---|
| `trees_shade-cost.csv` | 34 | canopy_area_sqm, cost_per_sqm_shade_inr, cost_per_tree_inr |
| `surface_materials-costs.csv` | 5 | material, sdk_key, utci_reduction_vs_concrete_c, total_10yr_cost_per_sqm |
| `demolition_costs.csv` | 1 | demolition_cost_per_sqm_inr = 380 |

SDK ground_material key mapping: `grass→vegetation`, `water_feature→water` (others unchanged).

## SDK constraints to never forget

- Ground material keys: ONLY `concrete`, `asphalt`, `soil`, `vegetation`, `water`.
- `TimePeriod` must be a **single month** (multi-month fails server-side, as of 2026-04).
- `Location(latitude, longitude)` required for every UTCI/TCS call.
- Pass the **same** `TimePeriod` to `filter_weather_data` AND the analysis payload.
- `result.bounds` (not polygon bounds) to geo-reference heatmaps.
- TCS grid = absolute hours; divide by `len(weather_data)` for fraction.
- Vegetation points: lon/lat GeoJSON. Buildings: local meter frame (SW corner = origin).

## File layout

```
Sabarmati-riverfront/
├── CLAUDE.md               <- you are here
├── DEVELOPMENT_PLAN.md     <- step-by-step plan with tests
├── simulate.py             <- steps 0-7 as functions
├── explore_osm.py          <- fetch + visualise all OSM layers
├── scenarios.py            <- step 5: smart scenario builder (not yet written)
├── scoring.py              <- step 7: cost-effectiveness metrics (not yet written)
├── app.py                  <- step 8: Gradio webapp (not yet written)
├── convert_obj.py          <- .obj -> DotBim converter (not yet written)
├── rhino_model.obj         <- user-supplied 3D model (pending)
├── datasets/
│   ├── trees_shade-cost.csv
│   ├── surface_materials-costs.csv
│   └── demolition_costs.csv
├── results/                <- gitignored; .npy grids, JSONs, HTML maps
│   ├── ground_materials_baseline.json
│   ├── mode.json
│   └── osm_layers.html
├── .env                    <- INFRARED_API_KEY (gitignored)
└── .env.example
```

## Steps completed so far

- [x] Step 0 — API key + single-tile smoke test
- [x] Step 1 — datasets loaded and validated
- [x] Step 2A — OSM surface check → Path A2 (blanket concrete)
- [x] Step 2B — SDK building fetch → Mode A (290 buildings, east-bank confirmed)
- [x] explore_osm.py — all layers visualised; river confirmed in `water` layer
