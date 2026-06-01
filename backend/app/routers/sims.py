import logging
from fastapi import APIRouter, HTTPException
from app.schemas import BaselineRequest, ScenarioRequest
from app.services import infrared as svc

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sims"])


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
        return svc.run_scenario(
            req.polygon, zones,
            req.baseline_ground_materials,
            req.buildings,
        )
    except Exception as exc:
        log.exception("scenario failed")
        raise HTTPException(500, detail=str(exc))
