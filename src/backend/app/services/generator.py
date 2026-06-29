import logging
import os
import time
from typing import Optional, Callable, Awaitable
from PIL import Image

from app.config import settings
from app.services.model_registry import find_installed, is_model_cached

logger = logging.getLogger(__name__)

SUPPORTED_MODELS = {
    "ltx-video": {
        "model_name": "Lightricks/LTX-Video",
        "pipeline_class": "LTXPipeline",
        "dtype": "bfloat16",
        "defaults": {
            "width": 704, "height": 512,
            "steps": 50, "cfg": 3.0,
            "num_frames": 97, "fps": 24,
            "max_seq": 256,
        },
        "needs_token": True,
        "schedulers": {
            "flow_match_euler": "FlowMatchEulerDiscreteScheduler",
            "ltx_euler_ancestral_rf": "LTXEulerAncestralRFScheduler",
        },
        "default_scheduler": "flow_match_euler",
    },
    "cogvideox": {
        "model_name": "THUDM/CogVideoX-2b",
        "pipeline_class": "CogVideoXPipeline",
        "dtype": "bfloat16",
        "defaults": {
            "width": 720, "height": 480,
            "steps": 50, "cfg": 6.0,
            "num_frames": 49, "fps": 8,
            "max_seq": 226,
        },
        "needs_token": False,
        "schedulers": {
            "cogvideox_ddim": "CogVideoXDDIMScheduler",
            "cogvideox_dpm": "CogVideoXDPMScheduler",
        },
        "default_scheduler": "cogvideox_ddim",
    },
    "cogvideox-2b": {
        "model_name": "THUDM/CogVideoX-2b",
        "pipeline_class": "CogVideoXPipeline",
        "dtype": "float16",
        "defaults": {
            "width": 720, "height": 480,
            "steps": 50, "cfg": 6.0,
            "num_frames": 49, "fps": 8,
            "max_seq": 226,
        },
        "needs_token": False,
        "schedulers": {
            "cogvideox_ddim": "CogVideoXDDIMScheduler",
            "cogvideox_dpm": "CogVideoXDPMScheduler",
        },
        "default_scheduler": "cogvideox_ddim",
    },
    "cogvideox-5b": {
        "model_name": "THUDM/CogVideoX-5b",
        "pipeline_class": "CogVideoXPipeline",
        "dtype": "float16",
        "defaults": {
            "width": 720, "height": 480,
            "steps": 50, "cfg": 6.0,
            "num_frames": 49, "fps": 8,
            "max_seq": 226,
        },
        "needs_token": False,
        "schedulers": {
            "cogvideox_ddim": "CogVideoXDDIMScheduler",
            "cogvideox_dpm": "CogVideoXDPMScheduler",
        },
        "default_scheduler": "cogvideox_ddim",
    },
}

SCHEDULER_NAMES: dict[str, str] = {}
for _cfg in SUPPORTED_MODELS.values():
    for key, cls_name in _cfg.get("schedulers", {}).items():
        SCHEDULER_NAMES.setdefault(cls_name, key)
        SCHEDULER_NAMES[key] = cls_name


def get_model_config(key: str) -> dict | None:
    cfg = SUPPORTED_MODELS.get(key)
    if cfg:
        return cfg
    inst = find_installed(key)
    if inst and is_model_cached(inst.hf_name):
        return {
            "model_name": inst.hf_name,
            "pipeline_class": inst.pipeline_class,
            "dtype": inst.dtype,
            "defaults": inst.defaults,
            "needs_token": inst.needs_token,
            "schedulers": inst.schedulers,
            "default_scheduler": inst.default_scheduler,
        }
    return None


def extract_frames(path: str, max_frames: int = 49) -> list[Image.Image]:
    import imageio
    reader = imageio.get_reader(path)
    all_frames = [Image.fromarray(f) for f in reader]
    reader.close()
    total = len(all_frames)
    if total <= max_frames:
        logger.info(f"Extracted {len(all_frames)} frames from {path}")
        return all_frames
    step = total / max_frames
    frames = [all_frames[int(i * step)] for i in range(max_frames)]
    logger.info(f"Extracted {len(frames)} frames from {path} (total source: {total})")
    return frames


