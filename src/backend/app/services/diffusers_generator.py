import logging
import os
import time
import inspect
from typing import Optional, Callable, Awaitable
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


def infer_pipeline_params(pipeline_class: str) -> dict | None:
    """Infer accepted __call__ params from pipeline class name conventions.

    Differs from get_accepted_params() in that it does NOT load the model —
    it uses naming heuristics to avoid triggering DummyObject import errors
    for pipelines whose optional dependencies are absent.
    """
    if not pipeline_class:
        return None

    params: dict[str, dict] = {}
    params["prompt"] = {"has_default": False, "default": None}
    params["num_inference_steps"] = {"has_default": True, "default": 50}
    params["guidance_scale"] = {"has_default": True, "default": 7.0}

    if "ImageToVideo" in pipeline_class:
        params["image"] = {"has_default": False, "default": None}
        params["strength"] = {"has_default": True, "default": 0.8}
    elif "VideoToVideo" in pipeline_class:
        params["video"] = {"has_default": False, "default": None}
        params["strength"] = {"has_default": True, "default": 0.8}
    elif "Img2Img" in pipeline_class:
        params["image"] = {"has_default": False, "default": None}
        params["strength"] = {"has_default": True, "default": 0.8}

    if "CogVideoX" in pipeline_class:
        params["num_frames"] = {"has_default": True, "default": 49}
        params["max_sequence_length"] = {"has_default": True, "default": 226}
    elif "StableDiffusionXL" in pipeline_class or "StableDiffusion" in pipeline_class:
        params["width"] = {"has_default": True, "default": 1024}
        params["height"] = {"has_default": True, "default": 1024}
    elif pipeline_class in ("LTXPipeline",):
        params["width"] = {"has_default": True, "default": 704}
        params["height"] = {"has_default": True, "default": 512}
        params["num_frames"] = {"has_default": True, "default": 97}
        params["max_sequence_length"] = {"has_default": True, "default": 256}

    return params


