import os
import logging
import threading
import time
import asyncio
from typing import Optional, Callable, Awaitable

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult
from app.services.model_catalog import catalog
from app.config import settings

logger = logging.getLogger(__name__)

WAN_T5_REPO = "city96/umt5-xxl-encoder-gguf"
WAN_T5_FILENAME = "umt5-xxl-encoder-Q8_0.gguf"


class WanRunner(BaseRunner):
    runner_key = "wan2.2"

    def __init__(self):
        self._sd = None
        self._model_key: Optional[str] = None
        self._loaded = False

    def _resolve_model_paths(self, model_key: str) -> dict:
        from huggingface_hub import hf_hub_download, HfApi

        variant = catalog.get_variant(model_key)
        if variant is None:
            raise ValueError(f"Unknown model variant: {model_key}")

        hf_name = variant.hf_name
        if not hf_name:
            raise ValueError(f"Model variant '{model_key}' has no hf_name")

        dtype = (variant.dtype or "q4_k_m").upper()
        cache_dir = settings.model_cache_dir

        try:
            files = HfApi().list_repo_files(hf_name)
        except Exception as e:
            raise RuntimeError(
                f"Failed to list files for {hf_name}: {e}"
            )

        gguf_files = [f for f in files if f.endswith(".gguf") and not f.startswith(".")]
        if not gguf_files:
            raise ValueError(f"No GGUF files found in {hf_name}")

        diffusion_file = gguf_files[0]
        for f in gguf_files:
            if dtype in f.upper() and "vae" not in f.lower():
                diffusion_file = f
                break

        vae_file = None
        for f in files:
            if "vae" in f.lower() and f.endswith((".safetensors", ".gguf")):
                vae_file = f
                break

        logger.info("Resolving model paths for %s: diffusion=%s, vae=%s", hf_name, diffusion_file, vae_file)

        diffusion_path = hf_hub_download(
            repo_id=hf_name,
            filename=diffusion_file,
            cache_dir=cache_dir,
        )

        vae_path = None
        if vae_file:
            vae_path = hf_hub_download(
                repo_id=hf_name,
                filename=vae_file,
                cache_dir=cache_dir,
            )

        t5_path = hf_hub_download(
            repo_id=WAN_T5_REPO,
            filename=WAN_T5_FILENAME,
            cache_dir=cache_dir,
        )

        return {
            "diffusion_model_path": diffusion_path,
            "vae_path": vae_path,
            "t5xxl_path": t5_path,
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
                "Install the 'wan2.2-gguf' model to auto-install it, "
                "or run: pip install stable-diffusion-cpp-python"
            )

        logger.info("WanRunner loading model %s...", model_key)
        paths = self._resolve_model_paths(model_key)

        self._sd = StableDiffusion(
            diffusion_model_path=paths["diffusion_model_path"],
            vae_path=paths["vae_path"],
            t5xxl_path=paths["t5xxl_path"],
            keep_clip_on_cpu=True,
        )

        self._model_key = model_key
        self._loaded = True
        logger.info("WanRunner model %s loaded successfully", model_key)

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

        width = params.width or 480
        height = params.height or 832
        steps = params.steps or 50
        cfg = params.cfg or 6.0
        seed = params.seed if params.seed > 0 else -1
        num_frames = params.num_frames or 81
        fps = params.fps or 16
        negative_prompt = params.negative_prompt or ""

        loop = asyncio.get_running_loop()

        def sd_progress(step: int, total: int, _time: float):
            if progress_callback:
                try:
                    asyncio.run_coroutine_threadsafe(
                        progress_callback(step, total), loop
                    )
                except RuntimeError:
                    pass

        if progress_callback:
            await progress_callback(0, steps)

        logger.info(
            "WanRunner generating: %s %dx%d %d frames %d steps cfg=%.1f seed=%d",
            params.prompt[:80], width, height, num_frames, steps, cfg, seed,
        )

        def _generate():
            return self._sd.generate_video(
                prompt=params.prompt,
                negative_prompt=negative_prompt,
                height=height,
                width=width,
                cfg_scale=cfg,
                sample_method="euler",
                sample_steps=steps,
                flow_shift=3.0,
                video_frames=num_frames,
                seed=seed,
                progress_callback=sd_progress,
            )

        output = await loop.run_in_executor(None, _generate)

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError("Generation cancelled")

        if not output:
            raise RuntimeError("WanRunner generated no output frames")

        if progress_callback:
            await progress_callback(steps, steps)

        os.makedirs(settings.results_dir, exist_ok=True)
        ts = int(time.time())
        out_path = os.path.join(settings.results_dir, f"gen_{ts}_{seed}.mp4")

        _save_frames_to_video(output, out_path, fps)

        logger.info("WanRunner saved video to %s", out_path)
        return GenerateResult(
            url=f"/results/{os.path.basename(out_path)}",
            media_type="video/mp4",
        )

    def unload(self) -> None:
        self._sd = None
        self._model_key = None
        self._loaded = False
        import gc
        gc.collect()
        logger.info("WanRunner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "num_inference_steps": {"has_default": True, "default": 50},
            "guidance_scale": {"has_default": True, "default": 5.0},
            "width": {"has_default": True, "default": 832},
            "height": {"has_default": True, "default": 480},
            "seed": {"has_default": True, "default": -1},
            "video_frames": {"has_default": True, "default": 81},
            "fps": {"has_default": True, "default": 16},
        }


def _save_frames_to_video(frames, output_path: str, fps: int = 16):
    import subprocess
    import numpy as np
    from PIL import Image

    if not frames:
        raise ValueError("No frames to save")

    width, height = frames[0].size
    raw_bytes = b"".join(
        np.array(frame.convert("RGB"), dtype=np.uint8).tobytes()
        for frame in frames
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "18",
        output_path,
    ]

    result = subprocess.run(cmd, input=raw_bytes, capture_output=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (rc={result.returncode}): "
            f"{result.stderr.decode(errors='replace')[:500]}"
        )
