import os
import time
import logging
import threading
import asyncio
from typing import Optional, Callable, Awaitable

from app.config import settings
from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult
from app.services.model_registry import find_installed

logger = logging.getLogger(__name__)

_VAE_REPO = "Comfy-Org/Qwen-Image_ComfyUI"
_VAE_FILE = "split_files/vae/qwen_image_vae.safetensors"
_LLM_REPO = "Comfy-Org/Qwen-Image_ComfyUI"
_LLM_FILE = "split_files/text_encoders/qwen_2.5_vl_7b.safetensors"


class GGUFRunner(BaseRunner):
    runner_key = "gguf"

    def __init__(self):
        self._sd: Optional[any] = None
        self._model_key: Optional[str] = None
        self._loaded = False

    def _resolve_paths(self, model_key: str) -> dict:
        inst = find_installed(model_key)
        if not inst or not inst.checkpoint_file:
            raise ValueError(
                f"GGUF model '{model_key}' has no checkpoint file. "
                "Reinstall the model to download the GGUF weights."
            )

        from huggingface_hub import hf_hub_download

        diffusion_path = hf_hub_download(
            repo_id=inst.hf_name,
            filename=inst.checkpoint_file,
            cache_dir=settings.model_cache_dir,
        )

        vae_path = hf_hub_download(
            repo_id=_VAE_REPO,
            filename=_VAE_FILE,
            cache_dir=settings.model_cache_dir,
        )

        llm_path = hf_hub_download(
            repo_id=_LLM_REPO,
            filename=_LLM_FILE,
            cache_dir=settings.model_cache_dir,
        )

        return {
            "diffusion_model_path": diffusion_path,
            "vae_path": vae_path,
            "llm_path": llm_path,
        }

    def load(self, model_key: str) -> None:
        if self._loaded and self._model_key == model_key:
            return

        self.unload()

        try:
            from stable_diffusion_cpp import StableDiffusion
        except ImportError:
            raise ImportError(
                "stable-diffusion-cpp-python is not installed. "
                "Install it to use GGUF models: pip install stable-diffusion-cpp-python"
            )

        logger.info("GGUF runner loading model %s...", model_key)
        paths = self._resolve_paths(model_key)

        self._sd = StableDiffusion(
            diffusion_model_path=paths["diffusion_model_path"],
            vae_path=paths["vae_path"],
            llm_path=paths["llm_path"],
            qwen_image_zero_cond_t=True,
            flash_attn=True,
        )

        self._model_key = model_key
        self._loaded = True
        logger.info("GGUF runner model %s loaded successfully", model_key)

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

        width = params.width or 1024
        height = params.height or 1024
        steps = params.steps or 40
        cfg = params.cfg or 2.5
        seed = params.seed if params.seed > 0 else -1
        strength = params.strength or 0.75
        negative_prompt = params.negative_prompt or ""
        flow_shift = params.extra.get("flow_shift", 3.0)

        if progress_callback:
            await progress_callback(0, steps)

        loop = asyncio.get_running_loop()

        def sd_progress(step: int, total: int, _time: float):
            if progress_callback:
                try:
                    asyncio.run_coroutine_threadsafe(
                        progress_callback(step, total), loop
                    )
                except RuntimeError:
                    pass

        logger.info(
            "GGUF runner generating: %s %dx%d %d steps cfg=%.1f seed=%d strength=%.2f",
            params.prompt[:80], width, height, steps, cfg, seed, strength,
        )

        def _generate():
            ref_images = params.video_frames
            return self._sd.generate_image(
                prompt=params.prompt,
                negative_prompt=negative_prompt,
                ref_images=ref_images,
                width=width,
                height=height,
                cfg_scale=cfg,
                flow_shift=flow_shift,
                strength=strength,
                sample_steps=steps,
                sample_method="euler",
                seed=seed,
                progress_callback=sd_progress,
            )

        outputs = await loop.run_in_executor(None, _generate)

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError("Generation cancelled")

        if not outputs:
            raise RuntimeError("GGUF runner generated no output image")

        if progress_callback:
            await progress_callback(steps, steps)

        os.makedirs(settings.results_dir, exist_ok=True)
        ts = int(time.time())
        out_path = os.path.join(settings.results_dir, f"gen_{ts}_{seed}.png")
        outputs[0].save(out_path)

        logger.info("GGUF runner saved image to %s", out_path)
        return GenerateResult(
            url=f"/results/{os.path.basename(out_path)}",
            media_type="image/png",
        )

    def unload(self) -> None:
        self._sd = None
        self._model_key = None
        self._loaded = False
        import gc
        gc.collect()
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
