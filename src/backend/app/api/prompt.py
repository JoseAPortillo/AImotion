import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ollama import AsyncClient
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prompt", tags=["prompt"])

LOCAL_MODEL = "hermes3:latest"
FALLBACK_MODEL = "llama3.1:8b"

VLM_MODELS = ["llava", "llava:13b", "qwen2-vl", "minicpm-v"]

SYSTEM_PROMPT = """You are a prompt engineer specialized in video generation AI. 
Your task is to improve user prompts to get better results from video generation models.

Rules:
- Keep the original intent and subject
- Add details about: camera movement, lighting, atmosphere, style, quality
- Use descriptive, cinematic language
- Keep it concise (2-3 sentences max)
- Output ONLY the improved prompt, nothing else

Examples:
Input: "a cat walking"
Output: "A cinematic shot of a majestic cat walking gracefully through a sunlit garden, soft golden hour lighting, shallow depth of field, smooth tracking shot, professional cinematography, 4K quality"

Input: "car driving fast"
Output: "High-speed chase scene with a sleek sports car racing through city streets at night, neon lights reflecting off the wet asphalt, dynamic camera angles, motion blur, dramatic lighting, action movie cinematography"
"""


class ImprovePromptRequest(BaseModel):
    prompt: str


class ImprovePromptResponse(BaseModel):
    improved_prompt: str


async def _call_ollama(model: str, prompt: str) -> str:
    client = AsyncClient()
    response = await client.chat(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Input: \"{prompt}\"\nOutput:"},
        ],
        options={"temperature": 0.7, "num_predict": 150},
    )
    return response["message"]["content"].strip()


@router.post("/improve", response_model=ImprovePromptResponse)
async def improve_prompt(request: ImprovePromptRequest):
    models_available = [LOCAL_MODEL, FALLBACK_MODEL]
    last_error: str | None = None

    for model in models_available:
        try:
            improved = await _call_ollama(model, request.prompt)
            return ImprovePromptResponse(improved_prompt=improved)
        except Exception as e:
            logger.warning(f"Ollama model {model} failed: {e}")
            last_error = str(e)

    raise HTTPException(
        status_code=502,
        detail=f"All local models failed. Last error: {last_error}",
    )
