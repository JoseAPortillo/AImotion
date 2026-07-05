from fastapi import APIRouter
from app.api.hardware import _get_vram_info
from app.models.generate import HealthResponse
from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    vram = _get_vram_info()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        gpu_available=vram.get("gpu_available", False),
        gpu_name=vram.get("gpu_name"),
        vram_total_gb=vram.get("vram_total_gb"),
        vram_free_gb=vram.get("vram_free_gb"),
    ).__dict__
