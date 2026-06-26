from fastapi import APIRouter
from app.models.generate import HealthResponse
from app.config import settings

router = APIRouter(tags=["health"])


def _get_gpu_info() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            device = torch.cuda.current_device()
            name = torch.cuda.get_device_name(device)
            props = torch.cuda.get_device_properties(device)
            total = getattr(props, "total_memory", getattr(props, "total_mem", 0)) / (1024 ** 3)
            free = (
                torch.cuda.mem_get_info(device)[0]
                / (1024 ** 3)
                if hasattr(torch.cuda, "mem_get_info")
                else total * 0.7
            )
            return {
                "gpu_available": True,
                "gpu_name": name,
                "vram_total_gb": round(total, 1),
                "vram_free_gb": round(free, 1),
            }
    except Exception:
        pass
    return {
        "gpu_available": False,
        "gpu_name": None,
        "vram_total_gb": None,
        "vram_free_gb": None,
    }


@router.get("/health")
async def health():
    gpu = _get_gpu_info()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        **gpu,
    ).__dict__
