# Barcelona Urban Heat Tool - Development Plan

## Goal
An interactive Gradio web app where a user:
1. Picks a small patch of Barcelona on a map
2. Sees the baseline UTCI thermal comfort heatmap (July, 9 am-6 pm)
3. Paints surface material changes onto zones (draw polygon + pick material)
4. Sees the delta UTCI heatmap (scenario - baseline)
5. Sees a EUR cost estimate for the change

## Architecture

  app.py  (Gradio UI)
    Tab 1: Pick location -> run_baseline()  -> results/baseline_*.npy/.json
    Tab 2: Paint map     -> run_scenario()  -> results/scenario_*.npy / delta_*.npy

  simulate.py  (pipeline functions, also CLI)
    step_00()  smoke test
    step_01()  dataset validation
    step_02()  baseline UTCI
    step_03()  scenario UTCI (receives painted_layers dict)

## Step 0 - Environment smoke test
  python simulate.py --step 0
  - Load INFRARED_API_KEY from .env
  - Call client.preview_area(POLYGON, thermal_comfort_index)
  - TEST: tile_count == 1

## Step 1 - Dataset validation
  python simulate.py --step 1
  - Load surface_materials-costs.csv and demolition_costs.csv
  - TEST: 5 materials, correct sdk_keys, EUR cost columns present

## Step 2 - Baseline UTCI simulation
  python simulate.py --step 2  OR  run_baseline(lat, lon) from app
  Pipeline: weather -> buildings (OSM) -> ground materials -> UTCI
  Saves: baseline_grid.npy, baseline_meta.json, baseline_buildings.json,
         baseline_ground_materials.json
  TEST: grid.ndim==2, 32 < mean_utci < 50

## Step 3 - Scenario UTCI (painted materials)
  run_scenario(painted_json) from app
  - Parse painted zones from Leaflet painter
  - Merge into scenario_gm = {**baseline_gm, **painted_gm}
  - Re-run UTCI, compute delta = scenario - baseline
  Saves: scenario_grid.npy, delta_grid.npy
  TEST: delta.shape == baseline.shape, vegetation -> negative delta

## Step 4 - Gradio UI
  Tab 1: lat/lon inputs + Run Baseline button -> UTCI heatmap + stats
  Tab 2: Leaflet map painter (draw polygon + material dropdown)
         -> Run Scenario -> scenario heatmap + delta + EUR cost
  Acceptance: baseline in <60s, delta shows cooling for vegetation zones

## Step 5 - Batch scenario runner (scenarios.py) [future]
  Auto-run all 5 material swaps for full polygon, rank by UTCI improvement per EUR

## Step 6 - Cost scoring (scoring.py) [future]
  score = sum(cooling_c_m2) / total_cost_eur
  Output: ranked leaderboard

## Step 7 - Trees layer [future]
  Vegetation point features passed to run_area_and_wait(vegetation=...)

## SDK constraints
  - Ground material keys: concrete, asphalt, soil, vegetation, water only
  - TimePeriod: single month only
  - Location required for UTCI/TCS
  - Tile: 512m x 512m max, 1m resolution

## Barcelona reference polygons
  Eixample (default): SW [2.163, 41.393] NE [2.167, 41.397]  classic grid, high UHI
  Born/Gothic:        SW [2.177, 41.381] NE [2.181, 41.385]  dense medieval streets
  Poblenou:           SW [2.195, 41.397] NE [2.199, 41.401]  industrial->residential
  Gracia:             SW [2.154, 41.398] NE [2.158, 41.402]  narrow streets + plazas

## Steps completed
  [x] Datasets updated to EUR (Barcelona context)
  [x] simulate.py - steps 0-3 pipeline
  [x] app.py - Gradio UI with map painter + delta heatmap
  [ ] Step 0 smoke test for Barcelona polygon
  [ ] Baseline UTCI run confirmed
  [ ] Painter -> scenario loop tested end-to-end
  [ ] scenarios.py and scoring.py
  [ ] Trees layer
