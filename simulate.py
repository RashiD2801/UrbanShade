"""
Barcelona Urban Heat Tool — simulation pipeline.
Run individual steps with:
  python simulate.py --step 0    # API key + tile count smoke test
  python simulate.py --step 1    # validate datasets
  python simulate.py --step 2    # run baseline UTCI for default polygon
"""
import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Default site polygon — Eixample, Barcelona
# Change this or let the app pick any area interactively.
# ---------------------------------------------------------------------------
POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [2.163, 41.393], [2.167, 41.393],
        [2.167, 41.397], [2.163, 41.397],
        [2.163, 41.393],
    ]],
}
# ~334 m x 445 m at 41.4 N — single 512 m tile
# Eixample grid: mix of asphalt roads, concrete sidewalks, inner courtyards

CENTER_LAT = 41.395
CENTER_LON =  2.165

# SDK operating window — summer peak in Barcelona
START_MONTH, END_MONTH = 7, 7   # July
START_HOUR,  END_HOUR  = 9, 18  # 9 am – 6 pm

# Valid SDK ground material keys
VALID_SDK_KEYS = {"concrete", "asphalt", "soil", "vegetation", "water"}


# ---------------------------------------------------------------------------
# Step 0 — Environment smoke test
# ---------------------------------------------------------------------------

def step_00():
    print("=" * 60)
    print("STEP 0 — Environment smoke test")
    print("=" * 60)

    api_key = os.environ.get("INFRARED_API_KEY")
    if not api_key:
        print("\n[FAIL] INFRARED_API_KEY not set. Create .env with INFRARED_API_KEY=your_key")
        sys.exit(1)
    print(f"  API key loaded: {api_key[:6]}{'*' * (len(api_key) - 6)}")

    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import AnalysesName

    print("  Connecting to Infrared API ...")
    with InfraredClient() as client:
        preview = client.preview_area(POLYGON, analysis_type=AnalysesName.thermal_comfort_index)

    tc = preview.tile_count
    print(f"  Tile count : {tc}")
    print(f"  Est. time  : {preview.estimated_time_s} s")
    print(f"  Est. cost  : {preview.estimated_cost_tokens} tokens")

    if tc != 1:
        print(f"\n[WARN] tile_count = {tc} — polygon may be too large. Adjust POLYGON so it fits in 1 tile.")
    else:
        print("\n[PASS] Step 0 complete — single tile, API key valid.")


# ---------------------------------------------------------------------------
# Step 1 — Validate datasets
# ---------------------------------------------------------------------------

def step_01():
    print("=" * 60)
    print("STEP 1 — Dataset validation")
    print("=" * 60)

    mats = pd.read_csv("datasets/surface_materials-costs.csv")
    demo = pd.read_csv("datasets/demolition_costs.csv")

    assert len(mats) == 5, f"Expected 5 materials, got {len(mats)}"
    assert set(mats["sdk_key"]) == VALID_SDK_KEYS, f"SDK key mismatch: {set(mats['sdk_key'])}"
    assert "total_10yr_cost_per_sqm_eur" in mats.columns
    assert "utci_reduction_vs_concrete_c" in mats.columns
    assert "demolition_cost_per_sqm_eur" in demo.columns

    demolition_cost = float(demo["demolition_cost_per_sqm_eur"].iloc[0])

    print(f"\n  Materials ({len(mats)} rows):")
    for _, r in mats.iterrows():
        print(f"    {r['sdk_key']:<12s}  UTCI delta={r['utci_reduction_vs_concrete_c']:+.0f}C"
              f"  10yr={r['total_10yr_cost_per_sqm_eur']} EUR/m2")
    print(f"\n  Demolition cost: {demolition_cost} EUR/m2")
    print("\n[PASS] Step 1 complete.")
    return mats, demolition_cost


# ---------------------------------------------------------------------------
# Step 2 — Run baseline UTCI
# ---------------------------------------------------------------------------

