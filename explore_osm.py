"""
Fetch all OSM context layers from the Infrared SDK for the simulation polygon
and render them on an interactive Plotly + OpenStreetMap figure.

Layers shown:
  - Simulation polygon boundary
  - Ground materials (water, concrete, asphalt, soil, vegetation)
  - Buildings (converted from local meter frame -> lon/lat)
  - Trees (vegetation point features)

Run:
  python explore_osm.py
  -> opens results/osm_layers.html in your browser
"""
import math
import os
import json
import webbrowser
from pathlib import Path

import plotly.graph_objects as go
from dotenv import load_dotenv
from shapely.geometry import MultiPoint, shape
from shapely.ops import unary_union

load_dotenv()

# ---------------------------------------------------------------------------
# Site constants (must match simulate.py)
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
# 410 m x 445 m — bridge (lat~23.027) at polygon centre; river + promenade + bridge context

BBOX_S = min(c[1] for c in POLYGON["coordinates"][0])
BBOX_W = min(c[0] for c in POLYGON["coordinates"][0])
_LAT_DEG_PER_M = 1.0 / 111320
_LON_DEG_PER_M = 1.0 / (111320 * math.cos(math.radians(23.029)))

# Layer styling: (fill colour, line colour, legend label)
MATERIAL_STYLE = {
    "water":      ("rgba(30,  144, 255, 0.50)", "#1e90ff", "Water (Sabarmati River)"),
    "vegetation": ("rgba(34,  139,  34, 0.45)", "#228b22",  "Vegetation"),
    "concrete":   ("rgba(180, 180, 180, 0.45)", "#aaaaaa",  "Concrete"),
    "asphalt":    ("rgba(80,   80,  80, 0.50)", "#555555",  "Asphalt (road)"),
    "soil":       ("rgba(160, 120,  60, 0.45)", "#9c6c1e",  "Soil"),
}
VALID_SDK_KEYS = set(MATERIAL_STYLE.keys())

# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------

def m_to_lon(x: float) -> float:
    return BBOX_W + x * _LON_DEG_PER_M


def m_to_lat(y: float) -> float:
    return BBOX_S + y * _LAT_DEG_PER_M


def building_hull_lonlat(mesh) -> list | None:
    coords = mesh.coordinates if hasattr(mesh, "coordinates") else mesh.get("coordinates", [])
    xs, ys = coords[0::3], coords[1::3]
    pts = [(m_to_lon(x), m_to_lat(y)) for x, y in zip(xs, ys)]
    if len(pts) < 3:
        return None
    try:
        hull = MultiPoint(pts).convex_hull
        return list(hull.exterior.coords) if not hull.is_empty else None
    except Exception:
        return None


def geojson_fc_to_shapes(fc: dict) -> list:
    shapes = []
    for feat in fc.get("features", []):
        try:
            s = shape(feat["geometry"])
            if not s.is_empty:
                shapes.append(s)
        except Exception:
            pass
    return shapes


