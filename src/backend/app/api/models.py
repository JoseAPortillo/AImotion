import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import settings
from app.services.generator import VideoGenerator, SUPPORTED_MODELS
from app.services.model_registry import (
    list_installed, find_installed, add_installed, remove_installed,
    generate_key, is_model_cached, discover_pipeline,
    InstalledModel,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models", tags=["models"])

_video_generator = VideoGenerator()


BUILTIN_CATALOG: list[dict] = [
    {
        "key": "cogvideox-2b",
        "name": "CogVideoX-2b",
        "hf_name": "THUDM/CogVideoX-2b",
        "type": "builtin",
        "size_gb": 5.2,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["cogvideox-2b"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["cogvideox-2b"].get("default_scheduler", ""),
    },
    {
        "key": "cogvideox-5b",
        "name": "CogVideoX-5b",
        "hf_name": "THUDM/CogVideoX-5b",
        "type": "builtin",
        "size_gb": 10.0,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["cogvideox-5b"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["cogvideox-5b"].get("default_scheduler", ""),
    },
    {
        "key": "ltx-video",
        "name": "LTX-Video",
        "hf_name": "Lightricks/LTX-Video",
        "type": "builtin",
        "size_gb": 8.0,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["ltx-video"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["ltx-video"].get("default_scheduler", ""),
    },
    {
        "key": "wan2.2",
        "name": "Wan2.2",
        "hf_name": None,
        "type": "future",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
    {
        "key": "seedance",
        "name": "Seedance",
        "hf_name": None,
        "type": "api",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
    {
        "key": "kling",
        "name": "Kling",
        "hf_name": None,
        "type": "api",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
]


def _build_model_entry(m: dict) -> dict:
    entry = dict(m)
    if m["hf_name"]:
        entry["cached"] = is_model_cached(m["hf_name"])
    entry["loaded"] = (
        _video_generator._current_model_key == m["key"]
        or _video_generator._current_v2v_model_key == m["key"]
    )
    return entry


@router.get("")
async def list_models():
    results = []
    for m in BUILTIN_CATALOG:
        results.append(_build_model_entry(m))
    for inst in list_installed():
        results.append({
            "key": inst.key,
            "name": inst.alias or inst.hf_name,
            "hf_name": inst.hf_name,
            "type": "installed",
            "size_gb": None,
            "cached": is_model_cached(inst.hf_name),
            "loaded": _video_generator._current_model_key == inst.key,
            "schedulers": list(inst.schedulers.keys()),
            "default_scheduler": inst.default_scheduler,
            "alias": inst.alias,
            "pipeline_class": inst.pipeline_class,
        })
    return {"models": results}


class InstallRequest(BaseModel):
    hf_name: str
    alias: str = ""


@router.post("/install")
async def install_model(req: InstallRequest):
    hf_name = req.hf_name.strip()
    if not hf_name:
        raise HTTPException(status_code=422, detail="hf_name is required")

    key = generate_key(hf_name)
    existing = find_installed(key)
    if existing and is_model_cached(hf_name):
        return {"status": "already_installed", "model_key": existing.key}

    discovered = discover_pipeline(hf_name)
    if discovered is None:
        raise HTTPException(
            status_code=422,
            detail=f"Model '{hf_name}' is not a valid or supported pipeline. "
                   f"Ensure it exists on HuggingFace and contains model weights.",
        )

    pipeline_class_name = discovered["pipeline_class"]
    tok = settings.hf_token or None

    from huggingface_hub import snapshot_download

    logger.info(f"Downloading {hf_name} (pipeline: {pipeline_class_name})...")
    try:
        snapshot_download(repo_id=hf_name, token=tok, ignore_patterns=["*.gitattributes"])
    except Exception as e:
        logger.error(f"Failed to download {hf_name}: {e}")
        raise HTTPException(
            status_code=422,
            detail=f"Failed to download model '{hf_name}': {e}",
        )
    logger.info(f"Downloaded {hf_name}")

    alias = req.alias or hf_name.split("/")[-1]
    model = InstalledModel(
        key=key,
        hf_name=hf_name,
        alias=alias,
        pipeline_class=pipeline_class_name,
        dtype=discovered.get("dtype", "float16"),
        schedulers=discovered["schedulers"],
        default_scheduler=discovered["default_scheduler"],
        needs_token=False,
        defaults=discovered["defaults"],
        installed_at=__import__("datetime").datetime.now().isoformat(),
    )
    add_installed(model)
    return {
        "status": "installed",
        "model_key": key,
        "alias": alias,
        "pipeline_class": pipeline_class_name,
        "schedulers": model.schedulers,
    }


class UpdateAliasRequest(BaseModel):
    alias: str


@router.put("/{model_key}")
async def update_model(model_key: str, req: UpdateAliasRequest):
    model = find_installed(model_key)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    model.alias = req.alias
    add_installed(model)
    return {"status": "updated", "model_key": model_key, "alias": req.alias}


@router.delete("/{model_key}")
async def uninstall_model(model_key: str):
    model = find_installed(model_key)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found in registry")
    if _video_generator._current_model_key == model_key:
        _video_generator.unload()
    remove_installed(model_key)
    return {"status": "uninstalled", "model_key": model_key}


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
