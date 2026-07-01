import os
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from app.config import settings
from app.services.runners.registry import RunnerRegistry
from app.services.runners.diffusers import DiffusersRunner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/adapters", tags=["adapters"])


def _get_diffusers_runner() -> DiffusersRunner:
    runner = RunnerRegistry.get("diffusers")
    if runner is None:
        raise HTTPException(status_code=503, detail="Diffusers runner not registered")
    return runner


@router.post("/lora/apply")
async def apply_lora(
    lora_file: UploadFile = File(...),
    model: str = Form(...),
    scale: float = Form(1.0, ge=0.0, le=2.0),
):
    ext = os.path.splitext(lora_file.filename or "lora.safetensors")[1].lower()
    allowed = {".safetensors", ".bin", ".pt", ".pth"}
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported LoRA format '{ext}'. Allowed: safetensors, bin, pt, pth",
        )

    os.makedirs(settings.upload_dir, exist_ok=True)
    content = await lora_file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_size_mb} MB",
        )

    lora_path = os.path.join(settings.upload_dir, lora_file.filename or "lora.safetensors")
    with open(lora_path, "wb") as f:
        f.write(content)

    try:
        runner = _get_diffusers_runner()
        runner.load(model)
        runner._gen.apply_lora(lora_path, scale)
        return {"status": "ok", "message": f"LoRA applied: {lora_file.filename} (scale={scale})"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/lora/unload")
async def unload_lora():
    try:
        runner = _get_diffusers_runner()
        runner._gen.unload_lora()
        return {"status": "ok", "message": "LoRA unloaded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/controlnet/apply")
async def apply_controlnet(
    model: str = Form(...),
    controlnet_model: str = Form(...),
):
    try:
        runner = _get_diffusers_runner()
        runner.load(model)
        runner._gen.apply_controlnet(controlnet_model)
        return {"status": "ok", "message": f"ControlNet applied: {controlnet_model}"}
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/controlnet/unload")
async def unload_controlnet():
    try:
        runner = _get_diffusers_runner()
        runner._gen.unload_controlnet()
        return {"status": "ok", "message": "ControlNet unloaded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def adapter_status():
    runner = _get_diffusers_runner()
    gen = runner._gen
    return {
        "lora": gen._active_lora is not None,
        "lora_path": gen._active_lora,
        "controlnet": False,
    }
