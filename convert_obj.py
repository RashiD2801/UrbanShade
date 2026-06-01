"""
Convert model/Riverfront-model.obj to SDK inputs.

User material mapping:
  purple (125,38,205) + white (255,255,255) → buildings  (DotBimMesh, deg-1 quads)
  blue   (0,0,255)                          → water      (ground material polygon)
  dark   (42,42,42)                         → concrete   (ground material polygon)
  green  (170,230,123)                      → trees      (vegetation GeoJSON Points)

OBJ surface types:
  deg(1,1) + 4 verts = bilinear quad  → triangulate directly as 2 triangles
  deg(2,1) + 18 verts = curved shape  → use centroid only (tree canopy helper)

Coordinate transform (Rhino Z-up → OBJ Y-up export):
  OBJ X increases WESTWARD  → SDK X (east)   = (X_MAX - ox) / span * W_M
  OBJ Z increases SOUTHWARD → SDK Y (north)  = (Z_MAX - oz) / span * H_M
  OBJ Y = height above ground (metres)       → SDK Z = oy
"""
import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import MultiPoint

BBOX_W, BBOX_E = 72.572, 72.576
BBOX_S, BBOX_N = 23.025, 23.029
CENTER_LAT     = (BBOX_S + BBOX_N) / 2

W_M = (BBOX_E - BBOX_W) * 111320 * math.cos(math.radians(CENTER_LAT))  # ~410 m
H_M = (BBOX_N - BBOX_S) * 111320                                         # ~445 m

OBJ_X_MIN, OBJ_X_MAX = -417.17,  94.85
OBJ_Z_MIN, OBJ_Z_MAX = -310.98, 184.00

BUILDING_MATS = {"diffuse_125_38_205_255", "diffuse_255_255_255_255"}  # purple, white
WATER_MAT     = "diffuse_0_0_255_255"
GROUND_MAT    = "diffuse_42_42_42_255"   # dark gray → concrete
TREE_MAT      = "diffuse_170_230_123_255"
TREE_H_MIN    = 1.0     # OBJ Y above this = canopy
TREE_GRID_M   = 8.0


# ── Coordinate helpers ───────────────────────────────────────────────────────

def obj_to_sdk_m(ox, oy, oz):
    """OBJ → SDK metre frame (X=east, Y=north, Z=height from SW corner)."""
    x = (OBJ_X_MAX - ox) / (OBJ_X_MAX - OBJ_X_MIN) * W_M
    y = (OBJ_Z_MAX - oz) / (OBJ_Z_MAX - OBJ_Z_MIN) * H_M
    return x, y, float(oy)


def obj_to_lonlat(ox, oz):
    x_f = (OBJ_X_MAX - ox) / (OBJ_X_MAX - OBJ_X_MIN)
    y_f = (OBJ_Z_MAX - oz) / (OBJ_Z_MAX - OBJ_Z_MIN)
    return BBOX_W + x_f * (BBOX_E - BBOX_W), BBOX_S + y_f * (BBOX_N - BBOX_S)


# ── OBJ parser ───────────────────────────────────────────────────────────────

def parse_obj_full(path):
    """
    Parse vertices and surf commands from an OBJ NURBS file.
    Returns:
      verts   : list[(ox,oy,oz)], 1-based (index 0 = None placeholder)
      surfaces: dict[mat] → list[(deg_u, deg_v, [v_idx, ...])]
    """
    verts    = [None]   # 1-based
    surfaces = defaultdict(list)
    cur_mat  = None
    cur_deg  = None

    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            cmd   = parts[0]

            if cmd == "usemtl":
                cur_mat = parts[1]
            elif cmd == "v":
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif cmd == "deg" and len(parts) == 3:
                cur_deg = (int(parts[1]), int(parts[2]))
            elif cmd == "deg" and len(parts) == 2:
                cur_deg = None   # 1D curve — ignore
            elif cmd == "surf" and cur_mat and cur_deg:
                # surf u0 u1 v0 v1  vi1[/...] vi2[/...] ...
                idxs = []
                for p in parts[5:]:
                    vi = int(p.split("/")[0])
                    if vi < 0:
                        vi = len(verts) + vi
                    idxs.append(vi)
                surfaces[cur_mat].append((cur_deg, idxs))
            elif cmd in ("cstype", "parm", "trim", "hole", "end", "curv2"):
                pass   # skip NURBS auxiliary lines

    return verts, surfaces


# ── Buildings (DotBimMesh) ───────────────────────────────────────────────────

