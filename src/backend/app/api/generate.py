import os
import json
import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import settings
from app.models.generate import TaskInfo, TaskStatus
from app.services.task_manager import TaskManager
from app.services.generator import extract_frames, get_model_config
from app.services.model_catalog import catalog
from app.services.runners.base import GenerateParams
from app.services.runners.registry import RunnerRegistry



logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generate"])

task_manager = TaskManager()

_default_variant = catalog.get_variant(settings.model_type)
_defaults = _default_variant.defaults if _default_variant else {"width": 720, "height": 480, "steps": 50, "cfg": 7.0}

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}


def _validate_video(file: UploadFile) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format '{ext}'. Allowed: mp4, mov, avi, mkv",
        )
    return ext


def _validate_dimensions(width: int, height: int):
    if width % 8 != 0:
        raise HTTPException(
            status_code=422, detail=f"Width must be a multiple of 8, got {width}"
        )
    if height % 8 != 0:
        raise HTTPException(
            status_code=422, detail=f"Height must be a multiple of 8, got {height}"
        )
    if width > settings.max_width:
        raise HTTPException(
            status_code=422,
            detail=f"Width exceeds maximum of {settings.max_width}",
        )
    if height > settings.max_height:
        raise HTTPException(
            status_code=422,
            detail=f"Height exceeds maximum of {settings.max_height}",
        )


def _get_runner(model_key: str):
    variant = catalog.get_variant(model_key)
    family = variant.family if variant else None
    runner_key = family.runner if family else "diffusers"

    runner = RunnerRegistry.get(runner_key)
    if runner is not None:
        return runner

    if runner_key != "diffusers":
        raise ValueError(
            f"Runner '{runner_key}' is required for model '{model_key}' "
            f"but is not installed or registered. Install the model again to "
            f"set up the runner automatically, or install the runner package manually."
        )

    runner = RunnerRegistry.get("diffusers")
    if runner is None:
        raise ValueError("Default runner 'diffusers' is not registered. Cannot generate.")
    return runner


@router.post("", status_code=202)
async def create_generation(
    image: Optional[UploadFile] = File(None),
    video: Optional[UploadFile] = File(None),
    prompt: str = Form("", max_length=1000),
    negative_prompt: str = Form("", max_length=1000),
    width: int = Form(_defaults["width"]),
    height: int = Form(_defaults["height"]),
    steps: int = Form(_defaults["steps"], ge=1, le=100),
    cfg: float = Form(_defaults["cfg"], ge=1.0, le=20.0),
    seed: int = Form(0, ge=0),
    strength: float = Form(0.8, ge=0.0, le=1.0),
    scheduler: str = Form(""),
    execution_mode: str = Form("local"),
    model: str = Form(settings.model_type),
    num_frames: Optional[int] = Form(None),
    max_sequence_length: Optional[int] = Form(None),
    decode_chunk_size: Optional[int] = Form(None),
    noise_aug_strength: Optional[float] = Form(None),
    min_guidance_scale: Optional[float] = Form(None),
    max_guidance_scale: Optional[float] = Form(None),
    fps: Optional[int] = Form(None),
    motion_bucket_id: Optional[int] = Form(None),
    vae_tiling: Optional[bool] = Form(None),
    vae_tile_overlap: Optional[float] = Form(None),
    extra_params: Optional[str] = Form(None),
):
    model_cfg = get_model_config(model)
    if model_cfg is None:
        variants = [v.key for v in catalog.all_variants()]
        raise HTTPException(
            status_code=422,
            detail=f"Unknown model '{model}'. Valid: {', '.join(variants)}",
        )
    _validate_dimensions(width, height)
    model_schedulers = model_cfg.get("schedulers", {})
    if scheduler and scheduler not in model_schedulers:
        valid = ", ".join(model_schedulers)
        raise HTTPException(
            status_code=422,
            detail=f"Unknown scheduler '{scheduler}' for {model}. Valid: {valid}",
        )
    image_path = None
    if image:
        logger.info(f"Received image file: {image.filename}, content_type: {image.content_type}")
        os.makedirs(settings.upload_dir, exist_ok=True)
        file_ext = os.path.splitext(image.filename or "input.png")[1] or ".png"
        upload_path = os.path.join(settings.upload_dir, f"img_{seed}{file_ext}")
        content = await image.read()
        logger.info(f"Image content size: {len(content)} bytes")
        if len(content) > settings.max_upload_size_mb * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds maximum size of {settings.max_upload_size_mb} MB",
            )
        with open(upload_path, "wb") as f:
            f.write(content)
        image_path = upload_path
    video_path = None
    if video:
        _validate_video(video)
        os.makedirs(settings.upload_dir, exist_ok=True)
        file_ext = os.path.splitext(video.filename or "input.mp4")[1] or ".mp4"
        upload_path = os.path.join(settings.upload_dir, f"video_{seed}{file_ext}")
        content = await video.read()
        if len(content) > settings.max_upload_size_mb * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds maximum size of {settings.max_upload_size_mb} MB",
            )
        with open(upload_path, "wb") as f:
            f.write(content)
        video_path = upload_path
    params = {
        "image_path": image_path,
        "video_path": video_path,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "width": width,
        "height": height,
        "steps": steps,
        "cfg": cfg,
        "seed": seed,
        "strength": strength,
        "scheduler": scheduler or None,
        "execution_mode": execution_mode,
        "model": model,
        "num_frames": num_frames,
        "max_sequence_length": max_sequence_length,
        "decode_chunk_size": decode_chunk_size,
        "noise_aug_strength": noise_aug_strength,
        "min_guidance_scale": min_guidance_scale,
        "max_guidance_scale": max_guidance_scale,
        "fps": fps,
        "motion_bucket_id": motion_bucket_id,
        "vae_tiling": vae_tiling,
        "vae_tile_overlap": vae_tile_overlap,
        "extra": json.loads(extra_params) if extra_params else {},
    }
    task_id = await task_manager.create_task(params)
    _dispatch_generation(task_id, params)
    return TaskInfo(task_id=task_id, status=TaskStatus.PENDING).__dict__


