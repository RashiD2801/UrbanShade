"""
Sabarmati Riverfront — UTCI baseline interface with 3D viewport.
Materials + trees from model/Riverfront-model.obj; buildings from OSM (Mode A).

Run:
  python app.py
"""
import json
import math
from pathlib import Path

import gradio as gr
import numpy as np
import plotly.graph_objects as go
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
BBOX_W, BBOX_S = 72.572, 23.025
CENTER_LAT = 23.027


def _lonlat_to_m(lon, lat):
    x = (lon - BBOX_W) * 111320 * math.cos(math.radians(CENTER_LAT))
    y = (lat - BBOX_S) * 111320
    return x, y


# ── Run simulation ───────────────────────────────────────────────────────────

def run_utci():
    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import (
        AnalysesName, UtciModelRequest, UtciModelBaseRequest,
    )
    from infrared_sdk.models import TimePeriod, Location

    gm_path  = Path("results/obj_ground_materials.json")
    veg_path = Path("results/obj_trees.json")
    if not gm_path.exists() or not veg_path.exists():
        from convert_obj import main as build
        build()

    ground_materials = json.loads(gm_path.read_text())
    vegetation       = json.loads(veg_path.read_text())

    loc = Location(latitude=23.027, longitude=72.574)
    tp  = TimePeriod(
        start_month=5, start_day=1,  start_hour=9,
        end_month=5,   end_day=31,   end_hour=18,
    )

    with InfraredClient() as client:
        wfiles = client.weather.get_weather_file_from_location(
            lat=loc.latitude, lon=loc.longitude, radius=150,
        )
        weather_data = client.weather.filter_weather_data(
            identifier=wfiles[0]["uuid"], time_period=tp,
        )
        area = client.buildings.get_area(POLYGON)

        payload = UtciModelRequest.from_weatherfile_payload(
            payload=UtciModelBaseRequest(
                analysis_type=AnalysesName.thermal_comfort_index,
            ),
            location=loc, time_period=tp, weather_data=weather_data,
        )
        result = client.run_area_and_wait(
            payload, POLYGON,
            buildings=area.buildings,
            vegetation=vegetation,
            ground_materials=ground_materials,
        )

    grid = result.merged_grid
    zmin = result.min_legend if result.min_legend is not None else float(np.nanmin(grid))
    zmax = result.max_legend if result.max_legend is not None else float(np.nanmax(grid))

    # ── Persist results for 3D view ──
    out = Path("results")
    np.save(out / "utci_grid.npy", grid)

    buildings_data = {}
    for bid, mesh in area.buildings.items():
        coords = mesh.coordinates if hasattr(mesh, "coordinates") else mesh.get("coordinates", [])
        idxs   = mesh.indices    if hasattr(mesh, "indices")    else mesh.get("indices", [])
        buildings_data[bid] = {"coordinates": list(coords), "indices": list(idxs)}

    (out / "utci_meta.json").write_text(json.dumps({
        "zmin": zmin, "zmax": zmax,
        "n_buildings": len(buildings_data),
        "n_trees": len(vegetation),
    }))
    (out / "utci_buildings.json").write_text(json.dumps(buildings_data))

    # ── 2D heatmap ──
    fig2d = go.Figure(go.Heatmap(
        z=grid,
        colorscale="RdYlBu_r",
        zmin=zmin, zmax=zmax,
        colorbar=dict(title=dict(text="UTCI (°C)", side="right")),
    ))
    fig2d.update_layout(
        title="Baseline UTCI — May 9 am–6 pm average",
        xaxis_title="← West · East →",
        yaxis_title="← South · North →",
        height=520,
        margin=dict(l=10, r=10, t=45, b=45),
    )

    mean_u = float(np.nanmean(grid))
    max_u  = float(np.nanmax(grid))
    hot_m2 = int(np.sum(grid > 46))

    stats = (
        f"| Metric | Value |\n|---|---|\n"
        f"| Mean UTCI | **{mean_u:.1f} °C** |\n"
        f"| Max UTCI  | **{max_u:.1f} °C** |\n"
        f"| Cells > 46 °C (extreme heat) | **{hot_m2:,} m²** |\n"
        f"| Ground zones (from .obj) | {len(ground_materials)} |\n"
        f"| Trees (from .obj) | {len(vegetation)} |\n"
        f"| Buildings (OSM) | {len(area.buildings)} |"
    )

    return fig2d, stats, gr.update(interactive=True, value="View in 3D")


