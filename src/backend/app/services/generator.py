import logging
import os
import time
from typing import Optional, Callable, Awaitable

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
    },
}


class VideoGenerator:
    def __init__(self):
        self.pipeline = None
        self.device = settings.device
        self.model_cfg = SUPPORTED_MODELS.get(settings.model_type)
        if self.model_cfg is None:
            raise RuntimeError(f"Unsupported model_type: {settings.model_type}")

    def load_model(self):
        if self.pipeline is not None:
            return
        import torch
        model_name = settings.model_name
        tok = settings.hf_token if self.model_cfg["needs_token"] else None
        dtype_name = self.model_cfg.get("dtype", settings.dtype)
        dtype = torch.bfloat16 if dtype_name == "bfloat16" else torch.float16

        if self.model_cfg["pipeline_class"] == "LTXPipeline":
            from diffusers import LTXPipeline
            if tok:
                os.environ["HF_TOKEN"] = tok
            self.pipeline = LTXPipeline.from_pretrained(
                model_name, torch_dtype=dtype, token=tok,
            )
            self.pipeline.enable_model_cpu_offload()
            logger.info("LTX-Video model loaded")

        elif self.model_cfg["pipeline_class"] == "CogVideoXPipeline":
            from diffusers import CogVideoXPipeline
            self.pipeline = CogVideoXPipeline.from_pretrained(
                model_name, torch_dtype=dtype, token=tok,
            )
            self.pipeline.enable_model_cpu_offload()
            self.pipeline.vae.enable_tiling()
            logger.info("CogVideoX-5B model loaded")

        self._log_vram()

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

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: Optional[int] = None,
        height: Optional[int] = None,
        steps: Optional[int] = None,
        cfg: Optional[float] = None,
        seed: int = 0,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:
        import torch
        self.load_model()
        d = self.model_cfg["defaults"]
        w = width or d["width"]
        h = height or d["height"]
        s = steps or d["steps"]
        c = cfg or d["cfg"]
        nf = d["num_frames"]
        fps = d["fps"]
        max_seq = d["max_seq"]

        generator = torch.Generator(device=self.device)
        if seed > 0:
            generator.manual_seed(seed)

        try:
            if progress_callback:
                await progress_callback(0, s)
            current_step = [0]

            def callback(pipe, step_index, timestep, callback_kwargs):
                current_step[0] = step_index + 1
                if progress_callback:
                    try:
                        import asyncio
                        asyncio.run_coroutine_threadsafe(
                            progress_callback(current_step[0], s),
                            asyncio.get_running_loop(),
                        )
                    except RuntimeError:
                        pass
                return callback_kwargs

            output = self.pipeline(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                width=w,
                height=h,
                num_frames=nf,
                num_inference_steps=s,
                guidance_scale=c,
                generator=generator,
                callback_on_step_end=callback,
                output_type="pil",
                max_sequence_length=max_seq,
            )

            if progress_callback:
                await progress_callback(s, s)

            output_dir = settings.results_dir
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, f"gen_{int(time.time())}_{seed}.mp4")
            from diffusers.utils import export_to_video
            export_to_video(output.frames[0], output_path, fps=fps)
            logger.info(f"Generated video saved to {output_path}")
            return f"/results/{os.path.basename(output_path)}"

        except torch.cuda.OutOfMemoryError:
            raise RuntimeError(
                "CUDA out of memory. Try reducing resolution or enabling CPU offload."
            )
        except Exception as e:
            logger.exception("Generation failed")
            raise RuntimeError(f"Generation failed: {e}")