def _dispatch_generation(task_id: str, params: dict):
    asyncio.create_task(_run_generation(task_id, params))


async def _run_generation(task_id: str, params: dict):
    runner = None
    try:
        task = await task_manager.get_task(task_id)
        if task is None or task.cancel_event.is_set():
            return

        await task_manager.set_running(task_id, params["steps"])

        async def progress_callback(current: int, total: int):
            if task.cancel_event.is_set():
                raise asyncio.CancelledError("Generation cancelled by user")
            await task_manager.set_progress(task_id, current, total)

        model = params.get("model", settings.model_type)
        variant = catalog.get_variant(model)
        frames = variant.defaults.get("num_frames", 49) if variant else 49

        video_frames = None
        video_path = params.get("video_path")
        if video_path and os.path.exists(video_path):
            video_frames = extract_frames(video_path, max_frames=frames)
            if not video_frames:
                video_frames = None

        image_path = params.get("image_path")
        if image_path and os.path.exists(image_path) and not video_frames:
            from PIL import Image as PILImage
            logger.info(f"Loading image from {image_path} into video_frames")
            video_frames = [PILImage.open(image_path).convert("RGB")]
            logger.info(f"video_frames created with {len(video_frames)} frame(s), size: {video_frames[0].size}")

        extra = params.get("extra", {})
        if video_path:
            extra["video_path"] = video_path
        if image_path:
            extra["image_path"] = image_path
        if params.get("vae_tiling") is not None:
            extra["vae_tiling"] = params["vae_tiling"]
        if params.get("vae_tile_overlap") is not None:
            extra["vae_tile_overlap"] = params["vae_tile_overlap"]
        gen_params = GenerateParams(
            prompt=params["prompt"],
            negative_prompt=params.get("negative_prompt", ""),
            video_frames=video_frames,
            strength=params.get("strength", 0.8),
            width=params["width"],
            height=params["height"],
            steps=params["steps"],
            cfg=params["cfg"],
            seed=params["seed"],
            scheduler=params.get("scheduler"),
            model=model,
            num_frames=params.get("num_frames"),
            max_sequence_length=params.get("max_sequence_length"),
            decode_chunk_size=params.get("decode_chunk_size"),
            noise_aug_strength=params.get("noise_aug_strength"),
            min_guidance_scale=params.get("min_guidance_scale"),
            max_guidance_scale=params.get("max_guidance_scale"),
            fps=params.get("fps"),
            motion_bucket_id=params.get("motion_bucket_id"),
            extra=extra,
        )

        runner = _get_runner(model)
        result = await runner.generate(gen_params, progress_callback, cancel_event=task.cancel_event)
        result_type = "image" if result.url.endswith(".png") else "video"
        await task_manager.complete_task(task_id, result.url, result_type)
    except asyncio.CancelledError:
        logger.info(f"Task {task_id} was cancelled")
        await task_manager.cancel_task(task_id)
    except Exception as e:
        await task_manager.fail_task(task_id, str(e))


@router.get("/{task_id}")
async def get_task_status(task_id: str):
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()


@router.delete("/{task_id}")
async def cancel_generation(task_id: str):
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
        return {"status": task.status.value}
    await task_manager.cancel_task(task_id)
    return {"status": "cancelling"}


results_router = APIRouter(tags=["results"])


@results_router.get("/results/{filename}")
async def get_result(filename: str):
    filepath = os.path.join(settings.results_dir, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "image/png" if filename.endswith(".png") else "video/mp4"
    return FileResponse(filepath, media_type=media_type)
