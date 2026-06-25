import logging
import os
import time
from typing import Optional, Callable, Awaitable

from app.core.config import settings

logger = logging.getLogger(__name__)


class VideoGenerator:
    def __init__(self):
        self.pipeline: Optional[object] = None
        self.device = settings.device

    def load_model(self):  # pragma: no cover — requires GPU + model weights
        if self.pipeline is not None:
            return
        import torch
        from diffusers import LTXPipeline
        logger.info(f"Loading LTX-Video 2B model: {settings.model_name}")
        dtype = torch.bfloat16 if settings.dtype == "bfloat16" else torch.float16
        self.pipeline = LTXPipeline.from_pretrained(
            settings.model_name,
            torch_dtype=dtype,
            variant="bf16" if dtype == torch.bfloat16 else None,
        )
        if settings.offload_text_encoder:
            self.pipeline.text_encoder.to("cpu")
            logger.info("Text encoder offloaded to CPU")
        if hasattr(self.pipeline, "enable_model_cpu_offload"):
            self.pipeline.enable_model_cpu_offload()
            logger.info("Model CPU offload enabled")
        else:
            self.pipeline.to(self.device)
        self._log_vram()
        logger.info("LTX-Video 2B model loaded")

    def _log_vram(self):  # pragma: no cover
        import torch
        if torch.cuda.is_available():
            total = torch.cuda.get_device_properties(0).total_mem / (1024 ** 3)
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
        width: int = 512,
        height: int = 512,
        steps: int = 25,
        cfg: float = 7.5,
        seed: int = 0,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:  # pragma: no cover — requires GPU + model weights
        import torch
        self.load_model()
        generator = torch.Generator(device=self.device)
        if seed > 0:
            generator.manual_seed(seed)
        else:
            generator.seed()
        try:
            if progress_callback:
                await progress_callback(0, steps)
            current_step = [0]

            def callback(pipe, step_index, timestep, callback_kwargs):
                current_step[0] = step_index + 1
                if progress_callback:
                    try:
                        import asyncio
                        asyncio.run_coroutine_threadsafe(
                            progress_callback(current_step[0], steps),
                            asyncio.get_running_loop(),
                        )
                    except RuntimeError:
                        pass
                return callback_kwargs

            output = self.pipeline(
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=generator,
                callback_on_step_end=callback,
                output_type="pt",
            )
            if progress_callback:
                await progress_callback(steps, steps)
            output_dir = settings.results_dir
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, f"gen_{int(time.time())}_{seed}.mp4")
            frames = output.frames[0]
            frames = frames.cpu().float()
            frames = (frames.clamp(-1, 1) + 1) / 2
            frames = (frames * 255).to(torch.uint8)
            frames = frames.permute(0, 2, 3, 1)
            fps = 8
            from torchvision.io import write_video
            write_video(output_path, frames, fps=fps)
            logger.info(f"Generated video saved to {output_path}")
            return f"/results/{os.path.basename(output_path)}"
        except torch.cuda.OutOfMemoryError:
            raise RuntimeError(
                "CUDA out of memory. Try reducing resolution or enabling CPU offload."
            )
        except Exception as e:
            logger.exception("Generation failed")
            raise RuntimeError(f"Generation failed: {e}")
