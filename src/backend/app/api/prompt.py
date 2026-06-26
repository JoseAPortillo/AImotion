import asyncio
import logging
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prompt", tags=["prompt"])

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent"
MAX_RETRIES = 3
BASE_BACKOFF = 2.0


class ImprovePromptRequest(BaseModel):
    prompt: str


class ImprovePromptResponse(BaseModel):
    improved_prompt: str


@router.post("/improve", response_model=ImprovePromptResponse)
async def improve_prompt(request: ImprovePromptRequest):
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY not configured. Set it in .env file.",
        )

    system_prompt = """You are a prompt engineer specialized in video generation AI. 
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

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{system_prompt}\n\nInput: \"{request.prompt}\"\nOutput:"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 150,
        },
    }

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    GEMINI_API_URL,
                    params={"key": settings.gemini_api_key},
                    json=payload,
                )
                if response.status_code != 200:
                    logger.error(f"Gemini API {response.status_code}: {response.text}")
                    if response.status_code == 429 and attempt < MAX_RETRIES - 1:
                        raise httpx.HTTPStatusError(
                            f"429 Too Many Requests", request=response.request, response=response
                        )
                    response.raise_for_status()
                data = response.json()

                improved = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                return ImprovePromptResponse(improved_prompt=improved)

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < MAX_RETRIES - 1:
                wait = BASE_BACKOFF ** (attempt + 1)
                logger.warning(f"Gemini API 429, retrying in {wait:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(wait)
                continue
            last_error = e
            break
        except httpx.HTTPError as e:
            last_error = e
            break
        except (KeyError, IndexError) as e:
            logger.error(f"Unexpected response format: {e}")
            raise HTTPException(status_code=500, detail="Failed to parse AI response")

    logger.error(f"Gemini API error after {MAX_RETRIES} attempts: {last_error}")
    raise HTTPException(status_code=502, detail=f"AI service error: {str(last_error)}")
