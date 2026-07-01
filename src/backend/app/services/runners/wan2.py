import os
import asyncio
import logging
from typing import Optional, Callable, Awaitable

from PIL import Image

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult
from app.services.model_registry import hf_cache_path

logger = logging.getLogger(__name__)

T5_REPO = "city96/umt5-xxl-encoder-gguf"
T5_FILENAME = "umt5-xxl-encoder-Q8_0.gguf"
VAE_REPO = "Comfy-Org/Wan_2.2_ComfyUI_Repackaged"
VAE_FILENAME = "split_files/vae/wan2.2_vae.safetensors"
DEFAULT_VIDEO_FPS = 8


class Wan2Runner(BaseRunner):
    runner_key = "wan2.2"

    def __init__(self):
        self._model_key: Optional[str] = None
        self._gguf_path: Optional[str] = None
        self._sd = None

    def load(self, model_key: str) -> None:
        if self._model_key == model_key and self._gguf_path is not None:
            return

        self._model_key = model_key

        from app.services.model_catalog import catalog
        variant = catalog.get_variant(model_key)
        if not variant:
            raise ValueError(f"Unknown model key '{model_key}'")
        hf_name = variant.hf_name
        if not hf_name:
            raise ValueError(f"Variant '{model_key}' has no HuggingFace repo (hf_name)")

        self._gguf_path = self._find_or_download_gguf(hf_name)
        logger.info("Wan2Runner loaded: %s (%s) -> %s", model_key, hf_name, self._gguf_path)

    def unload(self) -> None:
        self._sd = None
        self._model_key = None
        self._gguf_path = None
        logger.info("Wan2Runner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "negative_prompt": {"has_default": True, "default": ""},
            "num_inference_steps": {"has_default": True, "default": 50},
            "guidance_scale": {"has_default": True, "default": 5.0},
            "image": {"has_default": False, "default": None},
            "strength": {"has_default": True, "default": 0.8},
            "width": {"has_default": True, "default": 480},
            "height": {"has_default": True, "default": 832},
            "num_frames": {"has_default": True, "default": 33},
        }

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> GenerateResult:
        self.load(params.model)
        self._ensure_sd()

        kwargs: dict = {
            "prompt": params.prompt,
            "negative_prompt": params.negative_prompt,
            "width": params.width or 480,
            "height": params.height or 832,
            "cfg_scale": params.cfg,
            "sample_steps": params.steps,
            "sample_method": "euler",
            "video_frames": params.num_frames or 33,
        }

        if params.seed:
            kwargs["seed"] = params.seed

        if params.video_frames and len(params.video_frames) > 0:
            kwargs["init_image"] = params.video_frames[0]
            kwargs["strength"] = params.strength

        loop = asyncio.get_running_loop()
        frames = await loop.run_in_executor(
            None,
            lambda: self._sd.generate_video(**kwargs),
        )

        return self._save_video(frames, params)

    def _find_or_download_gguf(self, hf_name: str) -> str:
        cache_dir = hf_cache_path()
        safe = hf_name.replace("/", "--")
        prefix = f"models--{safe}"
        if os.path.isdir(cache_dir):
            for entry in os.listdir(cache_dir):
                if entry.startswith(prefix):
                    model_dir = os.path.join(cache_dir, entry)
                    for root, _, files in os.walk(model_dir):
                        for f in files:
                            if f.endswith(".gguf"):
                                return os.path.join(root, f)

        from huggingface_hub import hf_hub_download, HfApi
        logger.info("Searching for GGUF files in %s...", hf_name)
        api = HfApi()
        repo_files = api.list_repo_files(repo_id=hf_name)
        gguf_files = [f for f in repo_files if f.endswith(".gguf")]
        if not gguf_files:
            raise FileNotFoundError(f"No GGUF files found in repo '{hf_name}'")

        filename = gguf_files[0]
        logger.info("Downloading %s from %s...", filename, hf_name)
        return hf_hub_download(
            repo_id=hf_name,
            filename=filename,
            resume_download=True,
        )

    def _ensure_aux_file(self, repo_id: str, filename: str) -> str:
        from huggingface_hub import hf_hub_download
        logger.info("Downloading auxiliary file %s from %s...", filename, repo_id)
        return hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            resume_download=True,
        )

    def _ensure_sd(self):
        if self._sd is not None:
            return
        try:
            from stable_diffusion_cpp import StableDiffusion
        except ImportError:
            raise ImportError(
                "stable-diffusion-cpp-python is not installed. "
                "Install it with:\n"
                "  pip install stable-diffusion-cpp-python\n"
                "For CUDA: CMAKE_ARGS='-DSD_CUDA=ON' pip install stable-diffusion-cpp-python"
            )
        t5_path = self._ensure_aux_file(T5_REPO, T5_FILENAME)
        vae_path = self._ensure_aux_file(VAE_REPO, VAE_FILENAME)
        self._sd = StableDiffusion(
            diffusion_model_path=self._gguf_path,
            t5xxl_path=t5_path,
            vae_path=vae_path,
            keep_clip_on_cpu=True,
        )
        logger.info("Wan2Runner StableDiffusion initialized")

    def _save_video(self, frames: list[Image.Image], params: GenerateParams) -> GenerateResult:
        import time
        from imageio import get_writer
        from app.config import settings
        output_dir = settings.results_dir
        os.makedirs(output_dir, exist_ok=True)
        ts = int(time.time())
        seed = params.seed or 0
        out_path = os.path.join(output_dir, f"wan_{ts}_{seed}.mp4")
        with get_writer(out_path, fps=DEFAULT_VIDEO_FPS) as writer:
            for frame in frames:
                writer.append_data(frame)
        logger.info("Wan2Runner saved video to %s", out_path)
        return GenerateResult(
            url=f"/results/{os.path.basename(out_path)}",
            media_type="video/mp4",
        )
