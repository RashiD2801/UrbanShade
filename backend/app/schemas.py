from pydantic import BaseModel


class BaselineRequest(BaseModel):
    polygon: dict  # GeoJSON Polygon


class PaintedZone(BaseModel):
    material: str
    polygon: dict  # GeoJSON Feature or Polygon


class TreePlacement(BaseModel):
    species_id: str
    lon: float
    lat: float


class ScenarioRequest(BaseModel):
    polygon: dict
    painted_zones: list[PaintedZone]
    baseline_ground_materials: dict   # {sdk_key: FeatureCollection}
    buildings: dict                   # {bid: {coordinates, indices}}
    tree_placements: list[TreePlacement] = []


class AutoSimRequest(BaseModel):
    polygon: dict
    baseline_ground_materials: dict
    buildings: dict
    baseline_mean_utci: float
    utci_grid: list | None = None
    utci_bounds: list | None = None


class BestScenarioRequest(BaseModel):
    polygon: dict
    baseline_ground_materials: dict
    buildings: dict
    baseline_mean_utci: float
    utci_grid: list | None = None
    utci_bounds: list | None = None
