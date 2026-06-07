"""
Auto-simulate service — single best-scenario mode.

Finds the best feasible cooling intervention for the drawn area:
  1. Place as many tipuana trees as possible in the hottest UTCI zones
  2. Also try converting the top-5 largest asphalt/concrete features to vegetation
  3. If the combined run fails, retry with just trees (always succeeds)

Returns one result dict with full stats + tree_placements for map visualisation.
"""

import math
import logging
from shapely.geometry import shape, Point

from app.services.infrared import run_scenario, TREE_SPECIES, MATERIAL_COSTS

log = logging.getLogger(__name__)

COMFORT_UTCI     = 26.0
MAX_TREES        = 50      # upper bound per attempt
MAX_MAT_FEATURES = 5       # top N material features (keeps geometry clean)


# ── Species helpers ───────────────────────────────────────────────────────────

def _largest_canopy_species():
    return max(TREE_SPECIES.values(), key=lambda s: float(s["canopy_radius_m"]))


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _polygon_area_m2(geom_dict: dict) -> float:
    s = shape(geom_dict)
    lat0 = s.centroid.y
    return s.area * (111320 * math.cos(math.radians(lat0))) * 111320


def _grid_points_in_polygon(polygon: dict, spacing_m: float) -> list[tuple]:
    poly = shape(polygon)
    lat0 = poly.centroid.y
    d_lon = spacing_m / (111320 * math.cos(math.radians(lat0)))
    d_lat = spacing_m / 111320
    minx, miny, maxx, maxy = poly.bounds
    pts = []
    x = minx
    while x <= maxx:
        y = miny
        while y <= maxy:
            if poly.contains(Point(x, y)):
                pts.append((x, y))
            y += d_lat
        x += d_lon
    return pts


def _utci_at(lon: float, lat: float, grid: list, bounds: list) -> float:
    if not grid or not bounds:
        return 0.0
    w, s, e, n = bounds
    rows, cols = len(grid), len(grid[0]) if grid else 0
    if rows == 0 or cols == 0 or (e - w) == 0 or (n - s) == 0:
        return 0.0
    col = max(0, min(cols - 1, int((lon - w) / (e - w) * cols)))
    row = max(0, min(rows - 1, int((n - lat) / (n - s) * rows)))
    v = grid[row][col]
    return float(v) if v is not None else 0.0


def _make_tree_placements(polygon, species_id, max_trees,
                          utci_grid=None, utci_bounds=None):
    sp = TREE_SPECIES.get(species_id)
    if not sp:
        return []
    pts = _grid_points_in_polygon(polygon, float(sp["canopy_radius_m"]) * 2.5)
    if utci_grid and utci_bounds:
        pts.sort(key=lambda p: -_utci_at(p[0], p[1], utci_grid, utci_bounds))
    count = min(max_trees, len(pts))
    return [{"species_id": species_id, "lon": lon, "lat": lat}
            for lon, lat in pts[:count]]


def _top_material_zones(baseline_gm: dict, max_features: int = MAX_MAT_FEATURES) -> list[dict]:
    """Top N asphalt/concrete features sorted by area → painted as vegetation."""
    zones = []
    for mat in ("asphalt", "concrete"):
        fc = baseline_gm.get(mat)
        if not fc or fc.get("type") != "FeatureCollection":
            continue
        sized = []
        for f in fc.get("features", []):
            try:
                a = _polygon_area_m2(f["geometry"])
                if a > 1:
                    sized.append((a, f))
            except Exception:
                pass
        sized.sort(key=lambda x: -x[0])
        for _, f in sized[:max_features]:
            zones.append({"material": "vegetation", "polygon": f["geometry"]})
    return zones


# ── Public entry point ────────────────────────────────────────────────────────

def run_best_scenario(
    polygon: dict,
    baseline_gm: dict,
    buildings: dict,
    baseline_mean_utci: float,
    utci_grid: list | None = None,
    utci_bounds: list | None = None,
) -> dict:
    """
    Find and run the best feasible cooling intervention.

    Attempt ladder (stops at first success):
      1. top-5 material zones + 50 trees in hottest spots
      2. top-5 material zones + 30 trees
      3. top-3 material zones + 30 trees
      4. trees only, 50 (reliable)
      5. trees only, 30
      6. trees only, 15

    Returns a single scenario result dict with meta.tree_placements for 3D rendering.
    """
    gap = max(0.0, baseline_mean_utci - COMFORT_UTCI)
    sp_id = _largest_canopy_species()["id"]

    mat5  = _top_material_zones(baseline_gm, max_features=5)
    mat3  = _top_material_zones(baseline_gm, max_features=3)

    attempts = [
        {"label": "top5mat_50trees",  "zones": mat5,  "n": 50},
        {"label": "top5mat_30trees",  "zones": mat5,  "n": 30},
        {"label": "top3mat_30trees",  "zones": mat3,  "n": 30},
        {"label": "nomat_50trees",    "zones": [],     "n": 50},
        {"label": "nomat_30trees",    "zones": [],     "n": 30},
        {"label": "nomat_15trees",    "zones": [],     "n": 15},
    ]

    last_err = "no candidates"
    for att in attempts:
        trees = _make_tree_placements(polygon, sp_id, att["n"], utci_grid, utci_bounds)
        log.info("Best-scenario attempt '%s': %d trees, %d zones",
                 att["label"], len(trees), len(att["zones"]))
        try:
            sim = run_scenario(
                polygon, att["zones"], baseline_gm, buildings,
                tree_placements=trees,
            )
            actual_delta = round(baseline_mean_utci - sim["stats"]["mean_utci"], 2)
            return {
                **sim,
                "comfort_threshold": COMFORT_UTCI,
                "baseline_utci":     round(baseline_mean_utci, 2),
                "gap_c":             round(gap, 2),
                "meta": {
                    "label":           att["label"],
                    "actual_delta_c":  actual_delta,
                    "trees_count":     sim["stats"].get("trees_count", 0),
                    "mat_zones":       len(att["zones"]),
                    "cost_eur":        sim["stats"].get("cost_eur", 0),
                    "reaches_comfort": sim["stats"]["mean_utci"] <= COMFORT_UTCI,
                    "tree_placements": trees,
                    "species_name":    TREE_SPECIES[sp_id]["common_name"],
                },
            }
        except Exception as exc:
            last_err = str(exc)
            log.exception("Best-scenario attempt '%s' failed", att["label"])

    return {"error": f"All attempts failed: {last_err}"}
