import asyncio
import os
import logging
import threading
from typing import Optional, Callable, Awaitable

import httpx

from app.services.api_providers.base import BaseApiProvider, ProviderError
from app.services.credential_manager import get_key
from app.services.runners.base import GenerateParams, GenerateResult

logger = logging.getLogger(__name__)

POLL_INTERVAL = 5.0
MAX_POLL_TIME = 600.0


class RunwayProvider(BaseApiProvider):
    service_name = "runway"
    base_url = "https://api.dev.runwayml.com"

    def _auth_headers(self) -> dict:
        key = get_key(self.service_name)
        if not key:
            raise ProviderError(f"No API key configured for '{self.service_name}'", status_code=401)
        return {
            "Authorization": f"Bearer {key}",
            "X-Runway-Version": "2024-11-06",
            "Content-Type": "application/json",
        }

    async def _upload_video(self, client: httpx.AsyncClient, video_path: str) -> str:
        filename = os.path.basename(video_path)
        resp = await client.post(
            f"{self.base_url}/v1/uploads",
            json={"filename": filename, "type": "ephemeral"},
            headers=self._auth_headers(),
        )
        if resp.status_code == 429:
            raise ProviderError("Runway upload rate limit exceeded")
        if not resp.is_success:
            detail = resp.text[:200]
            raise ProviderError(f"Runway upload error ({resp.status_code}): {detail}")

        data = resp.json()
        upload_url: str = data.get("uploadUrl", "")
        fields: dict = data.get("fields", {})
        runway_uri: str = data.get("runwayUri", "")

        if not upload_url or not runway_uri:
            raise ProviderError("Runway upload response missing uploadUrl or runwayUri")

        with open(video_path, "rb") as f:
            upload_resp = await client.post(upload_url, data=fields, files={"file": (filename, f, "video/mp4")})
        if not upload_resp.is_success:
            detail = upload_resp.text[:200]
            raise ProviderError(f"Runway file upload error ({upload_resp.status_code}): {detail}")

        logger.info("Runway upload complete: %s", runway_uri)
        return runway_uri

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        if progress_callback:
            await progress_callback(0, 5)

        api_model = params.model.removeprefix("runway:")

        video_path = params.extra.get("video_path")
        if not video_path or not os.path.exists(video_path):
            raise ProviderError("Runway video-to-video requires an input video")

        async with httpx.AsyncClient(timeout=60) as client:
            if progress_callback:
                await progress_callback(1, 5)

            runway_uri = await self._upload_video(client, video_path)

            body: dict = {
                "model": api_model,
                "videoUri": runway_uri,
            }

            if params.prompt:
                body["promptText"] = params.prompt

            if params.seed > 0:
                body["seed"] = params.seed

            target_ratio = params.extra.get("targetAspectRatio")
            if target_ratio:
                body["targetAspectRatio"] = target_ratio

            if progress_callback:
                await progress_callback(2, 5)

            data = await client.post(
                f"{self.base_url}/v1/video_to_video",
                json=body,
                headers=self._auth_headers(),
            )
            if data.status_code == 429:
                raise ProviderError("Runway API rate limit exceeded")
            if not data.is_success:
                detail = data.text[:200]
                raise ProviderError(f"Runway API error ({data.status_code}): {detail}")

            task_data = data.json()
            task_id: str = task_data.get("id", "")

            if not task_id:
                raise ProviderError("Runway did not return a task id")

            if progress_callback:
                await progress_callback(3, 5)

            elapsed = 0.0
            while elapsed < MAX_POLL_TIME:
                if cancel_event and cancel_event.is_set():
                    raise asyncio.CancelledError("Generation cancelled by user")

                get_headers = self._auth_headers()
                get_headers.pop("Content-Type", None)
                status_resp = await client.get(
                    f"{self.base_url}/v1/tasks/{task_id}",
                    headers=get_headers,
                )
                status_data = status_resp.json()
                status = (status_data.get("status") or "").upper()

                if progress_callback:
                    pct = status_data.get("progress", 0)
                    if isinstance(pct, (int, float)) and pct > 0:
                        await progress_callback(int(pct * 5 / 100), 5)

                if status == "SUCCEEDED":
                    output = status_data.get("output", [])
                    video_url = output[0] if output else ""
                    if not video_url:
                        raise ProviderError("Runway returned succeeded status but no video URL")
                    usage = status_data.get("usage")
                    if isinstance(usage, dict):
                        from app.services.credit_manager import credit_manager
                        credit_manager.record_usage("runway", api_model, usage.get("credits", 0), task_id)
                    logger.info("Runway generation complete: %s", video_url)
                    return GenerateResult(url=video_url, media_type="video")

                if status in ("FAILED", "CANCELED"):
                    failure = status_data.get("failure") or status_data.get("error") or "unknown error"
                    raise ProviderError(f"Runway generation {status}: {failure}")

                await asyncio.sleep(POLL_INTERVAL)
                elapsed += POLL_INTERVAL

            raise ProviderError("Runway generation timed out")

    async def get_balance(self) -> dict | None:
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                data = await client.get(
                    f"{self.base_url}/v1/organization",
                    headers=self._auth_headers(),
                )
                if not data.is_success:
                    logger.warning("Runway balance fetch failed: %s", data.status_code)
                    return None
                org = data.json()
                return {
                    "provider": "runway",
                    "balance": org.get("creditBalance"),
                    "tier": org.get("tier"),
                    "daily_generations": org.get("dailyGenerations"),
                    "monthly_spend": org.get("monthlySpend"),
                    "monthly_spend_cap": org.get("monthlySpendCap"),
                }
            except Exception as e:
                logger.warning("Runway balance fetch error: %s", e)
                return None

    async def get_usage_history(
        self, start_date: str | None = None, end_date: str | None = None
    ) -> dict | None:
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                body: dict = {}
                if start_date:
                    body["start_date"] = start_date
                if end_date:
                    body["end_date"] = end_date

                headers = self._auth_headers()
                resp = await client.post(
                    f"{self.base_url}/v1/organization/usage",
                    json=body,
                    headers=headers,
                )
                if not resp.is_success:
                    logger.warning("Runway usage fetch failed: %s", resp.status_code)
                    return None
                return resp.json()
            except Exception as e:
                logger.warning("Runway usage fetch error: %s", e)
                return None

    def load(self, model_key: str) -> None:
        logger.info("Runway provider ready for model: %s", model_key)

    def unload(self) -> None:
        logger.info("Runway provider unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
        }