def step_02(polygon=None):
    print("=" * 60)
    print("STEP 2 — Baseline UTCI simulation")
    print("=" * 60)

    poly = polygon or POLYGON
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True)

    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import (
        AnalysesName, UtciModelRequest, UtciModelBaseRequest,
    )
    from infrared_sdk.models import TimePeriod, Location

    coords = poly["coordinates"][0]
    lat = (min(c[1] for c in coords) + max(c[1] for c in coords)) / 2
    lon = (min(c[0] for c in coords) + max(c[0] for c in coords)) / 2
    loc = Location(latitude=lat, longitude=lon)
    tp  = TimePeriod(
        start_month=START_MONTH, start_day=1,  start_hour=START_HOUR,
        end_month=END_MONTH,     end_day=31,   end_hour=END_HOUR,
    )

    with InfraredClient() as client:
        print("  Fetching weather ...")
        wfiles = client.weather.get_weather_file_from_location(lat=lat, lon=lon, radius=150)
        weather_data = client.weather.filter_weather_data(
            identifier=wfiles[0]["uuid"], time_period=tp,
        )
        print(f"  Weather rows: {len(weather_data)}")

        print("  Fetching OSM buildings ...")
        area = client.buildings.get_area(poly)
        print(f"  Buildings: {len(area.buildings)}")

        print("  Fetching ground materials ...")
        area_gm = client.ground_materials.get_area(poly)
        gm = {k: v for k, v in area_gm.layers.items() if k in VALID_SDK_KEYS}
        for k, fc in gm.items():
            print(f"    {k}: {len(fc.get('features', []))} features")

        print("  Running UTCI ...")
        payload = UtciModelRequest.from_weatherfile_payload(
            payload=UtciModelBaseRequest(analysis_type=AnalysesName.thermal_comfort_index),
            location=loc, time_period=tp, weather_data=weather_data,
        )
        result = client.run_area_and_wait(
            payload, poly,
            buildings=area.buildings,
            ground_materials=gm,
        )

    grid = result.merged_grid
    zmin = result.min_legend if result.min_legend is not None else float(np.nanmin(grid))
    zmax = result.max_legend if result.max_legend is not None else float(np.nanmax(grid))

    import json
    np.save(results_dir / "baseline_grid.npy", grid)
    (results_dir / "baseline_meta.json").write_text(json.dumps({
        "zmin": zmin, "zmax": zmax,
        "mean_utci": float(np.nanmean(grid)),
        "max_utci":  float(np.nanmax(grid)),
        "polygon": poly,
        "n_buildings": len(area.buildings),
    }))
    bld_data = {}
    for bid, mesh in area.buildings.items():
        coords_list = mesh.coordinates if hasattr(mesh, "coordinates") else mesh.get("coordinates", [])
        idxs_list   = mesh.indices    if hasattr(mesh, "indices")    else mesh.get("indices", [])
        bld_data[bid] = {"coordinates": list(coords_list), "indices": list(idxs_list)}
    (results_dir / "baseline_buildings.json").write_text(json.dumps(bld_data))
    (results_dir / "baseline_ground_materials.json").write_text(json.dumps(gm))

    print(f"\n  Mean UTCI: {np.nanmean(grid):.1f} C  Max: {np.nanmax(grid):.1f} C")
    print(f"  Grid shape: {grid.shape}")
    print("\n[PASS] Step 2 complete — baseline saved to results/")
    return grid, zmin, zmax


# ---------------------------------------------------------------------------
# Step 3 — Run scenario UTCI (with painted materials)
# ---------------------------------------------------------------------------

def step_03(painted_layers: dict, polygon=None):
    """
    painted_layers: dict[sdk_key, GeoJSON FeatureCollection] — overrides baseline.
    Merges with baseline ground materials, re-runs UTCI, returns delta grid.
    """
    print("=" * 60)
    print("STEP 3 — Scenario UTCI (painted materials)")
    print("=" * 60)

    import json
    results_dir = Path("results")
    poly = polygon or POLYGON

    baseline_grid = np.load(results_dir / "baseline_grid.npy")
    meta = json.loads((results_dir / "baseline_meta.json").read_text())
    buildings_data = json.loads((results_dir / "baseline_buildings.json").read_text())
    baseline_gm = json.loads((results_dir / "baseline_ground_materials.json").read_text())

    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import (
        AnalysesName, UtciModelRequest, UtciModelBaseRequest,
    )
    from infrared_sdk.models import TimePeriod, Location
    from infrared_sdk.buildings.types import DotBimMesh

    coords_list = poly["coordinates"][0]
    lat = (min(c[1] for c in coords_list) + max(c[1] for c in coords_list)) / 2
    lon = (min(c[0] for c in coords_list) + max(c[0] for c in coords_list)) / 2
    loc = Location(latitude=lat, longitude=lon)
    tp  = TimePeriod(
        start_month=START_MONTH, start_day=1,  start_hour=START_HOUR,
        end_month=END_MONTH,     end_day=31,   end_hour=END_HOUR,
    )

    scenario_gm = {**baseline_gm, **painted_layers}

    buildings = {
        bid: DotBimMesh(
            mesh_id=i,
            coordinates=v["coordinates"],
            indices=v["indices"],
        )
        for i, (bid, v) in enumerate(buildings_data.items())
    }

    with InfraredClient() as client:
        wfiles = client.weather.get_weather_file_from_location(lat=lat, lon=lon, radius=150)
        weather_data = client.weather.filter_weather_data(
            identifier=wfiles[0]["uuid"], time_period=tp,
        )
        payload = UtciModelRequest.from_weatherfile_payload(
            payload=UtciModelBaseRequest(analysis_type=AnalysesName.thermal_comfort_index),
            location=loc, time_period=tp, weather_data=weather_data,
        )
        result = client.run_area_and_wait(
            payload, poly,
            buildings=buildings,
            ground_materials=scenario_gm,
        )

    scenario_grid = result.merged_grid
    delta = scenario_grid - baseline_grid

    np.save(results_dir / "scenario_grid.npy", scenario_grid)
    np.save(results_dir / "delta_grid.npy", delta)

    print(f"  Mean delta UTCI: {float(np.nanmean(delta)):+.2f} C")
    print(f"  Max improvement: {float(np.nanmin(delta)):+.2f} C")
    print("\n[PASS] Step 3 complete.")
    return scenario_grid, delta


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", required=True, choices=["0", "1", "2", "3"])
    args = parser.parse_args()

    if   args.step == "0": step_00()
    elif args.step == "1": step_01()
    elif args.step == "2": step_02()
    elif args.step == "3":
        print("Step 3 requires painted_layers — run via app.py")
