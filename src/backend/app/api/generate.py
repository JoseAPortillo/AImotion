import os
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import settings
from app.models.generate import TaskInfo, TaskStatus
from app.services.task_manager import TaskManager
from app.services.generator import VideoGenerator, SUPPORTED_MODELS, extract_frames, SCHEDULER_NAMES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generate"])

task_manager = TaskManager()
video_generator = VideoGenerator()
_defaults = SUPPORTED_MODELS[settings.model_type]["defaults"]

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


@router.post("", status_code=202)
async def create_generation(
    video: Optional[UploadFile] = File(None),
    prompt: str = Form(..., min_length=1, max_length=1000),
    negative_prompt: str = Form("", max_length=1000),
    width: int = Form(_defaults["width"]),
    height: int = Form(_defaults["height"]),
    steps: int = Form(_defaults["steps"], ge=1, le=100),
    cfg: float = Form(_defaults["cfg"], ge=1.0, le=20.0),
    seed: int = Form(0, ge=0),
    strength: float = Form(0.8, ge=0.0, le=1.0),
    scheduler: str = Form(""),
):
    _validate_dimensions(width, height)
    model_schedulers = SUPPORTED_MODELS[settings.model_type].get("schedulers", {})
    if scheduler and scheduler not in model_schedulers:
        valid = ", ".join(model_schedulers)
        raise HTTPException(
            status_code=422,
            detail=f"Unknown scheduler '{scheduler}' for {settings.model_type}. Valid: {valid}",
        )
    video_path = None
    if video:
        _validate_video(video)
        os.makedirs(settings.upload_dir, exist_ok=True)
        file_ext = os.path.splitext(video.filename or "input.mp4")[1]
        upload_path = os.path.join(settings.upload_dir, f"input_{seed}{file_ext}")
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
    }
    task_id = await task_manager.create_task(params)
    _dispatch_generation(task_id, params)
    return TaskInfo(task_id=task_id, status=TaskStatus.PENDING).__dict__


def _dispatch_generation(task_id: str, params: dict):
    import asyncio

    asyncio.create_task(_run_generation(task_id, params))


async def _run_generation(task_id: str, params: dict):
    try:
        await task_manager.set_running(task_id, params["steps"])

        async def progress_callback(current: int, total: int):
            await task_manager.set_progress(task_id, current, total)

        video_frames = None
        video_path = params.get("video_path")
        if video_path and os.path.exists(video_path):
            video_frames = extract_frames(video_path, max_frames=12)
            if not video_frames:
                video_frames = None

        result_url = await video_generator.generate(
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
            progress_callback=progress_callback,
        )
        await task_manager.complete_task(task_id, result_url)
    except Exception as e:
        await task_manager.fail_task(task_id, str(e))
    finally:
        video_generator.unload()


@router.get("/{task_id}")
async def get_task_status(task_id: str):
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()


results_router = APIRouter(tags=["results"])


@results_router.get("/results/{filename}")
async def get_result(filename: str):
    filepath = os.path.join(settings.results_dir, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath, media_type="video/mp4")
