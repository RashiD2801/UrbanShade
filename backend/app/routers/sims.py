import logging
from fastapi import APIRouter, HTTPException
from app.schemas import BaselineRequest, ScenarioRequest, AutoSimRequest, BestScenarioRequest
from app.services import infrared as svc
from app.services.infrared import TREE_SPECIES
from app.services import auto_sim as auto_svc

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


@router.post("/auto-simulate")
def auto_simulate(req: AutoSimRequest):
    try:
        return auto_svc.run_auto_simulate(
            req.polygon,
            req.baseline_ground_materials,
            req.buildings,
            req.baseline_mean_utci,
            utci_grid=req.utci_grid,
            utci_bounds=req.utci_bounds,
        )
    except Exception as exc:
        log.exception("auto-simulate failed")
        raise HTTPException(500, detail=str(exc))


@router.post("/best-scenario")
def best_scenario(req: BestScenarioRequest):
    try:
        return auto_svc.run_best_scenario(
            req.polygon,
            req.baseline_ground_materials,
            req.buildings,
            req.baseline_mean_utci,
            utci_grid=req.utci_grid,
            utci_bounds=req.utci_bounds,
        )
    except Exception as exc:
        log.exception("best-scenario failed")
        raise HTTPException(500, detail=str(exc))
