import logging
from fastapi import APIRouter, HTTPException
from app.schemas import BaselineRequest, ScenarioRequest
from app.services import infrared as svc
from app.services.infrared import TREE_SPECIES

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sims"])


@router.get("/trees")
def trees():
    return list(TREE_SPECIES.values())


@router.post("/baseline")
def baseline(req: BaselineRequest):
    try:
        return svc.run_baseline(req.polygon)
    except Exception as exc:
        log.exception("baseline failed")
        raise HTTPException(500, detail=str(exc))


@router.post("/scenario")
def scenario(req: ScenarioRequest):
    try:
        zones = [{"material": z.material, "polygon": z.polygon} for z in req.painted_zones]
        tree_placements = [
            {"species_id": t.species_id, "lon": t.lon, "lat": t.lat}
            for t in req.tree_placements
        ]
        return svc.run_scenario(
            req.polygon, zones,
            req.baseline_ground_materials,
            req.buildings,
            tree_placements=tree_placements,
        )
    except Exception as exc:
        log.exception("scenario failed")
        raise HTTPException(500, detail=str(exc))
