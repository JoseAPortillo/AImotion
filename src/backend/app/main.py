import os
import logging
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.generate import router as generate_router, results_router, task_manager
from app.api.prompt import router as prompt_router
from app.api.vlm import router as vlm_router
from app.api.llm import router as llm_router
from app.api.adapters import router as adapters_router
from app.api.graph import router as graph_router
from app.api.hardware import router as hardware_router
from app.api.models import router as models_router
from app.api.credentials import router as credentials_router
from app.config import settings
from app.services.runners.registry import RunnerRegistry
from app.services.runners.diffusers import DiffusersRunner
from app.services.runners.gguf import GGUFRunner
from app.services.runners.api import APIRunner
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


warnings.filterwarnings("ignore", message=".*unsafe pickle serialization.*")

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.results_dir, exist_ok=True)
    await task_manager.start_cleanup()

    # Register built-in runners
    RunnerRegistry.register("diffusers", DiffusersRunner())
    RunnerRegistry.register("gguf", GGUFRunner())
    RunnerRegistry.register("api", APIRunner())
    logger.info("Built-in runners registered")

    logger.info("AImation backend started")
    yield
    logger.info("AImation backend shutting down")


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.include_router(health_router)
app.include_router(generate_router)
app.include_router(results_router)
app.include_router(prompt_router)
app.include_router(vlm_router)
app.include_router(llm_router)
app.include_router(adapters_router)
app.include_router(graph_router)
app.include_router(hardware_router)
app.include_router(models_router)
app.include_router(credentials_router)

static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