def shapely_to_traces(geom, fill_col: str, line_col: str, name: str) -> list:
    traces = []
    polys = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
    for i, poly in enumerate(polys):
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        ext = list(poly.exterior.coords)
        traces.append(go.Scattermap(
            lon=[c[0] for c in ext],
            lat=[c[1] for c in ext],
            mode="lines",
            fill="toself",
            fillcolor=fill_col,
            line=dict(color=line_col, width=1.5),
            name=name,
            showlegend=(i == 0),
            legendgroup=name,
            hoverinfo="name",
        ))
    return traces

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    from infrared_sdk import InfraredClient

    print("Fetching SDK layers ...")
    with InfraredClient() as client:
        area     = client.buildings.get_area(POLYGON)
        area_veg = client.vegetation.get_area(POLYGON)
        area_gm  = client.ground_materials.get_area(POLYGON)

    buildings    = area.buildings
    veg_features = area_veg.features
    gm_layers    = area_gm.layers

    # --- Summary ---
    print(f"\n  Buildings      : {len(buildings)}")
    print(f"  Trees          : {len(veg_features)}")
    print(f"  Ground mat keys: {list(gm_layers.keys())}")
    unknown_keys = set(gm_layers.keys()) - VALID_SDK_KEYS
    if unknown_keys:
        print(f"  [NOTE] Non-SDK keys (will be dropped from simulations): {unknown_keys}")
    print()

    for key, fc in sorted(gm_layers.items()):
        n = len(fc.get("features", []))
        tag = " <-- river!" if key == "water" and n > 0 else ""
        tag = tag or (" <-- no OSM data, using blanket" if key == "concrete" and n == 0 else "")
        print(f"    {key:<12s}: {n} feature(s){tag}")

    river_present = "water" in gm_layers and len(gm_layers["water"].get("features", [])) > 0
    print(f"\n  Sabarmati River in 'water' layer: {'YES -- will affect UTCI via evaporative cooling' if river_present else 'NO'}")

    # --- Build the merged baseline ground_materials and save it ---
    # Merge SDK layers (river, asphalt road, vegetation patches)
    # then add our blanket concrete for the promenade (OSM has none)
    blanket_concrete = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": POLYGON, "properties": {}}]
    }
    ground_materials_baseline = {
        k: v for k, v in gm_layers.items() if k in VALID_SDK_KEYS
    }
    ground_materials_baseline["concrete"] = blanket_concrete

    out_path = Path("results")
    out_path.mkdir(exist_ok=True)
    (out_path / "ground_materials_baseline.json").write_text(
        json.dumps({"path": "A2+SDK", "ground_materials": ground_materials_baseline}, indent=2)
    )
    print(f"\n  Updated results/ground_materials_baseline.json")
    print("  (river + asphalt road + vegetation patches preserved; blanket concrete added for promenade)")

    # --- Build figure ---
    fig = go.Figure()
    c_lat = (BBOX_S + max(c[1] for c in POLYGON["coordinates"][0])) / 2
    c_lon = (BBOX_W + max(c[0] for c in POLYGON["coordinates"][0])) / 2

    # 1. Ground material layers (water drawn first so buildings render above)
    for key in ["water", "vegetation", "soil", "concrete", "asphalt"]:
        if key not in gm_layers:
            continue
        fill_col, line_col, label = MATERIAL_STYLE[key]
        shapes = geojson_fc_to_shapes(gm_layers[key])
        if not shapes:
            continue
        merged = unary_union(shapes)
        for trace in shapely_to_traces(merged, fill_col, line_col, label):
            fig.add_trace(trace)

    # 2. Buildings (orange convex hulls converted from meter frame)
    building_lons, building_lats = [], []
    for bid, mesh in buildings.items():
        hull = building_hull_lonlat(mesh)
        if hull is None:
            continue
        building_lons.extend([c[0] for c in hull] + [None])
        building_lats.extend([c[1] for c in hull] + [None])

    if building_lons:
        fig.add_trace(go.Scattermap(
            lon=building_lons, lat=building_lats,
            mode="lines",
            fill="toself",
            fillcolor="rgba(255, 140, 0, 0.30)",
            line=dict(color="darkorange", width=1),
            name=f"Buildings ({len(buildings)})",
            hoverinfo="name",
        ))

    # 3. Trees
    if veg_features:
        lons, lats, texts = [], [], []
        for fid, feat in veg_features.items():
            lon, lat = feat["geometry"]["coordinates"][:2]
            lons.append(lon); lats.append(lat)
            p = feat.get("properties", {})
            texts.append(p.get("species", p.get("type", "tree")))
        fig.add_trace(go.Scattermap(
            lon=lons, lat=lats,
            mode="markers",
            marker=dict(size=7, color="darkgreen"),
            name=f"Trees ({len(veg_features)})",
            text=texts,
            hoverinfo="text+name",
        ))

    # 4. Simulation polygon boundary (drawn last, always on top)
    ring = POLYGON["coordinates"][0]
    fig.add_trace(go.Scattermap(
        lon=[c[0] for c in ring],
        lat=[c[1] for c in ring],
        mode="lines",
        line=dict(color="#00a6a6", width=3),
        name="Simulation polygon",
        hoverinfo="name",
    ))

    fig.update_layout(
        map=dict(
            style="open-street-map",
            center=dict(lat=c_lat, lon=c_lon),
            zoom=15,
        ),
        title=dict(
            text="Sabarmati Riverfront — OSM Context Layers (Infrared SDK fetch)",
            font=dict(size=16, color="#092f32"),
        ),
        legend=dict(
            bgcolor="rgba(255,255,255,0.88)",
            bordercolor="#ccc",
            borderwidth=1,
            font=dict(size=12),
            x=0.01, y=0.99,
            xanchor="left", yanchor="top",
        ),
        margin=dict(l=0, r=0, t=45, b=0),
        height=720,
    )

    out = out_path / "osm_layers.html"
    fig.write_html(str(out))
    print(f"\n  Saved: {out.resolve()}")
    webbrowser.open(out.resolve().as_uri())
    print("  Opened in browser.")


if __name__ == "__main__":
    main()
