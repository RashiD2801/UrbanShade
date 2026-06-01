from pydantic import BaseModel


class BaselineRequest(BaseModel):
    polygon: dict  # GeoJSON Polygon


class PaintedZone(BaseModel):
    material: str
    polygon: dict  # GeoJSON Feature or Polygon


class ScenarioRequest(BaseModel):
    polygon: dict
    painted_zones: list[PaintedZone]
    baseline_ground_materials: dict   # {sdk_key: FeatureCollection}
    buildings: dict                   # {bid: {coordinates, indices}}
