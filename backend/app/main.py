from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.settings import get_settings
from app.routers import sims, health


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Barcelona Urban Heat Tool API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(sims.router)
    return app


app = create_app()
