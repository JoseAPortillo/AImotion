import asyncio
import logging
import threading
from typing import Optional, Callable, Awaitable

import httpx

from app.services.api_providers.base import BaseApiProvider, ProviderError
from app.services.runners.base import GenerateParams, GenerateResult

logger = logging.getLogger(__name__)

POLL_INTERVAL = 3.0
MAX_POLL_TIME = 600.0

TASK_POLL_INTERVAL = 5.0
TASK_MAX_WAIT = 600.0


class KlingProvider(BaseApiProvider):
    service_name = "kling"
    base_url = "https://api.klingapi.com"

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        if progress_callback:
            await progress_callback(0, 5)

        body: dict = {
            "model": "kling-v2.6-pro",
            "prompt": params.prompt,
            "duration": 5,
            "aspect_ratio": "16:9",
            "mode": "professional",
        }

        if params.negative_prompt:
            body["negative_prompt"] = params.negative_prompt
        if params.width and params.height:
            ratio = params.width / params.height
            if abs(ratio - 16 / 9) < 0.05:
                body["aspect_ratio"] = "16:9"
            elif abs(ratio - 9 / 16) < 0.05:
                body["aspect_ratio"] = "9:16"
            elif abs(ratio - 1.0) < 0.05:
                body["aspect_ratio"] = "1:1"

        if progress_callback:
            await progress_callback(1, 5)

        async with httpx.AsyncClient(timeout=30) as client:
            data = await self._request(client, "POST", "/v1/videos/text2video", body)
            task_id: str = data.get("task_id") or data.get("data", {}).get("task_id", "")

            if not task_id:
                raise ProviderError("Kling did not return a task_id")

            if progress_callback:
                await progress_callback(2, 5)

            elapsed = 0.0
            while elapsed < TASK_MAX_WAIT:
                if cancel_event and cancel_event.is_set():
                    raise asyncio.CancelledError("Generation cancelled by user")

                status_data = await self._request(client, "GET", f"/v1/videos/{task_id}")
                result = status_data.get("data") or status_data
                status = (result.get("status") or "").lower()

                if progress_callback:
                    pct = result.get("progress", 0)
                    if isinstance(pct, (int, float)) and pct > 0:
                        await progress_callback(int(pct * 5 / 100), 5)

                if status == "completed":
                    video_url = (
                        result.get("video_url")
                        or result.get("url")
                        or (result.get("response") or [{}])[0].get("url")
                        or ""
                    )
                    if not video_url:
                        raise ProviderError("Kling returned completed status but no video URL")
                    logger.info("Kling generation complete: %s", video_url)
                    return GenerateResult(url=video_url, media_type="video")

                if status in ("failed", "error"):
                    err = result.get("message") or result.get("error") or "unknown error"
                    raise ProviderError(f"Kling generation failed: {err}")

                await asyncio.sleep(TASK_POLL_INTERVAL)
                elapsed += TASK_POLL_INTERVAL

            raise ProviderError("Kling generation timed out")

    def load(self, model_key: str) -> None:
        logger.info("Kling provider ready for model: %s", model_key)

    def unload(self) -> None:
        logger.info("Kling provider unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "negative_prompt": {"has_default": True, "default": ""},
            "num_inference_steps": {"has_default": True, "default": 50},
            "guidance_scale": {"has_default": True, "default": 7.0},
        }
