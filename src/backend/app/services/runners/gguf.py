import logging
from typing import Optional, Callable, Awaitable

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)

_VIABLE = False
_REASON = (
    "GGUFRunner is not viable: diffusion transformer models in GGUF format "
    "only work in ComfyUI (city96/ComfyUI-GGUF). No standalone Python loader "
    "exists. The original Qwen-Image-Edit-2511 model needs ~40GB VRAM in bf16, "
    "exceeding available GPU memory (10GB)."
)


class GGUFRunner(BaseRunner):
    runner_key = "gguf"

    def load(self, model_key: str) -> None:
        raise RuntimeError(_REASON)

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event=None,
    ) -> GenerateResult:
        raise RuntimeError(_REASON)

    def unload(self) -> None:
        pass

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "negative_prompt": {"has_default": True, "default": ""},
            "num_inference_steps": {"has_default": True, "default": 40},
            "guidance_scale": {"has_default": True, "default": 2.5},
            "strength": {"has_default": True, "default": 0.75},
            "width": {"has_default": True, "default": 1024},
            "height": {"has_default": True, "default": 1024},
            "seed": {"has_default": True, "default": -1},
        }