class VideoGenerator:
    def __init__(self):
        self._pipe = None
        self._current_model_key: str | None = None
        self._v2v_pipe = None
        self._current_v2v_model_key: str | None = None
        self.device = settings.device

    def _load_pipe(self, model_key: str):
        import torch
        cfg = get_model_config(model_key)
        if cfg is None:
            raise ValueError(f"Unsupported model: {model_key}")

        model_name = cfg["model_name"]
        tok = settings.hf_token if cfg["needs_token"] else None
        if tok:
            os.environ["HF_TOKEN"] = tok
        dtype_name = cfg.get("dtype", settings.dtype)
        dtype = torch.bfloat16 if dtype_name == "bfloat16" else torch.float16
        cls_name = cfg["pipeline_class"]
        if cls_name == "LTXPipeline":
            from diffusers import LTXPipeline
            pipe = LTXPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        elif cls_name == "CogVideoXPipeline":
            from diffusers import CogVideoXPipeline
            pipe = CogVideoXPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        elif cls_name == "CogVideoXImageToVideoPipeline":
            from diffusers import CogVideoXVideoToVideoPipeline
            pipe = CogVideoXVideoToVideoPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        elif cls_name == "StableDiffusionXLPipeline":
            from diffusers import StableDiffusionXLPipeline
            pipe = StableDiffusionXLPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        else:
            raise ValueError(f"Unsupported pipeline '{cls_name}' for model '{model_name}'. This model cannot be used for video generation.")
        pipe.enable_model_cpu_offload()
        if hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()
        self._log_vram()
        logger.info(f"Pipeline loaded: {cls_name}({model_name})")
        return pipe

    def _ensure_pipe(self, model_key: str):
        if self._pipe is not None and self._current_model_key == model_key:
            return
        self.unload()
        self._pipe = self._load_pipe(model_key)
        self._current_model_key = model_key

    def _ensure_v2v_pipe(self, model_key: str):
        if self._v2v_pipe is not None and self._current_v2v_model_key == model_key:
            return self._v2v_pipe
        import torch
        cfg = get_model_config(model_key)
        if cfg is None:
            raise ValueError(f"Unsupported model: {model_key}")
        hf_name = cfg["model_name"]
        dtype_name = cfg.get("dtype", settings.dtype)
        dtype = torch.bfloat16 if dtype_name == "bfloat16" else torch.float16
        tok = settings.hf_token if cfg.get("needs_token") else settings.hf_token
        from diffusers import CogVideoXVideoToVideoPipeline
        self._v2v_pipe = CogVideoXVideoToVideoPipeline.from_pretrained(
            hf_name, torch_dtype=dtype, token=tok,
        )
        self._v2v_pipe.enable_model_cpu_offload()
        if hasattr(self._v2v_pipe.vae, "enable_tiling"):
            self._v2v_pipe.vae.enable_tiling()
        self._current_v2v_model_key = model_key
        logger.info(f"V2V pipeline loaded: {hf_name}")
        return self._v2v_pipe

    def _apply_scheduler(self, name: str | None = None, pipe=None, cfg=None):
        pipe = pipe or self._pipe
        cfg = cfg or get_model_config(self._current_model_key or "")
        if cfg is None:
            return
        schedulers = cfg.get("schedulers", {})
        if not schedulers:
            return
        name = name or cfg.get("default_scheduler")
        cls_name = schedulers.get(name)
        if cls_name is None:
            logger.warning(f"Unknown scheduler '{name}', using default")
            return

        from diffusers import schedulers as sched_module
        cls = getattr(sched_module, cls_name, None)
        if cls is None:
            logger.warning(f"Scheduler class {cls_name} not found in diffusers")
            return

        pipe.scheduler = cls.from_config(pipe.scheduler.config)
        logger.info(f"Scheduler set to {cls_name}")

        import functools, numpy as np, torch
        orig_st = pipe.scheduler.set_timesteps
        @functools.wraps(orig_st)
        def _patched_st(*args, **kwargs):
            if "sigmas" in kwargs and isinstance(kwargs["sigmas"], np.ndarray):
                kwargs["sigmas"] = torch.from_numpy(kwargs["sigmas"])
            return orig_st(*args, **kwargs)
        pipe.scheduler.set_timesteps = _patched_st

    def _log_vram(self):
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            total = getattr(props, "total_memory", getattr(props, "total_mem", 0)) / (1024 ** 3)
            free = (
                torch.cuda.mem_get_info(0)[0] / (1024 ** 3)
                if hasattr(torch.cuda, "mem_get_info")
                else 0
            )
            logger.info(f"VRAM: {free:.1f} GB free / {total:.1f} GB total")

    def _build_callback(self, steps: int, progress_callback):
        if not progress_callback:
            return None
        import asyncio
        loop = asyncio.get_running_loop()
        current_step = [0]

        def callback(pipe, step_index, timestep, callback_kwargs):
            current_step[0] = step_index + 1
            logger.info(f"Step {current_step[0]}/{steps}")
            try:
                asyncio.run_coroutine_threadsafe(
                    progress_callback(current_step[0], steps), loop,
                )
            except RuntimeError:
                pass
            return callback_kwargs

        return callback

    def unload(self):
        import torch
        self._pipe = None
        self._current_model_key = None
        self._v2v_pipe = None
        self._current_v2v_model_key = None
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
        self._log_vram()
        logger.info("Pipelines unloaded and VRAM cleared")

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        video_frames: Optional[list[Image.Image]] = None,
        strength: float = 0.8,
        width: Optional[int] = None,
        height: Optional[int] = None,
        steps: Optional[int] = None,
        cfg: Optional[float] = None,
        seed: int = 0,
        scheduler: str | None = None,
        model: str = "cogvideox-2b",
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:
        import torch

        model_cfg = get_model_config(model)
        if model_cfg is None:
            raise ValueError(f"Unsupported model: {model}")

        d = model_cfg["defaults"]
        w = width or d.get("width", 704)
        h = height or d.get("height", 480)
        s = steps or d.get("steps", 50)
        c = cfg or d.get("cfg", 6.0)
        fps = d.get("fps", 8)
        nf = d.get("num_frames", 49)
        max_seq = d.get("max_seq", 226)

        cls_name = model_cfg["pipeline_class"]
        is_v2v = video_frames and cls_name in ("CogVideoXPipeline", "CogVideoXImageToVideoPipeline")

        if video_frames and not is_v2v:
            raise ValueError(f"Model '{model}' ({cls_name}) does not support video input. Use a CogVideoX or I2V model for video-to-video.")

        gen = torch.Generator(device=self.device)
        if seed > 0:
            gen.manual_seed(seed)

        try:
            pipe_kwargs = dict(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                num_inference_steps=s,
                guidance_scale=c,
                generator=gen,
                output_type="pil",
                max_sequence_length=max_seq,
            )

            if is_v2v:
                pipe = self._ensure_v2v_pipe(model)
                self._apply_scheduler(scheduler, pipe=pipe, cfg=model_cfg)
                pipe_kwargs["video"] = video_frames
                pipe_kwargs["strength"] = strength
            else:
                self._ensure_pipe(model)
                self._apply_scheduler(scheduler)
                pipe = self._pipe
                # align to multiples of 32 for pipelines that require it
                wa, ha = (w // 32) * 32, (h // 32) * 32
                if wa != w or ha != h:
                    logger.info(f"Adjusting resolution {w}x{h} → {wa}x{ha} (must be divisible by 32)")
                pipe_kwargs["width"] = wa
                pipe_kwargs["height"] = ha
                pipe_kwargs["num_frames"] = nf

            cb = self._build_callback(s, progress_callback)
            if progress_callback:
                await progress_callback(0, s)
            pipe_kwargs["callback_on_step_end"] = cb

            logger.info(f"Starting {'V2V' if is_v2v else 'T2V'} generation...")
            self._log_vram()

            import asyncio
            loop = asyncio.get_running_loop()
            output = await loop.run_in_executor(None, lambda: pipe(**pipe_kwargs))

            if progress_callback:
                await progress_callback(s, s)

            logger.info("Pipeline completed, saving video...")
            self._log_vram()

            output_dir = settings.results_dir
            os.makedirs(output_dir, exist_ok=True)
            out_path = os.path.join(output_dir, f"gen_{int(time.time())}_{seed}.mp4")
            from diffusers.utils import export_to_video
            export_to_video(output.frames[0], out_path, fps=fps)
            logger.info(f"Saved to {out_path}")
            return f"/results/{os.path.basename(out_path)}"

        except torch.cuda.OutOfMemoryError:
            raise RuntimeError("CUDA out of memory. Try reducing resolution or enabling CPU offload.")
        except Exception as e:
            logger.exception("Generation failed")
            raise RuntimeError(f"Generation failed: {e}")
