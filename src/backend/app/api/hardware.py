import logging
import time

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hardware", tags=["hardware"])

_vram_cache: dict | None = None
_vram_cache_ts: float = 0
_VRAM_CACHE_TTL = 2.0


def _get_vram_info(use_cache: bool = True) -> dict:
    global _vram_cache, _vram_cache_ts
    if use_cache and _vram_cache is not None and time.monotonic() - _vram_cache_ts < _VRAM_CACHE_TTL:
        return _vram_cache
    try:
        import torch

        if not torch.cuda.is_available():
            return {
                "gpu_available": False,
                "gpu_name": None,
                "vram_total_gb": None,
                "vram_free_gb": None,
                "vram_used_gb": None,
                "vram_percent": None,
                "alert": False,
                "message": None,
            }

        device = torch.cuda.current_device()
        name = torch.cuda.get_device_name(device)
        props = torch.cuda.get_device_properties(device)
        total_bytes = getattr(props, "total_memory", getattr(props, "total_mem", 0))
        total_gb = total_bytes / (1024 ** 3)

        if hasattr(torch.cuda, "mem_get_info"):
            free_bytes, total_bytes_from_api = torch.cuda.mem_get_info(device)
            free_gb = free_bytes / (1024 ** 3)
            total_for_calc = total_bytes_from_api / (1024 ** 3)
        else:
            free_gb = total_gb * 0.7
            total_for_calc = total_gb

        used_gb = total_for_calc - free_gb
        percent = (used_gb / total_for_calc * 100) if total_for_calc > 0 else 0.0

        free_under_12 = free_gb < 12
        used_over_80 = percent > 80
        alert = free_under_12 or used_over_80

        messages = []
        if free_under_12:
            messages.append(f"Low VRAM: {free_gb:.1f} GB free. Switching to API mode is recommended.")
        if used_over_80:
            messages.append(f"VRAM usage at {percent:.0f}%. Consider freeing resources.")
        message = " ".join(messages) if messages else None

        result = {
            "gpu_available": True,
            "gpu_name": name,
            "vram_total_gb": round(total_gb, 1),
            "vram_free_gb": round(free_gb, 1),
            "vram_used_gb": round(used_gb, 1),
            "vram_percent": round(percent, 1),
            "alert": alert,
            "message": message,
        }
        _vram_cache = result
        _vram_cache_ts = time.monotonic()
        return result
    except Exception as e:
        logger.warning(f"Failed to read VRAM info: {e}")
        return {
            "gpu_available": False,
            "gpu_name": None,
            "vram_total_gb": None,
            "vram_free_gb": None,
            "vram_used_gb": None,
            "vram_percent": None,
            "alert": False,
            "message": None,
        }


@router.get("/vram")
async def vram_telemetry():
    return _get_vram_info()
