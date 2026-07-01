import os
import base64
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from ollama import AsyncClient
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vlm", tags=["vlm"])

VLM_MODELS = ["llava", "qwen2-vl", "minicpm-v"]


class VLMResponse(BaseModel):
    result: str


async def _call_vlm(model: str, prompt: str, image_b64: str) -> str:
    client = AsyncClient()
    response = await client.chat(
        model=model,
        messages=[
            {
                "role": "user",
                "content": prompt,
                "images": [image_b64],
            },
        ],
        options={"temperature": 0.3, "num_predict": 512},
    )
    return response["message"]["content"].strip()


@router.post("/analyze", response_model=VLMResponse)
async def analyze_vlm(
    image: UploadFile = File(...),
    prompt: str = Form("Describe this image in detail"),
):
    ext = os.path.splitext(image.filename or "input.png")[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image format '{ext}'. Allowed: png, jpg, jpeg, webp, bmp",
        )

    os.makedirs(settings.upload_dir, exist_ok=True)
    content = await image.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_size_mb} MB",
        )

    image_b64 = base64.b64encode(content).decode("utf-8")

    last_error: str | None = None
    for model in VLM_MODELS:
        try:
            result = await _call_vlm(model, prompt, image_b64)
            return VLMResponse(result=result)
        except Exception as e:
            logger.warning(f"VLM model {model} failed: {e}")
            last_error = str(e)

    raise HTTPException(
        status_code=502,
        detail=f"All VLM models failed. Last error: {last_error}",
    )