# ── Build 3D scene ───────────────────────────────────────────────────────────

def view_3d():
    grid_path  = Path("results/utci_grid.npy")
    meta_path  = Path("results/utci_meta.json")
    bld_path   = Path("results/utci_buildings.json")
    veg_path   = Path("results/obj_trees.json")
    mesh_path  = Path("results/obj_meshes.json")

    if not grid_path.exists():
        return None

    grid       = np.load(grid_path)
    meta       = json.loads(meta_path.read_text())
    buildings  = json.loads(bld_path.read_text())
    vegetation = json.loads(veg_path.read_text())
    obj_meshes = json.loads(mesh_path.read_text()) if mesh_path.exists() else {}

    zmin, zmax = meta["zmin"], meta["zmax"]
    n_rows, n_cols = grid.shape

    fig = go.Figure()

    def _sample_utci(xs, ys):
        """Sample UTCI grid at a list of (x_m, y_m) SDK positions."""
        vals = []
        for x, y in zip(xs, ys):
            col = int(np.clip(x, 0, n_cols - 1))
            row = int(np.clip(y, 0, n_rows - 1))
            vals.append(float(grid[row, col]))
        return vals

    # Colour and display config per material
    MAT_STYLE = {
        "water":      dict(color="#1e90ff", opacity=0.75, name="River (water)"),
        "concrete":   dict(color=None,      opacity=1.0,  name="Promenade (concrete)"),
        "asphalt":    dict(color=None,      opacity=1.0,  name="Road + Bridge (asphalt)"),
        "soil":       dict(color=None,      opacity=1.0,  name="Riverbank (soil)"),
        "vegetation": dict(color=None,      opacity=1.0,  name="Ground cover (vegetation)"),
    }

    colorbar_added = False
    for sdk_key, mesh in obj_meshes.items():
        style = MAT_STYLE.get(sdk_key, dict(color=None, opacity=1.0, name=sdk_key))
        xs, ys, zs = mesh["x"], mesh["y"], mesh["z"]
        ii, jj, kk = mesh["i"], mesh["j"], mesh["k"]

        if style["color"]:
            # Flat colour (river)
            fig.add_trace(go.Mesh3d(
                x=xs, y=ys, z=zs, i=ii, j=jj, k=kk,
                color=style["color"],
                opacity=style["opacity"],
                flatshading=False,
                name=style["name"],
                showlegend=True,
                hoverinfo="name",
            ))
        else:
            # UTCI-coloured surface
            intensity = _sample_utci(xs, ys)
            fig.add_trace(go.Mesh3d(
                x=xs, y=ys, z=zs, i=ii, j=jj, k=kk,
                intensity=intensity,
                colorscale="RdYlBu_r",
                cmin=zmin, cmax=zmax,
                showscale=not colorbar_added,
                colorbar=dict(
                    title=dict(text="UTCI (°C)", side="right"),
                    len=0.55, thickness=14, x=1.01,
                ) if not colorbar_added else {},
                opacity=style["opacity"],
                flatshading=False,
                name=style["name"],
                showlegend=True,
                hovertemplate=f"{style['name']}<br>UTCI: %{{intensity:.1f}} °C<extra></extra>",
            ))
            colorbar_added = True

    # ── SDK buildings — merged into one grey Mesh3d ──
    bx, by, bz, bi, bj, bk = [], [], [], [], [], []
    offset = 0
    for mesh in buildings.values():
        coords = mesh["coordinates"]
        n = len(coords) // 3
        if n < 3:
            continue
        bx.extend(coords[0::3])
        by.extend(coords[1::3])
        bz.extend(coords[2::3])
        idxs = mesh["indices"]
        bi.extend(idx + offset for idx in idxs[0::3])
        bj.extend(idx + offset for idx in idxs[1::3])
        bk.extend(idx + offset for idx in idxs[2::3])
        offset += n

    if bx:
        fig.add_trace(go.Mesh3d(
            x=bx, y=by, z=bz, i=bi, j=bj, k=bk,
            color="#c8c6be",
            flatshading=True,
            lighting=dict(ambient=0.75, diffuse=0.5),
            name=f"Buildings ({len(buildings)}, OSM)",
            showlegend=True,
            hoverinfo="name",
        ))

    # ── Trees — trunks + canopy dots ──
    trunk_x, trunk_y, trunk_z = [], [], []
    canopy_x, canopy_y = [], []
    for feat in vegetation.values():
        lon, lat = feat["geometry"]["coordinates"][:2]
        x, y = _lonlat_to_m(lon, lat)
        trunk_x += [x, x, None]
        trunk_y += [y, y, None]
        trunk_z += [0, 7, None]
        canopy_x.append(x)
        canopy_y.append(y)

    if trunk_x:
        fig.add_trace(go.Scatter3d(
            x=trunk_x, y=trunk_y, z=trunk_z,
            mode="lines",
            line=dict(color="#6b3a1f", width=2),
            name="Tree trunks",
            showlegend=True,
            hoverinfo="none",
        ))
        fig.add_trace(go.Scatter3d(
            x=canopy_x, y=canopy_y,
            z=[8] * len(canopy_x),
            mode="markers",
            marker=dict(size=5, color="#2a7d3f", opacity=0.85),
            name=f"Trees ({len(canopy_x)}, from .obj)",
            showlegend=True,
            hovertemplate="Tree<extra></extra>",
        ))

    fig.update_layout(
        title="Sabarmati Riverfront — UTCI on Model Geometry  (May 9 am–6 pm)",
        scene=dict(
            xaxis=dict(title="East (m)", range=[0, n_cols]),
            yaxis=dict(title="North (m)", range=[0, n_rows]),
            zaxis=dict(title="Height (m)", range=[0, 25]),
            camera=dict(
                up=dict(x=0, y=0, z=1),
                center=dict(x=0, y=0, z=-0.1),
                eye=dict(x=-0.5, y=-1.8, z=0.65),
            ),
            aspectmode="manual",
            aspectratio=dict(x=1.0, y=1.1, z=0.12),
        ),
        legend=dict(x=0.01, y=0.99, bgcolor="rgba(255,255,255,0.8)", font=dict(size=11)),
        height=700,
        margin=dict(l=0, r=0, t=45, b=0),
    )

    return fig


# ── UI ───────────────────────────────────────────────────────────────────────

with gr.Blocks(title="Sabarmati Riverfront UTCI") as demo:
    gr.Markdown(
        "## Sabarmati Riverfront — Baseline UTCI\n"
        "Materials + trees from `Riverfront-model.obj` · Buildings from OSM · May 9 am–6 pm"
    )

    with gr.Row():
        run_btn  = gr.Button("Run UTCI Simulation", variant="primary", size="lg")
        view_btn = gr.Button("View in 3D", size="lg", interactive=False)

    with gr.Tabs():
        with gr.Tab("2D Heatmap"):
            with gr.Row():
                heatmap_2d = gr.Plot(label="UTCI Heatmap")
                stats_md   = gr.Markdown("Click **Run** to start (~30–60 s).")

        with gr.Tab("3D Viewport"):
            heatmap_3d = gr.Plot(label="3D Scene")

    run_btn.click(
        fn=run_utci,
        outputs=[heatmap_2d, stats_md, view_btn],
    )
    view_btn.click(
        fn=view_3d,
        outputs=[heatmap_3d],
    )


if __name__ == "__main__":
    demo.launch(theme=gr.themes.Soft())
