import os
import time
import logging
import threading
import asyncio
from typing import Optional, Callable, Awaitable

from app.config import settings
from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)

_QWEN_IMAGE_EDIT_REPO = "Qwen/Qwen-Image-Edit-2511"


class GGUFRunner(BaseRunner):
    runner_key = "gguf"

    def __init__(self):
        self._pipeline = None
        self._model_key: Optional[str] = None
        self._loaded = False

    def load(self, model_key: str) -> None:
        if self._loaded and self._model_key == model_key:
            return

        self.unload()

        try:
            import torch
            from diffusers import QwenImageEditPlusPipeline
        except ImportError:
            raise ImportError(
                "Required packages not installed. Run: "
                "pip install -U diffusers transformers accelerate"
            )

        logger.info("GGUF runner loading QwenImageEditPlusPipeline...")
        self._pipeline = QwenImageEditPlusPipeline.from_pretrained(
            _QWEN_IMAGE_EDIT_REPO,
            torch_dtype=torch.bfloat16,
        )
        self._pipeline.to("cuda")

        self._model_key = model_key
        self._loaded = True
        logger.info("GGUF runner pipeline loaded successfully")

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        if not self._loaded:
            self.load(params.model)

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError("Generation cancelled")

        steps = params.steps or 40
        seed = params.seed if params.seed > 0 else 42
        strength = params.strength or 0.75
        negative_prompt = params.negative_prompt or " "
        cfg = params.cfg or 2.5

        if progress_callback:
            await progress_callback(0, steps)

        loop = asyncio.get_running_loop()

        def diffusers_progress(step: int, timestep, latents):
            if progress_callback:
                try:
                    asyncio.run_coroutine_threadsafe(
                        progress_callback(step, steps), loop
                    )
                except RuntimeError:
                    pass

        logger.info(
            "GGUF runner generating: %s seed=%d strength=%.2f",
            params.prompt[:80], seed, strength,
        )

        def _generate():
            import torch

            image = None
            if params.video_frames:
                image = params.video_frames[0]

            result = self._pipeline(
                prompt=params.prompt,
                image=image,
                negative_prompt=negative_prompt,
                num_inference_steps=steps,
                guidance_scale=cfg,
                strength=strength,
                generator=torch.manual_seed(seed),
                callback_on_step_end=diffusers_progress,
            )
            return result.images[0]

        output_image = await loop.run_in_executor(None, _generate)

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError("Generation cancelled")

        if progress_callback:
            await progress_callback(steps, steps)

        os.makedirs(settings.results_dir, exist_ok=True)
        ts = int(time.time())
        out_path = os.path.join(settings.results_dir, f"gen_{ts}_{seed}.png")
        output_image.save(out_path)

        logger.info("GGUF runner saved image to %s", out_path)
        return GenerateResult(
            url=f"/results/{os.path.basename(out_path)}",
            media_type="image/png",
        )

    def unload(self) -> None:
        self._pipeline = None
        self._model_key = None
        self._loaded = False
        import gc
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        logger.info("GGUF runner unloaded")

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
