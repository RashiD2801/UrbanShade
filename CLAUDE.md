# Barcelona Urban Heat Tool

## What this project is
An interactive Gradio web app where a user picks a small patch of Barcelona,
runs a baseline UTCI (thermal comfort) simulation via the Infrared SDK,
paints surface material changes onto the map (draw polygon → assign material),
and instantly sees the delta UTCI heatmap plus a EUR cost estimate.

## Running the steps

```
python simulate.py --step 0    # API key + tile count smoke test
python simulate.py --step 1    # validate datasets
python simulate.py --step 2    # run baseline UTCI (default Eixample polygon)
python app.py                  # launch the full interactive tool
```

## Key constants — defined in simulate.py (default Eixample patch)

```python
POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [2.163, 41.393], [2.167, 41.393],
        [2.167, 41.397], [2.163, 41.397],
        [2.163, 41.393],
    ]],
}
# ~334 m x 445 m at 41.4 N — single 512 m tile
# The app lets users pick any location interactively.
```

If POLYGON changes, re-run `--step 0` to confirm tile_count = 1.

## Decisions locked in

| Decision | Outcome | Why |
|---|---|---|
| City | **Barcelona** | Mediterranean climate, UHI well-documented, ESRI imagery |
| Operating month | **July** (start_month=7) | Peak summer heat |
| Time window | **9–18** (9 am – 6 pm) | Peak pedestrian hours |
| Building source | **SDK OSM Mode A** | Good OSM coverage in Barcelona |
| Material palette | **5 SDK keys only**: concrete, asphalt, soil, vegetation, water | SDK constraint |
| Costs | **EUR** | Barcelona context |
| Trees layer | **Not yet** — added later | Scope decision |

## SDK constraints to never forget

- Ground material keys: ONLY `concrete`, `asphalt`, `soil`, `vegetation`, `water`.
- `TimePeriod` must be a **single month** (multi-month fails server-side).
- `Location(latitude, longitude)` required for every UTCI call.
- Pass the **same** `TimePeriod` to `filter_weather_data` AND the analysis payload.
- `result.bounds` (not polygon bounds) to geo-reference heatmaps.
- Vegetation points: lon/lat GeoJSON. Buildings: local metre frame (SW corner = origin).

## Dataset files (datasets/)

| File | Rows | Key columns |
|---|---|---|
| `surface_materials-costs.csv` | 5 | sdk_key, utci_reduction_vs_concrete_c, total_10yr_cost_per_sqm_eur |
| `demolition_costs.csv` | 1 | demolition_cost_per_sqm_eur = 8 |

## File layout

```
barcelona-heat-tool/
├── CLAUDE.md               <- you are here
├── DEVELOPMENT_PLAN.md     <- step-by-step plan
├── simulate.py             <- steps 0-3 as functions + CLI
├── app.py                  <- Gradio webapp (painter + results)
├── scenarios.py            <- (future) batch scenario runner
├── scoring.py              <- (future) cost-effectiveness metrics
├── datasets/
│   ├── surface_materials-costs.csv
│   └── demolition_costs.csv
├── results/                <- gitignored; .npy grids, JSONs
│   ├── baseline_grid.npy
│   ├── baseline_meta.json
│   ├── baseline_buildings.json
│   ├── baseline_ground_materials.json
│   ├── scenario_grid.npy   (after scenario run)
│   └── delta_grid.npy
├── .env                    <- INFRARED_API_KEY (gitignored)
└── .env.example
```

## Steps completed

- [x] Datasets updated to EUR (Barcelona context)
- [x] simulate.py — steps 0-3 (baseline + scenario pipeline)
- [x] app.py — Gradio UI with map painter + delta heatmap
- [ ] Step 0 smoke test for Barcelona polygon
- [ ] Baseline UTCI run confirmed
- [ ] Painter → scenario loop tested end-to-end
- [ ] scenarios.py — batch material swap runner
- [ ] scoring.py — EUR/degree improvement metric
- [ ] Trees layer
