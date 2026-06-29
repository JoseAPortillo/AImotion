import os
import logging
import glob as glob_mod
from fastapi import APIRouter, HTTPException
from app.config import settings
from app.services.generator import VideoGenerator, SUPPORTED_MODELS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models", tags=["models"])

_video_generator = VideoGenerator()


def _hf_cache_path() -> str:
    return os.path.expanduser("~/.cache/huggingface/hub")


def _is_model_cached(hf_name: str) -> bool:
    safe = hf_name.replace("/", "--")
    pattern = f"models--{safe}*"
    cache_dir = _hf_cache_path()
    if not os.path.isdir(cache_dir):
        return False
    return len(glob_mod.glob(os.path.join(cache_dir, pattern))) > 0


def _model_size_gb(hf_name: str) -> float | None:
    sizes = {
        "THUDM/CogVideoX-2b": 5.2,
        "THUDM/CogVideoX-5b": 10.0,
        "Lightricks/LTX-Video": 8.0,
    }
    return sizes.get(hf_name)


MODELS_CATALOG: list[dict] = [
    {
        "key": "cogvideox-2b",
        "name": "CogVideoX-2b",
        "hf_name": "THUDM/CogVideoX-2b",
        "type": "local",
        "pipeline": "CogVideoX (Diffusers)",
        "source": "Hugging Face",
        "description": "2B param video generation model by THUDM. Good quality, fast on 10GB VRAM.",
    },
    {
        "key": "cogvideox-5b",
        "name": "CogVideoX-5b",
        "hf_name": "THUDM/CogVideoX-5b",
        "type": "local",
        "pipeline": "CogVideoX (Diffusers)",
        "source": "Hugging Face",
        "description": "5B param video generation model by THUDM. Higher quality, requires 16GB+ VRAM.",
    },
    {
        "key": "cogvideox",
        "name": "CogVideoX (bf16)",
        "hf_name": "THUDM/CogVideoX-2b",
        "type": "local",
        "pipeline": "CogVideoX (Diffusers)",
        "source": "Hugging Face",
        "description": "Same as 2b but in bfloat16 precision.",
    },
    {
        "key": "ltx-video",
        "name": "LTX-Video",
        "hf_name": "Lightricks/LTX-Video",
        "type": "local",
        "pipeline": "LTX (Diffusers)",
        "source": "Hugging Face",
        "description": "Fast video generation by Lightricks. 8B param, 97 frames at 24fps. Requires HF token.",
    },
    {
        "key": "wan2.2",
        "name": "Wan2.2",
        "hf_name": None,
        "type": "local",
        "pipeline": "Custom",
        "source": "Hugging Face",
        "description": "Next-gen video model by Wan-AI. Not yet integrated.",
    },
    {
        "key": "seedance",
        "name": "Seedance",
        "hf_name": None,
        "type": "api",
        "pipeline": "API",
        "source": "seedance.com",
        "description": "Commercial video generation API. Requires API key.",
    },
    {
        "key": "kling",
        "name": "Kling",
        "hf_name": None,
        "type": "api",
        "pipeline": "API",
        "source": "kling.kuaishou.com",
        "description": "Commercial video generation API by Kuaishou. Requires API key.",
    },
]


@router.get("")
async def list_models():
    results = []
    for m in MODELS_CATALOG:
        entry = dict(m)
        if m["hf_name"]:
            entry["cached"] = _is_model_cached(m["hf_name"])
            entry["size_gb"] = _model_size_gb(m["hf_name"])
        else:
            entry["cached"] = False
            entry["size_gb"] = None
        entry["loaded"] = (
            _video_generator._current_model_key == m["key"]
            or _video_generator._current_v2v_model_key == m["key"]
        )
        results.append(entry)
    return {"models": results}


@router.post("/install/{model_key}")
async def install_model(model_key: str):
    model_entry = next((m for m in MODELS_CATALOG if m["key"] == model_key), None)
    if model_entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_key}")
    if model_entry["type"] == "api":
        raise HTTPException(status_code=400, detail=f"{model_entry['name']} is API-based, cannot install")
    if model_entry.get("pipeline") == "Custom":
        raise HTTPException(status_code=501, detail=f"{model_entry['name']} integration not yet implemented")
    hf_name = model_entry["hf_name"]
    if not hf_name:
        raise HTTPException(status_code=400, detail="No Hugging Face repo configured for this model")
    if _is_model_cached(hf_name):
        return {"status": "already_cached", "model_key": model_key}

    import torch
    from diffusers import CogVideoXPipeline, LTXPipeline

    tok = settings.hf_token if model_entry["key"] in ("ltx-video",) else None
    cls = CogVideoXPipeline if "CogVideoX" in (model_entry.get("pipeline") or "") else LTXPipeline
    logger.info(f"Downloading {hf_name}...")
    cls.from_pretrained(hf_name, torch_dtype=torch.float16, token=tok)
    logger.info(f"Downloaded {hf_name}")
    return {"status": "installed", "model_key": model_key}


@router.post("/unload")
async def unload_models():
    _video_generator.unload()
    return {"status": "unloaded"}


@router.get("/status")
async def models_status():
    import torch
    gpu = {}
    if torch.cuda.is_available():
        device = torch.cuda.current_device()
        name = torch.cuda.get_device_name(device)
        props = torch.cuda.get_device_properties(device)
        total = getattr(props, "total_memory", 0) / (1024 ** 3)
        free = (
            torch.cuda.mem_get_info(device)[0] / (1024 ** 3)
            if hasattr(torch.cuda, "mem_get_info")
            else total * 0.7
        )
        gpu = {
            "gpu_available": True,
            "gpu_name": name,
            "vram_total_gb": round(total, 1),
            "vram_free_gb": round(free, 1),
        }
    else:
        gpu = {"gpu_available": False}
    return {
        **gpu,
        "current_model": _video_generator._current_model_key,
        "current_v2v_model": _video_generator._current_v2v_model_key,
    }
