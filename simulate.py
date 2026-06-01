"""
Sabarmati Riverfront — Thermal Comfort Scenario Tool
Steps 0-8 as functions; run `python simulate.py --step 0` or `--step 1` etc.
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
# Site constants
# ---------------------------------------------------------------------------

POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [72.572, 23.025],
        [72.576, 23.025],
        [72.576, 23.029],
        [72.572, 23.029],
        [72.572, 23.025],
    ]],
}
# 410 m x 445 m at 23°N — single tile confirmed.
# Shifted south so Lal Darwaja bridge (lat~23.027) sits at polygon centre.
# Covers: Sabarmati River + full promenade strip + bridge context.

# ---------------------------------------------------------------------------
# Step 0 — Environment smoke test
# ---------------------------------------------------------------------------

def step_00():
    print("=" * 60)
    print("STEP 0 — Environment smoke test")
    print("=" * 60)

    api_key = os.environ.get("INFRARED_API_KEY")
    if not api_key:
        print("\n[FAIL] INFRARED_API_KEY is not set.")
        print("  -> Create a .env file with:  INFRARED_API_KEY=your_key_here")
        print("  -> Then re-run: python simulate.py --step 0")
        sys.exit(1)
    print(f"  API key loaded: {api_key[:6]}{'*' * (len(api_key) - 6)}")

    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import AnalysesName

    print("  Connecting to Infrared API ...")
    with InfraredClient() as client:
        preview = client.preview_area(
            POLYGON,
            analysis_type=AnalysesName.thermal_comfort_statistics,
        )

    print(f"  Tile count      : {preview.tile_count}")
    print(f"  Estimated time  : {preview.estimated_time_s} s")
    print(f"  Estimated cost  : {preview.estimated_cost_tokens} tokens")

    assert preview.tile_count == 1, (
        f"[FAIL] Expected 1 tile, got {preview.tile_count}. "
        "Shrink the polygon so it fits inside 512 m x 512 m."
    )
    print("\n[PASS] Step 0 complete — single tile confirmed, API key valid.")


# ---------------------------------------------------------------------------
# Step 1 — Load and validate datasets
# ---------------------------------------------------------------------------

DATASETS = Path(__file__).parent / "datasets"

# SDK accepts only these ground_material keys
MATERIAL_KEY_MAP = {
    "concrete":      "concrete",
    "asphalt":       "asphalt",
    "grass":         "vegetation",
    "soil":          "soil",
    "water_feature": "water",
}

DEMOLITION_COST = 380  # INR/sqm — from demolition_costs.csv


def step_01():
    print("=" * 60)
    print("STEP 1 — Load and validate datasets")
    print("=" * 60)

    # ---- Trees ----
    trees = pd.read_csv(DATASETS / "trees_shade-cost.csv")
    assert trees.shape == (34, 11), (
        f"[FAIL] trees: expected (34, 11), got {trees.shape}"
    )
    required_tree_cols = {
        "Species", "canopy_area_sqm", "cost_per_tree_inr",
        "cost_per_sqm_shade_inr", "carbon_sequestration_kg_yr",
    }
    missing = required_tree_cols - set(trees.columns)
    assert not missing, f"[FAIL] trees missing columns: {missing}"
    assert trees[list(required_tree_cols)].isna().sum().sum() == 0, \
        "[FAIL] trees: NaN found in key cost columns"

    print(f"\n  Trees loaded: {len(trees)} species")

    # ---- Materials ----
    materials = pd.read_csv(DATASETS / "surface_materials-costs.csv")
    assert materials.shape == (5, 13), (
        f"[FAIL] materials: expected (5, 13), got {materials.shape}"
    )
    required_mat_cols = {
        "material", "utci_reduction_vs_concrete_c",
        "cost_10yr_per_sqm_inr", "installation_cost_per_sqm_inr",
    }
    missing = required_mat_cols - set(materials.columns)
    assert not missing, f"[FAIL] materials missing columns: {missing}"

    # Apply SDK key mapping
    materials["sdk_key"] = materials["material"].map(MATERIAL_KEY_MAP)
    assert materials["sdk_key"].notna().all(), (
        "[FAIL] Some material names have no SDK key mapping:\n"
        + str(materials[materials["sdk_key"].isna()]["material"].tolist())
    )
    assert set(materials["sdk_key"]) <= {"concrete", "asphalt", "soil", "vegetation", "water"}, \
        "[FAIL] sdk_key values outside allowed SDK set"

    # Add total 10yr cost (demolition only applies when replacing existing concrete)
    materials["total_10yr_cost_per_sqm"] = materials["cost_10yr_per_sqm_inr"].where(
        materials["material"] == "concrete",
        materials["cost_10yr_per_sqm_inr"] + DEMOLITION_COST,
    )

    print(f"\n  Materials loaded: {len(materials)} types")
    print("\n  Material cost summary (10yr, incl. demolition where applicable):")
    cost_summary = (
        materials[["material", "sdk_key", "utci_reduction_vs_concrete_c",
                    "total_10yr_cost_per_sqm"]]
        .sort_values("total_10yr_cost_per_sqm")
    )
    print(cost_summary.to_string(index=False))

    # Exclude asphalt (worsens UTCI) from scenario candidates
    candidates = materials[
        (materials["material"] != "concrete") &   # baseline, not a swap target
        (materials["utci_reduction_vs_concrete_c"] > 0)
    ].copy()
    print(f"\n  Scenario-eligible materials (UTCI improvement > 0): "
          f"{candidates['material'].tolist()}")

    # ---- Tree shortlist ----
    shortlist = (
        trees[trees["canopy_area_sqm"] >= 75]
        .sort_values("cost_per_sqm_shade_inr")
        .head(5)
        [["Species", "Name", "canopy_area_sqm",
          "cost_per_sqm_shade_inr", "cost_per_tree_inr"]]
        .reset_index(drop=True)
    )
    assert len(shortlist) == 5, "[FAIL] Tree shortlist has fewer than 5 species"
    print("\n  Top-5 trees by cost_per_sqm_shade (canopy >= 75 sqm):")
    print(shortlist.to_string(index=False))

    # ---- Demolition ----
    demo = pd.read_csv(DATASETS / "demolition_costs.csv")
    assert "demolition_cost_per_sqm_inr" in demo.columns, \
        "[FAIL] demolition_costs.csv missing expected column"
    recorded_cost = demo["demolition_cost_per_sqm_inr"].iloc[0]
    assert str(DEMOLITION_COST) in str(recorded_cost), (
        f"[WARN] Demolition cost in CSV ({recorded_cost}) differs from "
        f"hardcoded constant ({DEMOLITION_COST}) — update DEMOLITION_COST if needed."
    )
    print(f"\n  Demolition cost confirmed: INR{DEMOLITION_COST}/sqm")

    print("\n[PASS] Step 1 complete — all datasets valid.")

    return trees, materials, shortlist


# ---------------------------------------------------------------------------
# Step 2A — OSM surface data check
# ---------------------------------------------------------------------------

# Overpass bbox: (south, west, north, east)
_BBOX = (
    min(c[1] for c in POLYGON["coordinates"][0]),
    min(c[0] for c in POLYGON["coordinates"][0]),
    max(c[1] for c in POLYGON["coordinates"][0]),
    max(c[0] for c in POLYGON["coordinates"][0]),
)
_COVERAGE_THRESHOLD = 0.80   # 80 % of promenade area must be tagged to use Path A1


_OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def _query_overpass():
    """Return raw Overpass JSON for surface-tagged and pedestrian-area features.
    Tries multiple mirrors; raises RuntimeError if all fail."""
    import requests
    s, w, n, e = _BBOX
    query = (
        f"[out:json][timeout:25];"
        f"("
        f'way["surface"]({s},{w},{n},{e});'
        f'way["highway"="pedestrian"]({s},{w},{n},{e});'
        f'way["leisure"="promenade"]({s},{w},{n},{e});'
        f'relation["surface"]({s},{w},{n},{e});'
        f");out geom;"
    )
    errors = []
    for mirror in _OVERPASS_MIRRORS:
        try:
            resp = requests.get(mirror, params={"data": query}, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            errors.append(f"{mirror}: HTTP {resp.status_code}")
        except Exception as exc:
            errors.append(f"{mirror}: {type(exc).__name__}")
    raise RuntimeError(
        "All Overpass mirrors unreachable (network block likely):\n  "
        + "\n  ".join(errors)
    )


def _overpass_to_shapely(elements):
    """Convert Overpass way elements to Shapely Polygons (closed ways only)."""
    from shapely.geometry import Polygon
    from shapely.validation import make_valid
    polys = []
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry", [])
        if len(geom) < 3:
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in geom]
        if coords[0] != coords[-1]:
            continue  # open way — not a polygon
        try:
            p = make_valid(Polygon(coords))
            if not p.is_empty:
                polys.append((p, el.get("tags", {})))
        except Exception:
            pass
    return polys


def step_02a():
    print("=" * 60)
    print("STEP 2A — OSM surface data check")
    print("=" * 60)

    from shapely.geometry import shape
    from shapely.ops import unary_union
    import json

    promenade = shape(POLYGON)
    promenade_area_deg2 = promenade.area   # degrees² — used only for ratio; units cancel

    # --- Query Overpass ---
    print(f"\n  Querying Overpass for bbox {_BBOX} ...")
    try:
        data = _query_overpass()
    except RuntimeError as exc:
        print(f"\n  [WARN] {exc}")
        print("  -> Overpass is not reachable from this network.")
        print("     This is expected on some ISPs in India.")
        print("     Result: Path A2 (blanket concrete polygon) — correct for the promenade.")
        data = {"elements": []}

    elements = data.get("elements", [])
    print(f"  Elements returned: {len(elements)}")

    # --- Convert closed ways to polygons ---
    polys_with_tags = _overpass_to_shapely(elements)
    print(f"  Closed-way polygons extracted: {len(polys_with_tags)}")

    # Print what we found
    for poly, tags in polys_with_tags[:10]:  # show first 10
        surface = tags.get("surface", "—")
        highway = tags.get("highway", "")
        leisure = tags.get("leisure", "")
        name    = tags.get("name", "")
        print(f"    {name or '(unnamed)':30s}  surface={surface:<12s}  highway={highway}  leisure={leisure}")

    # --- Compute coverage ---
    if polys_with_tags:
        surface_union = unary_union([p for p, _ in polys_with_tags])
        overlap = surface_union.intersection(promenade)
        coverage = overlap.area / promenade_area_deg2
    else:
        coverage = 0.0

    print(f"\n  Coverage of promenade polygon: {coverage * 100:.1f}%")
    print(f"  Threshold for Path A1:         {_COVERAGE_THRESHOLD * 100:.0f}%")

    # --- Decision ---
    if coverage >= _COVERAGE_THRESHOLD:
        print("\n  [PATH A1] OSM surface data sufficient.")
        print("  -> Building ground_materials_baseline from OSM polygons ...")

        # Build a FeatureCollection of the overlapping polygons as "concrete"
        features = []
        for poly, _ in polys_with_tags:
            clipped = poly.intersection(promenade)
            if clipped.is_empty:
                continue
            features.append({
                "type": "Feature",
                "geometry": clipped.__geo_interface__,
                "properties": {},
            })
        ground_materials_baseline = {
            "concrete": {"type": "FeatureCollection", "features": features}
        }
        path = "A1"
    else:
        print("\n  [PATH A2] OSM coverage too low — using blanket concrete polygon.")
        ground_materials_baseline = {
            "concrete": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": POLYGON,
                    "properties": {},
                }]
            }
        }
        path = "A2"

    # Save to disk for later steps
    out_path = Path(__file__).parent / "results"
    out_path.mkdir(exist_ok=True)
    (out_path / "ground_materials_baseline.json").write_text(
        json.dumps({"path": path, "ground_materials": ground_materials_baseline}, indent=2)
    )
    print(f"  Saved to results/ground_materials_baseline.json")

    print(f"\n[PASS] Step 2A complete — Surface data path: {path}")
    return ground_materials_baseline, path


# ---------------------------------------------------------------------------
# Step 2B — SDK building fetch + east-bank centroid check
# ---------------------------------------------------------------------------

_EAST_BANK_LON = 72.575   # buildings east of this -> east-bank confirmed (promenade edge)
_MIN_BUILDINGS = 5
# Convert lon threshold to x-meters in polygon-bbox-SW frame
import math as _math
_EAST_BANK_X_M = (_EAST_BANK_LON - min(c[0] for c in POLYGON["coordinates"][0])) \
                  * 111320 * _math.cos(_math.radians(23.029))


def _building_centroid_x(mesh) -> float:
    """Return mean x-coordinate of a DotBimMesh (every 3rd value starting at 0)."""
    coords = mesh.coordinates if hasattr(mesh, "coordinates") else mesh.get("coordinates", [])
    xs = coords[0::3]
    return sum(xs) / len(xs) if xs else 0.0


def step_02b():
    print("=" * 60)
    print("STEP 2B — SDK building fetch")
    print("=" * 60)

    from infrared_sdk import InfraredClient
    import json
    from pathlib import Path as P

    print(f"\n  Fetching buildings for polygon via Infrared SDK ...")
    with InfraredClient() as client:
        area = client.buildings.get_area(POLYGON)

    buildings = area.buildings
    n_buildings = len(buildings)
    print(f"  Buildings returned: {n_buildings}")

    if area.failed_tiles:
        print(f"  [WARN] Failed tiles: {area.failed_tiles}")

    # --- Centroid check ---
    east_bank_count = 0
    centroids_x = []
    for bid, mesh in buildings.items():
        cx = _building_centroid_x(mesh)
        centroids_x.append(cx)
        if cx > _EAST_BANK_X_M:
            east_bank_count += 1

    print(f"  East-bank threshold x: {_EAST_BANK_X_M:.0f} m  (lon >= {_EAST_BANK_LON})")
    print(f"  Buildings east of threshold: {east_bank_count} / {n_buildings}")
    if centroids_x:
        print(f"  Centroid x range: {min(centroids_x):.0f} m – {max(centroids_x):.0f} m")

    # --- Decision ---
    passes = n_buildings >= _MIN_BUILDINGS and east_bank_count >= 1

    if passes:
        mode = "A"
        print(f"\n  [MODE A] SDK buildings valid — user area selection enabled.")
    else:
        mode = "B"
        print(f"\n  [MODE B] Buildings sparse or missing east-bank structures.")
        print("  -> You will need to provide a Rhino DotBim model (see DEVELOPMENT_PLAN.md Step 2B).")
        print("  -> Fixed polygon mode: no area selection in the webapp.")

    # Save mode flag
    out_path = P(__file__).parent / "results"
    out_path.mkdir(exist_ok=True)
    (out_path / "mode.json").write_text(json.dumps({"mode": mode, "n_buildings": n_buildings}))
    print(f"  Saved to results/mode.json")

    print(f"\n[PASS] Step 2B complete — Operating mode: {mode}")
    return buildings, mode


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sabarmati Riverfront thermal comfort tool"
    )
    parser.add_argument(
        "--step", type=str,
        help="Step(s) to run: 0, 1, 2a, 2b, or 2 (runs both 2a and 2b)"
    )
    args = parser.parse_args()

    step = (args.step or "").lower()
    if step == "0":
        step_00()
    elif step == "1":
        step_01()
    elif step == "2a":
        step_02a()
    elif step == "2b":
        step_02b()
    elif step == "2":
        step_02a()
        print()
        step_02b()
    else:
        print("Running steps 0, 1, 2a, 2b in sequence ...\n")
        step_00(); print()
        step_01(); print()
        step_02a(); print()
        step_02b()


if __name__ == "__main__":
    main()
