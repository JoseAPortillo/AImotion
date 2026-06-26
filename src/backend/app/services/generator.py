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


def extract_frames(path: str, max_frames: int = 49) -> list[Image.Image]:
    import imageio
    frames: list[Image.Image] = []
    reader = imageio.get_reader(path)
    for i, frame in enumerate(reader):
        if i >= max_frames:
            break
        frames.append(Image.fromarray(frame))
    reader.close()
    logger.info(f"Extracted {len(frames)} frames from {path}")
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
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:
        import torch
        from diffusers.utils.torch_utils import randn_tensor

        self._ensure_pipe()
        pipe = self._pipe
        d = self.model_cfg["defaults"]
        w = width or d["width"]
        h = height or d["height"]
        s = steps or d["steps"]
        c = cfg or d["cfg"]
        fps = d["fps"]
        max_seq = d["max_seq"]

        gen = torch.Generator(device=self.device)
        if seed > 0:
            gen.manual_seed(seed)

        try:
            cls_name = self.model_cfg["pipeline_class"]
            if video_frames and cls_name in ("CogVideoXPipeline",):
                logger.info(f"V2V mode: {len(video_frames)} frames, strength={strength}")
                video_tensor = pipe.video_processor.preprocess_video(
                    video_frames, height=h, width=w,
                ).to(device=self.device, dtype=torch.float16)

                init_latents = pipe.vae.encode(video_tensor).latent_dist.sample(gen)
                init_latents = init_latents.permute(0, 2, 1, 3, 4)
                init_latents = pipe.vae_scaling_factor_image * init_latents

                timesteps = pipe.scheduler.timesteps.to(device=self.device)
                init_timestep = min(int(s * strength), s)
                t_start = max(s - init_timestep, 0)
                sigmas = timesteps[t_start:]
                logger.info(f"V2V: {len(sigmas)} denoising steps from timestep {sigmas[0].item():.1f}")

                noise = randn_tensor(
                    init_latents.shape, generator=gen,
                    device=self.device, dtype=init_latents.dtype,
                )
                noisy_latents = pipe.scheduler.add_noise(init_latents, noise, sigmas[0:1])
                latents_arg = noisy_latents
                nf = init_latents.size(1)
            else:
                latents_arg = None
                nf = d["num_frames"]

            cb = self._build_callback(s, progress_callback)
            if progress_callback:
                await progress_callback(0, s)

            output = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                latents=latents_arg,
                width=w,
                height=h,
                num_frames=nf,
                num_inference_steps=s,
                guidance_scale=c,
                generator=gen,
                callback_on_step_end=cb,
                output_type="pil",
                max_sequence_length=max_seq,
            )

            if progress_callback:
                await progress_callback(s, s)

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
