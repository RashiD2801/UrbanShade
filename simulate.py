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
        [72.5745, 23.027],
        [72.5785, 23.027],
        [72.5785, 23.031],
        [72.5745, 23.031],
        [72.5745, 23.027],
    ]],
}
# 0.004° lon × 0.004° lat ≈ 410 m × 445 m at 23°N — fits in one 512 m tile

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
        print("  → Create a .env file with:  INFRARED_API_KEY=your_key_here")
        print("  → Then re-run: python simulate.py --step 0")
        sys.exit(1)
    print(f"  API key loaded: {api_key[:6]}{'*' * (len(api_key) - 6)}")

    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import AnalysesName

    print("  Connecting to Infrared API …")
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
        "Shrink the polygon so it fits inside 512 m × 512 m."
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
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sabarmati Riverfront thermal comfort tool"
    )
    parser.add_argument(
        "--step", type=int, choices=[0, 1],
        help="Which step to run (0 = smoke test, 1 = load data)"
    )
    args = parser.parse_args()

    if args.step == 0:
        step_00()
    elif args.step == 1:
        step_01()
    else:
        print("Running steps 0 and 1 in sequence …\n")
        step_00()
        print()
        step_01()


if __name__ == "__main__":
    main()
