"""
Inspect building height data from the Infrared SDK OSM fetch.

Checks whether buildings have real OSM height tags (building:levels / height)
or a flat SDK default, and reports the distribution.

Run:
  python inspect_buildings.py
"""
import json
import math
from pathlib import Path
from collections import Counter

from dotenv import load_dotenv
load_dotenv()

POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [72.572, 23.025], [72.576, 23.025],
        [72.576, 23.029], [72.572, 23.029],
        [72.572, 23.025],
    ]],
}

def main():
    from infrared_sdk import InfraredClient

    print("Fetching buildings from SDK ...")
    with InfraredClient() as client:
        area = client.buildings.get_area(POLYGON)

    buildings = area.buildings
    print(f"  {len(buildings)} buildings returned\n")

    heights = {}
    for bid, mesh in buildings.items():
        coords = mesh.coordinates if hasattr(mesh, "coordinates") else mesh.get("coordinates", [])
        zs = coords[2::3]  # every 3rd value starting at index 2 = Z axis
        if zs:
            heights[bid] = round(max(zs), 1)

    if not heights:
        print("No height data found in mesh coordinates.")
        return

    vals = list(heights.values())
    unique = sorted(set(vals))
    counter = Counter(round(h) for h in vals)

    print(f"Height range : {min(vals):.1f} m  ->  {max(vals):.1f} m")
    print(f"Unique heights ({len(unique)}) : {unique[:30]}{'...' if len(unique) > 30 else ''}")
    print()

    has_real_heights = len(unique) > 1

    if has_real_heights:
        print("RESULT: Height variety found — OSM has height/building:levels tags for some buildings.")
        print("        The SDK extrudes from them. These heights are usable in your .obj model.\n")
    else:
        print(f"RESULT: All buildings at the same height ({unique[0]} m) — SDK used a flat default.")
        print("        No OSM height tags exist for this area. You will need to set heights manually.\n")

    print("Height distribution (rounded to nearest metre):")
    for h in sorted(counter):
        bar = "#" * min(counter[h], 60)
        print(f"  {h:4d} m : {bar}  ({counter[h]})")

    # Save
    summary = {
        "n_buildings": len(heights),
        "min_height_m": min(vals),
        "max_height_m": max(vals),
        "unique_heights_m": unique,
        "has_osm_height_data": has_real_heights,
        "sdk_default_if_flat": unique[0] if not has_real_heights else None,
        "distribution_by_rounded_m": {str(k): v for k, v in sorted(counter.items())},
    }
    out = Path("results/building_heights.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))
    print(f"\nSaved: {out.resolve()}")

    print("\n--- River height note ---")
    print("The Sabarmati River is a GROUND MATERIAL (type=water), not a 3D object.")
    print("The SDK ground plane is flat — it does not model the ~4-6 m drop")
    print("from promenade deck to river bed. River cooling enters via the water")
    print("ground material's albedo + evaporation parameters, not geometry.")
    print("Do NOT model the river in your .obj — just model the promenade surface")
    print("above it (buildings, pergolas, trees, shade structures).")

if __name__ == "__main__":
    main()
