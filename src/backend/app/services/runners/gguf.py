import logging
from typing import Optional, Callable, Awaitable

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)


class GGUFRunner(BaseRunner):
    runner_key = "gguf"

    def __init__(self):
        self._model_key: Optional[str] = None
        self._loaded = False

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> GenerateResult:
        raise NotImplementedError(
            f"GGUF runner does not support generation yet. "
            f"Model '{params.model}' ({self.runner_key}) was loaded but no GGUF inference pipeline "
            f"is available. This runner is a placeholder for GGUF-based video generation."
        )

    def load(self, model_key: str) -> None:
        self._model_key = model_key
        self._loaded = True
        logger.info("GGUF runner: model %s marked as loaded", model_key)

    def unload(self) -> None:
        self._model_key = None
        self._loaded = False
        logger.info("GGUF runner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "num_inference_steps": {"has_default": True, "default": 50},
            "guidance_scale": {"has_default": True, "default": 5.0},
            "image": {"has_default": False, "default": None},
            "strength": {"has_default": True, "default": 0.8},
        }
