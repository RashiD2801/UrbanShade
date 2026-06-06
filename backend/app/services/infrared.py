"""Single file that imports from infrared_sdk. All other files stay decoupled."""
import csv
import json
import math
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
from infrared_sdk import InfraredClient
from infrared_sdk.analyses.types import AnalysesName, UtciModelRequest, UtciModelBaseRequest
from infrared_sdk.models import TimePeriod, Location
from infrared_sdk.buildings.types import DotBimMesh

from app.settings import get_settings

log = logging.getLogger(__name__)

VALID_KEYS = {"concrete", "asphalt", "soil", "vegetation", "water"}

_FLOAT_FIELDS = {
    "canopy_radius_m", "trunk_height_m", "canopy_depth_m",
    "planting_cost_eur", "annual_maintenance_eur",
}
_CSV = Path(__file__).resolve().parents[3] / "datasets" / "tree_species.csv"


def _load_tree_species() -> dict:
    species = {}
    with open(_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            entry = {k: (float(v) if k in _FLOAT_FIELDS else v) for k, v in row.items()}
            species[entry["id"]] = entry
    return species


TREE_SPECIES: dict = _load_tree_species()

# EUR costs: install + demolition
MATERIAL_COSTS = {
    "concrete":   {"install": 55,  "demo": 8},
    "asphalt":    {"install": 32,  "demo": 8},
    "soil":       {"install": 22,  "demo": 8},
    "vegetation": {"install": 28,  "demo": 8},
    "water":      {"install": 180, "demo": 8},
}


@lru_cache
def _client() -> InfraredClient:
    return InfraredClient(api_key=get_settings().infrared_api_key)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bbox(polygon: dict) -> tuple:
    cs = polygon["coordinates"][0]
    return (min(c[0] for c in cs), min(c[1] for c in cs),
            max(c[0] for c in cs), max(c[1] for c in cs))


def _center(polygon: dict) -> tuple:
    w, s, e, n = _bbox(polygon)
    return (s + n) / 2, (w + e) / 2


def _get_bounds(result, polygon: dict) -> list:
    try:
        b = list(result.bounds)
        if len(b) == 4:
            return [float(x) for x in b]
    except Exception:
        pass
    w, s, e, n = _bbox(polygon)
    return [w, s, e, n]


def _clean_grid(grid) -> list:
    """Replace NaN/inf with None so FastAPI can JSON-serialize the grid."""
    import math
    return [
        [None if (v is None or (isinstance(v, float) and not math.isfinite(v))) else v for v in row]
        for row in grid
    ]


def _tree_canopy_polygon(lon: float, lat: float, radius_m: float, n_pts: int = 20) -> dict:
    """Approximate a tree canopy as a circular GeoJSON Polygon."""
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat))
    r_lat = radius_m / m_per_deg_lat
    r_lon = radius_m / m_per_deg_lon
    coords = [
        [lon + r_lon * math.cos(2 * math.pi * i / n_pts),
         lat + r_lat * math.sin(2 * math.pi * i / n_pts)]
        for i in range(n_pts)
    ]
    coords.append(coords[0])
    return {"type": "Polygon", "coordinates": [coords]}


def _polygon_area_m2(geom: dict) -> float:
    coords = geom.get("coordinates", [[]])[0]
    if len(coords) < 3:
        return 0.0
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    lat0 = sum(lats) / len(lats)
    m_lon = 111320 * math.cos(math.radians(lat0))
    m_lat = 111320
    xs = [lon * m_lon for lon in lons]
    ys = [lat * m_lat for lat in lats]
    n = len(xs)
    return abs(sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))) / 2


