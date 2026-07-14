import os
import base64
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from app.config import settings
from app.services.runners.registry import RunnerRegistry
from app.services.runners.base import GenerateParams

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transformers", tags=["transformers"])


class TransformersResponse(BaseModel):
    result: str


@router.post("/image-to-text", response_model=TransformersResponse)
async def image_to_text(
    image: UploadFile = File(...),
    prompt: str = Form("Describe the image in detail"),
    model_key: str = Form(""),
    max_new_tokens: int = Form(512),
    temperature: float = Form(0.7),
):
    """Analyze an image and generate text description using a transformers model."""
    # Validate image
    ext = os.path.splitext(image.filename or "input.png")[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image format '{ext}'. Allowed: png, jpg, jpeg, webp, bmp",
        )

    # Validate file size
    os.makedirs(settings.upload_dir, exist_ok=True)
    content = await image.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_size_mb} MB",
        )

    # Get runner
    runner = RunnerRegistry.get("transformers")
    if not runner:
        raise HTTPException(
            status_code=503,
            detail="Transformers runner not available",
        )

    # Load model if needed
    if not runner._loaded:
        if not model_key:
            raise HTTPException(
                status_code=422,
                detail="model_key is required when model is not loaded",
            )
        try:
            runner.load(model_key)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load model: {e}",
            )

    # Save uploaded image temporarily
    from PIL import Image
    import io

    image_path = os.path.join(settings.upload_dir, f"transformers_input{ext}")
    with open(image_path, "wb") as f:
        f.write(content)

    try:
        # Open image
        pil_image = Image.open(io.BytesIO(content))

        # Create generate params
        params = GenerateParams(
            prompt=prompt,
            video_frames=[pil_image],
            extra={
                "max_new_tokens": max_new_tokens,
                "temperature": temperature,
                "do_sample": temperature > 0,
            },
        )

        # Generate
        result = await runner.generate(params)

        # Read result file
        result_path = os.path.join(settings.results_dir, os.path.basename(result.url))
        with open(result_path, "r", encoding="utf-8") as f:
            result_text = f.read()

        return TransformersResponse(result=result_text)

    except Exception as e:
        logger.error(f"Transformers image-to-text failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Generation failed: {e}",
        )
    finally:
        # Cleanup temp file
        if os.path.exists(image_path):
            os.remove(image_path)


@router.post("/unload")
async def unload_transformers():
    """Unload the currently loaded transformers model."""
    runner = RunnerRegistry.get("transformers")
    if runner and runner._loaded:
        runner.unload()
        return {"status": "unloaded"}
    return {"status": "not_loaded"}