class DiffusersGenerator:
    def __init__(self, device: str | None = None):
        self._pipe = None
        self._current_model_key: str | None = None
        self._current_model_name: str | None = None
        self.device = device or settings.device

    # ---- loading ----

    def _load_pipe(self, model_name: str, dtype, token=None):
        from diffusers import DiffusionPipeline, StableDiffusionXLPipeline, StableDiffusionPipeline
        from huggingface_hub import HfApi, hf_hub_download
        
        api = HfApi()
        files = api.list_repo_files(model_name)
        weight_files = [f for f in files if f.endswith(('.safetensors', '.ckpt'))]
        has_model_index = 'model_index.json' in files
        
        if has_model_index or not weight_files:
            pipe = DiffusionPipeline.from_pretrained(
                model_name, torch_dtype=dtype, token=token,
            )
            if hasattr(pipe, "enable_model_cpu_offload"):
                pipe.enable_model_cpu_offload()
                pipe.enable_attention_slicing()
            else:
                pipe.to(self.device)
            if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
                pipe.vae.enable_tiling()
            self._log_vram()
            logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
            return pipe

        # Single-file checkpoint
        checkpoint_file = weight_files[0]
        logger.info(f"Detected single-file checkpoint: {checkpoint_file}")
        local_path = hf_hub_download(
            repo_id=model_name,
            filename=checkpoint_file,
            token=token,
        )
        logger.info(f"Downloaded checkpoint to: {local_path}")

        # Fast path — try vanilla load first (checkpoint may have all components)
        for pipe_cls in (StableDiffusionXLPipeline, StableDiffusionPipeline):
            try:
                pipe = pipe_cls.from_single_file(local_path, torch_dtype=dtype)
                logger.info(f"Loaded as {pipe_cls.__name__} from single file (full checkpoint)")
                pipe.to(self.device)
                if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
                    pipe.vae.enable_tiling()
                self._log_vram()
                logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
                return pipe
            except Exception:
                logger.info(f"{pipe_cls.__name__} vanilla load failed, will retry with components")

        # Slow path — checkpoint is missing one or more subcomponents; load everything from base models
        logger.info("Loading all components from base models...")
        from diffusers import AutoencoderKL, UNet2DConditionModel
        from transformers import CLIPTextModel, CLIPTextModelWithProjection, CLIPTokenizer

        try:
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=dtype)
        except Exception:
            vae = AutoencoderKL.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", subfolder="vae", torch_dtype=dtype)

        try:
            unet = UNet2DConditionModel.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0", subfolder="unet", torch_dtype=dtype,
            )
            text_encoder = CLIPTextModel.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0", subfolder="text_encoder", torch_dtype=dtype,
            )
            text_encoder_2 = CLIPTextModelWithProjection.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0", subfolder="text_encoder_2", torch_dtype=dtype,
            )
            tokenizer = CLIPTokenizer.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", subfolder="tokenizer")
            tokenizer_2 = CLIPTokenizer.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", subfolder="tokenizer_2")

            pipe = StableDiffusionXLPipeline.from_single_file(
                local_path,
                unet=unet, vae=vae,
                text_encoder=text_encoder, text_encoder_2=text_encoder_2,
                tokenizer=tokenizer, tokenizer_2=tokenizer_2,
                torch_dtype=dtype,
            )
            logger.info("Loaded as SDXL single-file checkpoint with all components")
        except Exception as e:
            logger.warning(f"SDXL with components failed: {e}, trying SD with components")
            try:
                unet = UNet2DConditionModel.from_pretrained(
                    "runwayml/stable-diffusion-v1-5", subfolder="unet", torch_dtype=dtype,
                )
                text_encoder = CLIPTextModel.from_pretrained(
                    "runwayml/stable-diffusion-v1-5", subfolder="text_encoder", torch_dtype=dtype,
                )
                tokenizer = CLIPTokenizer.from_pretrained("runwayml/stable-diffusion-v1-5", subfolder="tokenizer")

                pipe = StableDiffusionPipeline.from_single_file(
                    local_path,
                    unet=unet, vae=vae,
                    text_encoder=text_encoder, tokenizer=tokenizer,
                    torch_dtype=dtype,
                )
                logger.info("Loaded as SD single-file checkpoint with all components")
            except Exception as e2:
                raise ValueError(
                    f"Could not load {model_name} — tried vanilla SDXL/SD and with all components. "
                    f"SDXL error: {e}. SD error: {e2}"
                )

        pipe.to(self.device)
        if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
            pipe.vae.enable_tiling()
        self._log_vram()
        logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
        return pipe

    def _ensure_pipe(self, model_key: str):
        from app.services.generator import get_model_config
        if self._pipe is not None and self._current_model_key == model_key:
            return self._pipe
        import torch
        cfg = get_model_config(model_key)
        if cfg is None:
            raise ValueError(f"Unsupported model: {model_key}")
        model_name = cfg["model_name"]
        tok = settings.hf_token if cfg.get("needs_token") else None
        if tok:
            os.environ["HF_TOKEN"] = tok
        dtype_name = cfg.get("dtype", settings.dtype)
        dtype = torch.bfloat16 if dtype_name == "bfloat16" else torch.float16
        self.unload()
        self._pipe = self._load_pipe(model_name, dtype, tok)
        self._current_model_key = model_key
        self._current_model_name = model_name
        return self._pipe

    # ---- scheduler ----

    def _apply_scheduler(self, name: str | None = None, pipe=None, cfg=None):
        from app.services.generator import get_model_config
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

    # ---- helpers ----

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

    # ---- dynamic kwargs ----

    def _build_pipe_kwargs(
        self, pipe, prompt, negative_prompt, video_frames,
        strength, width, height, steps, cfg, seed, nf, max_seq, callback,
    ):
        import torch
        sig = inspect.signature(pipe.__call__)
        valid = set(sig.parameters.keys())
        kw: dict = {}

        kw["prompt"] = prompt
        kw["num_inference_steps"] = steps
        kw["guidance_scale"] = cfg
        kw["output_type"] = "pil"

        if "generator" in valid:
            gen = torch.Generator(device=self.device)
            if seed > 0:
                gen.manual_seed(seed)
            kw["generator"] = gen

        if negative_prompt and "negative_prompt" in valid:
            kw["negative_prompt"] = negative_prompt

        if callback and "callback_on_step_end" in valid:
            kw["callback_on_step_end"] = callback

        if video_frames:
            if "image" in valid:
                kw["image"] = video_frames[0]
                if "strength" in valid:
                    kw["strength"] = strength
            elif "video" in valid:
                kw["video"] = video_frames
                if "strength" in valid:
                    kw["strength"] = strength

        if width is not None and "width" in valid:
            kw["width"] = width
        if height is not None and "height" in valid:
            kw["height"] = height
        if "num_frames" in valid:
            kw["num_frames"] = nf
        if "max_sequence_length" in valid:
            kw["max_sequence_length"] = max_seq

        return kw

    # ---- metadata ----

    def get_accepted_params(self, model_key: str) -> dict:
        pipe = self._ensure_pipe(model_key)
        sig = inspect.signature(pipe.__call__)
        params = {}
        for name, param in sig.parameters.items():
            if name in ("self", "kwargs", "callback_on_step_end"):
                continue
            has_default = param.default is not inspect.Parameter.empty
            default = param.default if has_default else None
            params[name] = {
                "has_default": has_default,
                "default": default,
            }
        return params

    # ---- adapters (LoRA / ControlNet) ----

    @property
    def _active_lora(self) -> str | None:
        return getattr(self, "_lora_path", None)

    def apply_lora(self, lora_path: str, scale: float = 1.0) -> None:
        if self._pipe is None:
            raise RuntimeError("No pipeline loaded — load a model first")
        import torch
        logger.info(f"Applying LoRA from {lora_path} with scale {scale}")
        self._pipe.load_lora_weights(lora_path, adapter_name="aimotion_lora")
        self._pipe.set_adapters(["aimotion_lora"], adapter_weights=[scale])
        self._lora_path = lora_path
        self._lora_scale = scale
        logger.info("LoRA applied and fused")

    def unload_lora(self) -> None:
        if self._pipe is None:
            return
        if not self._active_lora:
            return
        logger.info("Removing LoRA from pipeline")
        try:
            self._pipe.unload_lora_weights()
        except Exception:
            pass
        try:
            self._pipe.unfuse_lora()
        except Exception:
            pass
        self._lora_path = None
        self._lora_scale = 1.0
        logger.info("LoRA removed")

    def apply_controlnet(self, controlnet_path: str) -> None:
        if self._pipe is None:
            raise RuntimeError("No pipeline loaded — load a model first")
        raise NotImplementedError(
            "ControlNet requires pipeline reconstruction with ControlNetModel. "
            "Not yet implemented."
        )

    def unload_controlnet(self) -> None:
        pass

    # ---- lifecycle ----

    def unload(self):
        import torch
        self._pipe = None
        self._current_model_key = None
        self._current_model_name = None
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
        self._log_vram()
        logger.info("Pipeline unloaded and VRAM cleared")

    # ---- generation ----

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
        num_frames: Optional[int] = None,
        max_sequence_length: Optional[int] = None,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
    ) -> str:
        from app.services.generator import get_model_config
        import torch

        model_cfg = get_model_config(model)
        if model_cfg is None:
            raise ValueError(f"Unsupported model: {model}")

        d = model_cfg["defaults"]
        # Only pass width/height to the pipeline if the model config defines them.
        # Models with fixed training resolution (e.g. CogVideoX-5b-I2V) omit them.
        w = width if "width" in d else None
        h = height if "height" in d else None
        s = steps or d.get("steps", 50)
        c = cfg or d.get("cfg", 6.0)
        fps = d.get("fps", 8)
        nf = num_frames if num_frames is not None else d.get("num_frames", 49)
        max_seq = max_sequence_length if max_sequence_length is not None else d.get("max_seq", 226)

        pipe = self._ensure_pipe(model)
        self._apply_scheduler(scheduler, pipe=pipe, cfg=model_cfg)

        sig = inspect.signature(pipe.__call__)
        valid_pipe_params = set(sig.parameters.keys())

        if video_frames and "image" not in valid_pipe_params and "video" not in valid_pipe_params:
            raise ValueError(
                f"Model '{model}' does not support video input "
                f"(no 'image' or 'video' parameter in {type(pipe).__name__}.__call__)"
            )

        cb = self._build_callback(s, progress_callback)
        if progress_callback:
            await progress_callback(0, s)

        pipe_kwargs = self._build_pipe_kwargs(
            pipe, prompt, negative_prompt, video_frames, strength,
            w, h, s, c, seed, nf, max_seq, cb,
        )

        logger.info(f"Starting generation with {type(pipe).__name__}...")
        self._log_vram()

        import asyncio
        loop = asyncio.get_running_loop()
        output = await loop.run_in_executor(None, lambda: pipe(**pipe_kwargs))

        if progress_callback:
            await progress_callback(s, s)

        logger.info("Pipeline completed, saving output...")
        self._log_vram()

        output_dir = settings.results_dir
        os.makedirs(output_dir, exist_ok=True)
        ts = int(time.time())

        if hasattr(output, "frames") and output.frames:
            from diffusers.utils import export_to_video
            out_path = os.path.join(output_dir, f"gen_{ts}_{seed}.mp4")
            export_to_video(output.frames[0], out_path, fps=fps)
            logger.info(f"Saved video to {out_path}")
            return f"/results/{os.path.basename(out_path)}"
        elif hasattr(output, "images") and output.images:
            out_path = os.path.join(output_dir, f"gen_{ts}_{seed}.png")
            output.images[0].save(out_path)
            logger.info(f"Saved image to {out_path}")
            return f"/results/{os.path.basename(out_path)}"
        else:
            raise RuntimeError(f"Unknown output type from {type(pipe).__name__}: no frames or images attribute")
