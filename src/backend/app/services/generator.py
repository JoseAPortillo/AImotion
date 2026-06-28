import logging
import os
import time
from typing import Optional, Callable, Awaitable
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

SUPPORTED_MODELS = {
    "ltx-video": {
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
            "flow_match_heun": "FlowMatchHeunDiscreteScheduler",
            "ltx_euler_ancestral_rf": "LTXEulerAncestralRFScheduler",
        },
        "default_scheduler": "flow_match_euler",
    },
    "cogvideox": {
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


def extract_frames(path: str, max_frames: int = 49) -> list[Image.Image]:
    import imageio
    all_frames: list[Image.Image] = []
    reader = imageio.get_reader(path)
    for frame in reader:
        all_frames.append(Image.fromarray(frame))
    reader.close()
    total = len(all_frames)
    if total <= max_frames:
        logger.info(f"Extracted {total} frames from {path} (≤ max)")
        return all_frames
    step = total / max_frames
    frames = [all_frames[int(i * step)] for i in range(max_frames)]
    logger.info(f"Extracted {len(frames)} frames from {path} (total={total}, step={step:.1f})")
    return frames


class VideoGenerator:
    def __init__(self):
        self._pipe = None
        self.device = settings.device
        self.model_cfg = SUPPORTED_MODELS.get(settings.model_type)
        if self.model_cfg is None:
            raise RuntimeError(f"Unsupported model_type: {settings.model_type}")

    def _ensure_pipe(self):
        if self._pipe is not None:
            return
        import torch
        model_name = settings.model_name
        tok = settings.hf_token if self.model_cfg["needs_token"] else None
        if tok:
            os.environ["HF_TOKEN"] = tok
        dtype_name = self.model_cfg.get("dtype", settings.dtype)
        dtype = torch.bfloat16 if dtype_name == "bfloat16" else torch.float16
        cls_name = self.model_cfg["pipeline_class"]
        if cls_name == "LTXPipeline":
            from diffusers import LTXPipeline
            self._pipe = LTXPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        elif cls_name == "CogVideoXPipeline":
            from diffusers import CogVideoXPipeline
            self._pipe = CogVideoXPipeline.from_pretrained(model_name, torch_dtype=dtype, token=tok)
        self._pipe.enable_model_cpu_offload()
        if hasattr(self._pipe.vae, "enable_tiling"):
            self._pipe.vae.enable_tiling()
        self._log_vram()
        logger.info(f"Pipeline loaded: {cls_name}({model_name})")

    def _apply_scheduler(self, name: str | None = None, pipe=None):
        pipe = pipe or self._pipe
        schedulers = self.model_cfg.get("schedulers", {})
        if not schedulers:
            return
        name = name or self.model_cfg.get("default_scheduler")
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
        if self._pipe is not None:
            import torch
            logger.info("Unloading pipeline and clearing VRAM...")
            self._pipe = None
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            self._log_vram()

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
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:
        import torch
        from diffusers.utils.torch_utils import randn_tensor

        self._ensure_pipe()
        self._apply_scheduler(scheduler)
        pipe = self._pipe
        d = self.model_cfg["defaults"]
        w = width or d["width"]
        h = height or d["height"]
        s = steps or d["steps"]
        c = cfg or d["cfg"]
        fps = d["fps"]
        nf = d["num_frames"]
        max_seq = d["max_seq"]

        gen = torch.Generator(device=self.device)
        if seed > 0:
            gen.manual_seed(seed)

        try:
            cls_name = self.model_cfg["pipeline_class"]
            is_v2v = video_frames and cls_name in ("CogVideoXPipeline",)
            
            cb = self._build_callback(s, progress_callback)
            if progress_callback:
                await progress_callback(0, s)

            logger.info(f"Starting {'V2V' if is_v2v else 'T2V'} generation...")
            self._log_vram()
            
            pipe_kwargs = dict(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                num_inference_steps=s,
                guidance_scale=c,
                generator=gen,
                callback_on_step_end=cb,
                output_type="pil",
                max_sequence_length=max_seq,
            )

            if is_v2v:
                from diffusers import CogVideoXVideoToVideoPipeline
                pipe = CogVideoXVideoToVideoPipeline.from_pretrained(
                    settings.model_name, torch_dtype=pipe.dtype, token=settings.hf_token,
                )
                pipe.enable_model_cpu_offload()
                self._apply_scheduler(scheduler, pipe=pipe)
                pipe_kwargs["video"] = video_frames
                pipe_kwargs["strength"] = strength
                pipe_kwargs["num_frames"] = nf
            else:
                pipe_kwargs["width"] = w
                pipe_kwargs["height"] = h
                pipe_kwargs["num_frames"] = nf

            output = pipe(**pipe_kwargs)

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
