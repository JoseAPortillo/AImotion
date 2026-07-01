import logging
from typing import Optional, Callable, Awaitable

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)


class APIRunner(BaseRunner):
    runner_key = "api"

    def __init__(self):
        self._model_key: Optional[str] = None

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> GenerateResult:
        raise NotImplementedError(
            f"API runner for '{params.model}' is not yet implemented. "
            f"Cloud API models need API key configuration and an API client."
        )

    def load(self, model_key: str) -> None:
        self._model_key = model_key
        logger.info("API runner: model %s selected", model_key)

    def unload(self) -> None:
        self._model_key = None
        logger.info("API runner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "num_inference_steps": {"has_default": True, "default": 50},
            "guidance_scale": {"has_default": True, "default": 7.0},
        }
