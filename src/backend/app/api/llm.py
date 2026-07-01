import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ollama import AsyncClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm", tags=["llm"])

DEFAULT_MODEL = "llama3.1:8b"
FALLBACK_MODELS = ["hermes3:latest", "qwen2.5-coder:14b", "qwen3.6:latest"]


class LLMGenerateRequest(BaseModel):
    prompt: str
    system_prompt: str = ""
    model: str = ""
    temperature: float = 0.7
    max_tokens: int = 2048
    top_p: float = 0.9
    top_k: int = 40
    seed: int = 0


class LLMGenerateResponse(BaseModel):
    result: str


async def _call_ollama(model: str, req: LLMGenerateRequest) -> str:
    client = AsyncClient()
    messages = []
    if req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    messages.append({"role": "user", "content": req.prompt})

    response = await client.chat(
        model=model,
        messages=messages,
        options={
            "temperature": req.temperature,
            "num_predict": req.max_tokens,
            "top_p": req.top_p,
            "top_k": req.top_k,
            "seed": req.seed if req.seed > 0 else None,
        },
    )
    return response["message"]["content"].strip()


@router.post("/generate", response_model=LLMGenerateResponse)
async def llm_generate(req: LLMGenerateRequest):
    if req.model:
        models_to_try = [req.model]
    else:
        models_to_try = [DEFAULT_MODEL] + FALLBACK_MODELS

    last_error: str | None = None
    for model in models_to_try:
        try:
            result = await _call_ollama(model, req)
            return LLMGenerateResponse(result=result)
        except Exception as e:
            logger.warning(f"LLM model {model} failed: {e}")
            last_error = str(e)

    raise HTTPException(
        status_code=502,
        detail=f"All models failed. Last error: {last_error}",
    )