def _serialize(obj):
    """JSON-safe conversion of SDK pydantic objects."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    return obj


def _buildings_to_geojson(buildings_data: dict, polygon: dict) -> dict:
    """Convert DotBimMesh data to GeoJSON fill-extrusion features for MapLibre."""
    from shapely.geometry import MultiPoint

    cs = polygon["coordinates"][0]
    bbox_w = min(c[0] for c in cs)
    bbox_s = min(c[1] for c in cs)
    lat0   = sum(c[1] for c in cs) / len(cs)
    m_lon  = 111320 * math.cos(math.radians(lat0))
    m_lat  = 111320

    def m_to_ll(x, y):
        return bbox_w + x / m_lon, bbox_s + y / m_lat

    features = []
    for v in buildings_data.values():
        coords = v["coordinates"]
        xs = coords[0::3]
        ys = coords[1::3]
        zs = coords[2::3]
        if not xs:
            continue
        height = max(max(zs), 3.0) if zs else 3.0
        pts    = [m_to_ll(x, y) for x, y in zip(xs, ys)]
        if len(pts) < 3:
            continue
        try:
            hull = MultiPoint(pts).convex_hull
            if hull.is_empty or hull.geom_type == "Point":
                continue
            ring = list(hull.exterior.coords)
        except Exception:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"height": round(height, 1), "base_height": 0},
        })
    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# Simulation calls
# ---------------------------------------------------------------------------

def _make_payload(loc, tp, weather_data):
    return UtciModelRequest.from_weatherfile_payload(
        payload=UtciModelBaseRequest(analysis_type=AnalysesName.thermal_comfort_index),
        location=loc, time_period=tp, weather_data=weather_data,
    )


def run_baseline(polygon: dict) -> dict:
    client = _client()
    lat, lon = _center(polygon)
    loc = Location(latitude=lat, longitude=lon)
    tp  = TimePeriod(start_month=7, start_day=1, start_hour=9,
                     end_month=7,   end_day=31,  end_hour=18)

    wfiles       = client.weather.get_weather_file_from_location(lat=lat, lon=lon, radius=150)
    weather_data = client.weather.filter_weather_data(identifier=wfiles[0]["uuid"], time_period=tp)
    area         = client.buildings.get_area(polygon)
    area_gm      = client.ground_materials.get_area(polygon)
    gm           = {k: v for k, v in area_gm.layers.items() if k in VALID_KEYS}

    result = client.run_area_and_wait(
        _make_payload(loc, tp, weather_data), polygon,
        buildings=area.buildings, ground_materials=gm,
    )

    grid = result.merged_grid
    step = 2
    grid_ds = grid[::step, ::step]

    # Serialize buildings
    buildings_data = {}
    for bid, m in area.buildings.items():
        c = list(m.coordinates if hasattr(m, "coordinates") else m.get("coordinates", []))
        i = list(m.indices    if hasattr(m, "indices")    else m.get("indices", []))
        buildings_data[bid] = {"coordinates": c, "indices": i}

    # Serialize ground materials (SDK may return pydantic objects)
    gm_plain = json.loads(json.dumps(
        {k: _serialize(v) for k, v in gm.items()}
    ))

    buildings_geojson = _buildings_to_geojson(buildings_data, polygon)

    return {
        "grid":               _clean_grid(grid_ds.tolist()),
        "bounds":             _get_bounds(result, polygon),
        "min_legend":         float(result.min_legend) if result.min_legend is not None else float(np.nanmin(grid)),
        "max_legend":         float(result.max_legend) if result.max_legend is not None else float(np.nanmax(grid)),
        "ground_materials":   gm_plain,
        "buildings":          buildings_data,
        "buildings_geojson":  buildings_geojson,
        "stats": {
            "mean_utci":   round(float(np.nanmean(grid)), 2),
            "max_utci":    round(float(np.nanmax(grid)), 2),
            "n_buildings": len(area.buildings),
        },
    }


def _geom_to_features(geom) -> list:
    """Convert a shapely geometry to a list of GeoJSON Feature dicts (polygons only)."""
    from shapely.geometry import mapping, MultiPolygon, Polygon
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        parts = [geom]
    elif geom.geom_type == "MultiPolygon":
        parts = list(geom.geoms)
    elif geom.geom_type == "GeometryCollection":
        parts = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
    else:
        return []
    feats = []
    for p in parts:
        sub = list(p.geoms) if p.geom_type == "MultiPolygon" else [p]
        for s in sub:
            if not s.is_empty and s.area > 0:
                feats.append({"type": "Feature", "geometry": mapping(s), "properties": {}})
    return feats


def run_scenario(polygon: dict, painted_zones: list, baseline_gm: dict, buildings_data: dict,
                 tree_placements: list | None = None) -> dict:
    from shapely.geometry import shape

    client = _client()
    lat, lon = _center(polygon)
    loc = Location(latitude=lat, longitude=lon)
    tp  = TimePeriod(start_month=7, start_day=1, start_hour=9,
                     end_month=7,   end_day=31,  end_hour=18)

    wfiles       = client.weather.get_weather_file_from_location(lat=lat, lon=lon, radius=150)
    weather_data = client.weather.filter_weather_data(identifier=wfiles[0]["uuid"], time_period=tp)

    # Rebuild buildings as DotBimMesh
    buildings = {
        bid: DotBimMesh(mesh_id=i, coordinates=v["coordinates"], indices=v["indices"])
        for i, (bid, v) in enumerate(buildings_data.items())
    }

    # Deep-copy baseline ground materials
    gm = json.loads(json.dumps(baseline_gm))
    total_cost = 0.0
    total_area = 0.0
    trees_cost = 0.0
    trees_count = 0
    trees_area = 0.0

    # ── Convert tree placements to vegetation patches ─────────────────────────
    for placement in (tree_placements or []):
        spec = TREE_SPECIES.get(placement["species_id"])
        if not spec:
            continue
        canopy_geom = _tree_canopy_polygon(
            placement["lon"], placement["lat"], float(spec["canopy_radius_m"])
        )
        canopy_shape = shape(canopy_geom)

        for existing_mat in list(gm.keys()):
            fc = gm[existing_mat]
            if not isinstance(fc, dict) or fc.get("type") != "FeatureCollection":
                continue
            new_features = []
            for feat in fc.get("features", []):
                try:
                    remainder = shape(feat["geometry"]).difference(canopy_shape)
                    new_features.extend(_geom_to_features(remainder))
                except Exception:
                    new_features.append(feat)
            gm[existing_mat] = {"type": "FeatureCollection", "features": new_features}

        if "vegetation" not in gm:
            gm["vegetation"] = {"type": "FeatureCollection", "features": []}
        gm["vegetation"]["features"].append(
            {"type": "Feature", "geometry": canopy_geom, "properties": {}}
        )

        trees_cost += float(spec["planting_cost_eur"])
        trees_area += math.pi * float(spec["canopy_radius_m"]) ** 2
        trees_count += 1

    for zone in painted_zones:
        mat  = zone["material"]
        poly = zone["polygon"]

        if isinstance(poly, dict) and poly.get("type") == "Feature":
            geom = poly["geometry"]
        else:
            geom = poly if isinstance(poly, dict) else poly.polygon

        painted_shape = shape(geom)

        # ── Subtract the painted area from EVERY existing material zone ──────
        # Without this, the old material still covers the same area and the SDK
        # sees overlapping zones, causing the original material to dominate.
        for existing_mat in list(gm.keys()):
            fc = gm[existing_mat]
            if not isinstance(fc, dict) or fc.get("type") != "FeatureCollection":
                continue
            new_features = []
            for feat in fc.get("features", []):
                try:
                    remainder = shape(feat["geometry"]).difference(painted_shape)
                    new_features.extend(_geom_to_features(remainder))
                except Exception:
                    new_features.append(feat)  # keep original if subtraction fails
            gm[existing_mat] = {"type": "FeatureCollection", "features": new_features}

        # ── Add painted zone to target material ───────────────────────────────
        if mat not in gm:
            gm[mat] = {"type": "FeatureCollection", "features": []}
        gm[mat]["features"].append({"type": "Feature", "geometry": geom, "properties": {}})

        area_m2 = _polygon_area_m2(geom)
        total_area += area_m2
        c = MATERIAL_COSTS.get(mat, {"install": 50, "demo": 8})
        total_cost += area_m2 * (c["install"] + c["demo"])

    result = client.run_area_and_wait(
        _make_payload(loc, tp, weather_data), polygon,
        buildings=buildings, ground_materials=gm,
    )

    grid = result.merged_grid
    step = 2
    grid_ds = grid[::step, ::step]

    return {
        "grid":       _clean_grid(grid_ds.tolist()),
        "bounds":     _get_bounds(result, polygon),
        "min_legend": float(result.min_legend) if result.min_legend is not None else float(np.nanmin(grid)),
        "max_legend": float(result.max_legend) if result.max_legend is not None else float(np.nanmax(grid)),
        "stats": {
            "mean_utci":        round(float(np.nanmean(grid)), 2),
            "max_utci":         round(float(np.nanmax(grid)), 2),
            "cost_eur":         round(total_cost + trees_cost),
            "zones_cost_eur":   round(total_cost),
            "trees_cost_eur":   round(trees_cost),
            "trees_count":      trees_count,
            "trees_area_m2":    round(trees_area),
            "area_m2":          round(total_area),
        },
    }