def build_buildings(verts, surfaces):
    """
    Convert purple + white deg(1,1) quads into mesh dicts.
    Returns dict[str, dict] with keys 'mesh_id', 'coordinates', 'indices'.
    (App reconstructs DotBimMesh from this at simulation time.)
    """
    result = {}
    mesh_counter = 0

    for mat_key in BUILDING_MATS:
        surfs = [s for s in surfaces.get(mat_key, []) if s[0] == (1, 1) and len(s[1]) == 4]
        if not surfs:
            continue

        coords_flat  = []
        indices_flat = []
        offset       = 0

        for _, v_idxs in surfs:
            for vi in v_idxs:
                ox, oy, oz = verts[vi]
                x, y, z = obj_to_sdk_m(ox, oy, oz)
                coords_flat.extend([x, y, z])
            # Quad triangulation: (0,2,1) and (1,2,3)
            indices_flat.extend([
                offset+0, offset+2, offset+1,
                offset+1, offset+2, offset+3,
            ])
            offset += 4

        bid = "obj_purple" if "205" in mat_key else "obj_white"
        result[bid] = {
            "mesh_id":     mesh_counter,
            "coordinates": coords_flat,
            "indices":     indices_flat,
        }
        mesh_counter += 1
        print(f"  {bid}: {len(surfs)} quads -> {len(indices_flat)//3} triangles")

    return result


# ── Ground materials ─────────────────────────────────────────────────────────

def build_ground_fc(verts, surfaces, mat_key):
    """Convex hull of all surface vertices in lon/lat → GeoJSON FeatureCollection."""
    lonlats = []
    for _, v_idxs in surfaces.get(mat_key, []):
        for vi in v_idxs:
            ox, _, oz = verts[vi]
            lonlats.append(obj_to_lonlat(ox, oz))
    if len(lonlats) < 3:
        return None
    hull = MultiPoint(lonlats).convex_hull
    if hull.is_empty or hull.geom_type == "Point":
        return None
    geom = hull if hull.geom_type == "Polygon" else hull.buffer(0.00005)
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [list(geom.exterior.coords)]},
            "properties": {}
        }]
    }


# ── Trees ────────────────────────────────────────────────────────────────────

def extract_trees(verts, surfaces):
    """
    Cluster green-material canopy vertices (OBJ Y > TREE_H_MIN) into tree points.
    """
    canopy = []
    for _, v_idxs in surfaces.get(TREE_MAT, []):
        seen = set()
        for vi in v_idxs:
            if vi in seen:
                continue
            seen.add(vi)
            ox, oy, oz = verts[vi]
            if oy >= TREE_H_MIN:
                canopy.append(obj_to_lonlat(ox, oz))

    if not canopy:
        return {}

    dlon = TREE_GRID_M / (111320 * math.cos(math.radians(CENTER_LAT)))
    dlat = TREE_GRID_M / 111320
    cells = defaultdict(list)
    for lon, lat in canopy:
        cells[(int(lon / dlon), int(lat / dlat))].append((lon, lat))

    return {
        f"tree_{i}": {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [
                sum(p[0] for p in pts) / len(pts),
                sum(p[1] for p in pts) / len(pts),
            ]},
            "properties": {"type": "tree", "height": 6.0, "crown_radius": 3.0},
        }
        for i, pts in enumerate(cells.values())
    }


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    out = Path("results")
    out.mkdir(exist_ok=True)

    print("Parsing model/Riverfront-model.obj ...")
    verts, surfaces = parse_obj_full("model/Riverfront-model.obj")
    print(f"  {len(verts)-1} vertices")
    for m, ss in surfaces.items():
        print(f"  {m}: {len(ss)} surfaces")

    print("\nBuildings (purple + white quads):")
    buildings = build_buildings(verts, surfaces)

    print("\nGround materials:")
    ground_materials = {}
    for label, mat_key in [("concrete", GROUND_MAT), ("water", WATER_MAT)]:
        fc = build_ground_fc(verts, surfaces, mat_key)
        if fc:
            ground_materials[label] = fc
            n = len(surfaces.get(mat_key, []))
            print(f"  {label}: convex hull from {n} surfaces")

    print("\nTrees:")
    vegetation = extract_trees(verts, surfaces)
    print(f"  {len(vegetation)} tree cluster points")

    (out / "obj_buildings.json").write_text(json.dumps(buildings))
    (out / "obj_ground_materials.json").write_text(json.dumps(ground_materials, indent=2))
    (out / "obj_trees.json").write_text(json.dumps(vegetation, indent=2))

    print(f"\nSaved: obj_buildings.json, obj_ground_materials.json, obj_trees.json")
    return buildings, ground_materials, vegetation


if __name__ == "__main__":
    main()
