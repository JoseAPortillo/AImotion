import logging
import os
import time
import inspect
import importlib
from typing import Optional, Callable, Awaitable
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


def _resolve_pipeline_class(pipeline_class: str) -> type | None:
    import diffusers

    cls = getattr(diffusers, pipeline_class, None)
    if cls is not None:
        return cls

    pipelines_dir = os.path.join(os.path.dirname(diffusers.__file__), "pipelines")
    if not os.path.isdir(pipelines_dir):
        return None

    for sub_name in sorted(os.listdir(pipelines_dir)):
        sub_init = os.path.join(pipelines_dir, sub_name, "__init__.py")
        if not os.path.isfile(sub_init):
            continue
        try:
            mod = importlib.import_module(f"diffusers.pipelines.{sub_name}")
            cls = getattr(mod, pipeline_class, None)
            if cls is not None:
                return cls
        except Exception:
            continue

    return None


def _infer_params_from_signature(cls: type) -> dict | None:
    if not hasattr(cls, "__call__"):
        return None

    try:
        sig = inspect.signature(cls.__call__)
    except (ValueError, TypeError):
        return None

    _SKIP_PARAMS = {"self", "kwargs", "callback_on_step_end", "generator"}

    params: dict[str, dict] = {}

    for name, param in sig.parameters.items():
        if name in _SKIP_PARAMS:
            continue

        has_default = param.default is not inspect.Parameter.empty
        entry: dict = {}

        if has_default:
            default = param.default
            if isinstance(default, (int, float, bool, str)) or default is None:
                entry = {"has_default": True, "default": default}
            elif isinstance(default, (list, tuple, dict)):
                entry = {"has_default": True, "default": None}
            else:
                entry = {"has_default": True, "default": None}
        else:
            entry = {"has_default": False, "default": None}

        params[name] = entry

    return params if params else None


def infer_pipeline_params(pipeline_class: str) -> dict | None:
    if not pipeline_class:
        return None

    try:
        cls = _resolve_pipeline_class(pipeline_class)
        if cls is not None:
            return _infer_params_from_signature(cls)
    except Exception as e:
        logger.warning("Dynamic pipeline inspection failed for %s: %s", pipeline_class, e)

    return None


class DiffusersGenerator:
    def __init__(self, device: str | None = None):
        self._pipe = None
        self._current_model_key: str | None = None
        self._current_model_name: str | None = None
        self.device = device or settings.device

    # ---- loading ----

    def _load_pipe(self, model_name: str, dtype, token=None, pipeline_class_name: str | None = None):
        from diffusers import DiffusionPipeline
        from huggingface_hub import HfApi, hf_hub_download
        from app.services.model_registry import get_cached_repo_info, is_model_cached, list_hf_files

        mod_cls = None
        if pipeline_class_name:
            import importlib
            mod_cls = getattr(importlib.import_module("diffusers"), pipeline_class_name, None)

        # Use cached repo file list to avoid HF API call on every load
        repo_info = get_cached_repo_info(model_name)
        if repo_info:
            files = repo_info["repo_files"]
            checkpoint_file = repo_info.get("checkpoint_file", "")
            has_model_index = "model_index.json" in files
        else:
            files = list_hf_files(model_name)
            weight_files = [f for f in files if f.endswith(('.safetensors', '.ckpt'))]
            has_model_index = 'model_index.json' in files
            checkpoint_file = weight_files[0] if weight_files and not has_model_index else ""

        model_is_cached = is_model_cached(model_name)

        if has_model_index or not checkpoint_file:
            pipe_cls = mod_cls or DiffusionPipeline
            pipe = pipe_cls.from_pretrained(
                model_name, torch_dtype=dtype, token=token,
                local_files_only=model_is_cached,
            )
            self._apply_memory_optimizations(pipe, dtype)
            self._inject_missing_i2v_components(pipe, model_name, dtype)
            self._log_vram()
            logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
            return pipe

        # Single-file checkpoint — try generic auto-detect first
        if not checkpoint_file:
            files = list_hf_files(model_name)
            weight_files = [f for f in files if f.endswith(('.safetensors', '.ckpt'))]
            checkpoint_file = weight_files[0] if weight_files else ""

        logger.info(f"Detected single-file checkpoint: {checkpoint_file}")
        local_path = hf_hub_download(
            repo_id=model_name,
            filename=checkpoint_file,
            token=token,
            local_files_only=model_is_cached,
        )
        logger.info(f"Downloaded checkpoint to: {local_path}")

        pipe = self._try_load_single_file(local_path, dtype, mod_cls)
        if pipe is not None:
            pipe.to(self.device)
            self._enable_vae_tiling(pipe)
            self._log_vram()
            logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
            return pipe

        # Last resort: component-by-component loading for SDXL/SD single-file checkpoints
        # that are missing subcomponent weights in the checkpoint itself.
        pipe = self._try_load_single_file_with_components(local_path, dtype)
        if pipe is not None:
            pipe.to(self.device)
            self._enable_vae_tiling(pipe)
            self._log_vram()
            logger.info(f"Pipeline loaded on {self.device}: {type(pipe).__name__}({model_name})")
            return pipe

        raise ValueError(
            f"Could not load {model_name} — tried auto-detect via {mod_cls or 'DiffusionPipeline'}, "
            f"and component-wise fallback for SDXL/SD."
        )

    @staticmethod
    def _enable_vae_tiling(pipe):
        if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
            try:
                pipe.vae.enable_tiling()
            except Exception:
                logger.debug(f"VAE tiling not supported for {type(pipe.vae).__name__}")

    @staticmethod
    def _inject_missing_i2v_components(pipe, model_name: str, dtype):
        from diffusers import CogVideoXImageToVideoPipeline, WanImageToVideoPipeline
        i2v_types = (CogVideoXImageToVideoPipeline, WanImageToVideoPipeline)
        if not isinstance(pipe, i2v_types):
            return
        image_enc = getattr(pipe, "image_encoder", None)
        if image_enc is not None:
            return

        # Map pipeline types to their expected CLIP variants
        _CLIP_FALLBACKS = {
            CogVideoXImageToVideoPipeline: "openai/clip-vit-large-patch14",
            WanImageToVideoPipeline: "openai/clip-vit-large-patch14",
        }
        clip_name = None
        for pipe_type, cname in _CLIP_FALLBACKS.items():
            if isinstance(pipe, pipe_type):
                clip_name = cname
                break

        if not clip_name:
            logger.warning(f"No CLIP fallback registered for {type(pipe).__name__}")
            return

        logger.warning(f"Model {model_name} loaded as I2V pipeline but missing image_encoder — injecting {clip_name}")
        try:
            from transformers import CLIPVisionModelWithProjection, CLIPImageProcessor
            enc = CLIPVisionModelWithProjection.from_pretrained(clip_name, torch_dtype=dtype)
            enc.eval()
            enc.to(pipe.device)
            pipe.image_encoder = enc
            pipe.feature_extractor = CLIPImageProcessor.from_pretrained(clip_name)
            logger.info(f"Injected CLIP image_encoder from {clip_name} into {type(pipe).__name__}")
        except Exception as e:
            logger.warning(f"Could not inject fallback image_encoder for {model_name}: {e}")

    @staticmethod
    def _apply_vae_tiling_config(pipe, vae_tiling: bool | None, vae_tile_overlap: float | None):
        if not hasattr(pipe, "vae"):
            return
        if vae_tiling is True and hasattr(pipe.vae, "enable_tiling"):
            try:
                pipe.vae.enable_tiling()
                logger.info("VAE tiling enabled via request")
            except Exception:
                logger.debug(f"VAE tiling not supported for {type(pipe.vae).__name__}")
        elif vae_tiling is False and hasattr(pipe.vae, "disable_tiling"):
            try:
                pipe.vae.disable_tiling()
                logger.info("VAE tiling disabled via request")
            except Exception:
                logger.debug(f"VAE disable_tiling not supported for {type(pipe.vae).__name__}")
        if vae_tile_overlap is not None and hasattr(pipe.vae, "tile_sample_overlap"):
            try:
                pipe.vae.tile_sample_overlap = vae_tile_overlap
                logger.info(f"VAE tile_sample_overlap set to {vae_tile_overlap}")
            except Exception:
                logger.debug(f"VAE tile_sample_overlap not settable for {type(pipe.vae).__name__}")

    @staticmethod
    def _try_load_single_file(local_path: str, dtype, pipe_cls: type | None = None):
        from diffusers import DiffusionPipeline

        if pipe_cls is not None and hasattr(pipe_cls, "from_single_file"):
            try:
                return pipe_cls.from_single_file(local_path, torch_dtype=dtype)
            except Exception as e:
                logger.info(f"Explicit {pipe_cls.__name__} from_single_file failed: {e}")

        try:
            return DiffusionPipeline.from_single_file(local_path, torch_dtype=dtype)
        except Exception as e:
            logger.info(f"Auto-detect from_single_file failed: {e}")

        return None

    @staticmethod
    def _try_load_single_file_with_components(local_path: str, dtype):
        from diffusers import StableDiffusionXLPipeline, StableDiffusionPipeline
        from diffusers import AutoencoderKL, UNet2DConditionModel
        from transformers import CLIPTextModel, CLIPTextModelWithProjection, CLIPTokenizer

        logger.info("Trying SDXL component-by-component loading as last resort...")
        try:
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=dtype)
        except Exception:
            vae = AutoencoderKL.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0", subfolder="vae", torch_dtype=dtype,
            )

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
            return pipe
        except Exception as e:
            logger.warning(f"SDXL with components failed: {e}")

        logger.info("Trying SD 1.5 component-by-component loading as last resort...")
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
            return pipe
        except Exception as e2:
            logger.warning(f"SD with components failed: {e2}")

        return None

    _I2V_OVERRIDES = {
        "WanPipeline": "WanImageToVideoPipeline",
    }

    def _ensure_pipe(self, model_key: str, has_image: bool = False):
        from app.services.generator import get_model_config
        cache_key = f"{model_key}{'_i2v' if has_image else ''}"
        if self._pipe is not None and self._current_model_key == cache_key:
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
        pipeline_class = cfg.get("pipeline_class")
        if has_image and pipeline_class in self._I2V_OVERRIDES:
            override = self._I2V_OVERRIDES[pipeline_class]
            logger.info(f"I2V mode: overriding pipeline {pipeline_class} → {override}")
            pipeline_class = override
        self.unload()
        self._pipe = self._load_pipe(model_name, dtype, tok, pipeline_class_name=pipeline_class)
        self._current_model_key = cache_key
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

    def _apply_memory_optimizations(self, pipe, dtype):
        import torch
        vram_gb = 0
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info(0)
            vram_gb = total / (1024 ** 3)
            logger.info(f"GPU VRAM: {vram_gb:.1f} GB total")

        if vram_gb > 0 and vram_gb <= 12:
            logger.info(f"VRAM ≤12 GB detected ({vram_gb:.1f} GB). Enabling model CPU offload.")
            try:
                pipe.enable_model_cpu_offload()
                logger.info("Model CPU offload enabled — components will move to GPU on demand")
                return
            except Exception as e:
                logger.warning(f"enable_model_cpu_offload failed: {e}. Falling back to device placement.")

        pipe.to(self.device)
        if hasattr(pipe, "enable_attention_slicing"):
            pipe.enable_attention_slicing()
        if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
            try:
                pipe.vae.enable_tiling()
            except Exception:
                logger.debug(f"VAE tiling not supported for {type(pipe.vae).__name__}")

    def _build_callback(self, steps: int, total_phases: int, progress_callback, cancel_event=None):
        if not progress_callback:
            return None
        import asyncio
        loop = asyncio.get_running_loop()
        current_step = [0]
        def callback(pipe, step_index, timestep, callback_kwargs):
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError("Generation cancelled by user")
            current_step[0] = step_index + 1
            logger.info(f"Step {current_step[0]}/{steps}")
            try:
                asyncio.run_coroutine_threadsafe(
                    progress_callback(current_step[0], total_phases), loop,
                )
            except RuntimeError:
                pass
            return callback_kwargs
        return callback

    # ---- dynamic kwargs ----

    def _build_pipe_kwargs(
        self, pipe, prompt, negative_prompt, video_frames,
        strength, width, height, steps, cfg, seed, nf, max_seq,
        decode_chunk, noise_aug, fps, motion_bucket,
        min_cfg, max_cfg,
        callback,
        **extra_kwargs,
    ):
        import torch
        sig = inspect.signature(pipe.__call__)
        valid = set(sig.parameters.keys())
        kw: dict = {}

        if "prompt" not in valid:
            logger.warning("Model pipeline '%s' does not accept a prompt — output will not reflect the prompt text", type(pipe).__name__)
        else:
            kw["prompt"] = prompt
        kw["num_inference_steps"] = steps
        if "guidance_scale" in valid:
            kw["guidance_scale"] = cfg
        if "use_dynamic_cfg" in valid and cfg > 1.0:
            kw["use_dynamic_cfg"] = True
        if "min_guidance_scale" in valid and min_cfg is not None:
            kw["min_guidance_scale"] = min_cfg
        if "max_guidance_scale" in valid and max_cfg is not None:
            kw["max_guidance_scale"] = max_cfg
        kw["output_type"] = "pil"

        if "generator" in valid:
            gen = torch.Generator(device=self.device)
            gen.manual_seed(seed)
            kw["generator"] = gen

        if negative_prompt and "negative_prompt" in valid:
            kw["negative_prompt"] = negative_prompt

        if callback and "callback_on_step_end" in valid:
            kw["callback_on_step_end"] = callback

        if video_frames:
            if "image" in valid:
                kw["image"] = video_frames[0]
                logger.info(f"Set kw['image'] from video_frames[0], size: {video_frames[0].size}")
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
        if decode_chunk is not None and "decode_chunk_size" in valid:
            kw["decode_chunk_size"] = decode_chunk
        if noise_aug is not None and "noise_aug_strength" in valid:
            kw["noise_aug_strength"] = noise_aug
        if fps is not None and "fps" in valid:
            kw["fps"] = fps
        if motion_bucket is not None and "motion_bucket_id" in valid:
            kw["motion_bucket_id"] = motion_bucket

        for k, v in extra_kwargs.items():
            if k in valid and v is not None:
                kw[k] = v

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
        decode_chunk_size: Optional[int] = None,
        noise_aug_strength: Optional[float] = None,
        min_guidance_scale: Optional[float] = None,
        max_guidance_scale: Optional[float] = None,
        fps: Optional[int] = None,
        motion_bucket_id: Optional[int] = None,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event=None,
        **extra_kwargs,
    ) -> str:
        from app.services.generator import get_model_config
        import torch

        model_cfg = get_model_config(model)
        if model_cfg is None:
            raise ValueError(f"Unsupported model: {model}")

        d = model_cfg["defaults"]
        w = width
        h = height
        s = steps or d.get("steps", 50)
        c = cfg or d.get("cfg", 6.0)
        fps_val = fps or d.get("fps", 8)
        nf = num_frames if num_frames is not None else d.get("num_frames", 49)
        max_seq = max_sequence_length if max_sequence_length is not None else d.get("max_seq", 226)
        noise_aug = noise_aug_strength if noise_aug_strength is not None else d.get("noise_aug_strength", 0.02)
        mbid = motion_bucket_id if motion_bucket_id is not None else d.get("motion_bucket_id", 127)
        min_cfg = min_guidance_scale if min_guidance_scale is not None else d.get("min_guidance_scale")
        max_cfg = max_guidance_scale if max_guidance_scale is not None else d.get("max_guidance_scale")

        has_image = video_frames is not None and len(video_frames) == 1
        pipe = self._ensure_pipe(model, has_image=has_image)
        self._apply_scheduler(scheduler, pipe=pipe, cfg=model_cfg)

        sig = inspect.signature(pipe.__call__)
        valid_pipe_params = set(sig.parameters.keys())

        if video_frames and "image" not in valid_pipe_params and "video" not in valid_pipe_params:
            has_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
            if not has_kwargs:
                raise ValueError(
                    f"Model '{model}' does not support video input "
                    f"(no 'image' or 'video' parameter in {type(pipe).__name__}.__call__)"
                )
            logger.debug(f"Pipeline {type(pipe).__name__}.__call__ accepts **kwargs, allowing image/video passthrough")

        total_phases = s + 2  # +1 warmup/encode, +1 decode/save
        cb = self._build_callback(s, total_phases, progress_callback, cancel_event)
        if progress_callback:
            await progress_callback(0, total_phases)

        logger.info(f"video_frames: {video_frames is not None}, length: {len(video_frames) if video_frames else 0}")
        if video_frames:
            logger.info(f"First frame size: {video_frames[0].size}")
            if w is not None and h is not None:
                orig = video_frames[0].size
                if orig != (w, h):
                    video_frames[0] = video_frames[0].resize((w, h), Image.LANCZOS)
                    logger.info(f"Resized video frame from {orig} to ({w}, {h})")

        pose_video_path = extra_kwargs.pop("pose_video_path", None)
        face_video_path = extra_kwargs.pop("face_video_path", None)
        if pose_video_path and os.path.exists(pose_video_path):
            pose_frames = extract_frames(pose_video_path, max_frames=nf or 81)
            if pose_frames:
                extra_kwargs["pose_video"] = pose_frames
                logger.info(f"Extracted {len(pose_frames)} pose video frames")
        if face_video_path and os.path.exists(face_video_path):
            face_frames = extract_frames(face_video_path, max_frames=nf or 81)
            if face_frames:
                extra_kwargs["face_video"] = face_frames
                logger.info(f"Extracted {len(face_frames)} face video frames")

        pipe_kwargs = self._build_pipe_kwargs(
            pipe, prompt, negative_prompt, video_frames, strength,
            w, h, s, c, seed, nf, max_seq, decode_chunk_size,
            noise_aug, fps_val, mbid, min_cfg, max_cfg, cb,
            **extra_kwargs,
        )

        for pname in ("image", "video"):
            if pname in valid_pipe_params and pname not in pipe_kwargs:
                raise ValueError(
                    f"Model '{type(pipe).__name__}' requires '{pname}' input "
                    f"but none was provided. Connect a compatible input node."
                )

        if video_frames and "image" not in pipe_kwargs and "video" not in pipe_kwargs:
            logger.info("Pipeline doesn't accept image/video — encoding image as initial latents")
            try:
                img = video_frames[0]
                tgt_size = (w or img.width, h or img.height)
                if img.size != tgt_size:
                    img = img.resize(tgt_size, Image.LANCZOS)
                import torch, numpy as np
                arr = np.array(img.convert("RGB")).astype(np.float32) / 127.5 - 1.0
                pixel = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
                pipe_dtype = next(pipe.vae.parameters()).dtype
                pixel = pixel.to(device=pipe.device, dtype=pipe_dtype)
                with torch.no_grad():
                    init_latents = pipe.vae.encode(pixel).latent_dist.sample()
                    init_latents = init_latents * pipe.vae.config.scaling_factor
                if "latents" in valid_pipe_params:
                    if pipe.vae.config.get("time_compression_ratio", 4):
                        nf_latent = max(1, (nf - 1) // 4 + 1) if nf else 1
                    else:
                        nf_latent = 1
                    if init_latents.dim() == 4:
                        init_latents = init_latents.unsqueeze(2).repeat(1, 1, nf_latent, 1, 1)
                    noise = torch.randn_like(init_latents, device=pipe.device)
                    str_val = min(strength, 0.8)
                    pipe_kwargs["latents"] = (1 - str_val) * init_latents + str_val * noise
                    logger.info(f"Added VAE-encoded image as initial latents, shape={pipe_kwargs['latents'].shape}")
            except Exception as e:
                logger.warning(f"Could not encode image as initial latents: {e}")

        vae_tiling = extra_kwargs.get("vae_tiling")
        vae_tile_overlap = extra_kwargs.get("vae_tile_overlap")
        if vae_tiling is not None or vae_tile_overlap is not None:
            self._apply_vae_tiling_config(pipe, vae_tiling, vae_tile_overlap)

        logger.info(f"Starting generation with {type(pipe).__name__}...")
        self._log_vram()

        import asyncio
        loop = asyncio.get_running_loop()
        output = await loop.run_in_executor(None, lambda: pipe(**pipe_kwargs))

        if progress_callback:
            await progress_callback(s + 1, total_phases)  # decode/save

        logger.info("Pipeline completed, saving output...")
        self._log_vram()
        logger.info(f"Output type: {type(output)}")
        logger.info(f"Output attributes: {[a for a in dir(output) if not a.startswith('_')]}")
        if hasattr(output, "frames"):
            logger.info(f"Output.frames type: {type(output.frames)}")
            if output.frames:
                logger.info(f"Output.frames length: {len(output.frames)}")
                if len(output.frames) > 0:
                    logger.info(f"Output.frames[0] type: {type(output.frames[0])}")
                    if isinstance(output.frames[0], list):
                        logger.info(f"Output.frames[0] length: {len(output.frames[0])}")
        if hasattr(output, "images"):
            logger.info(f"Output.images type: {type(output.images)}")
            if output.images:
                logger.info(f"Output.images length: {len(output.images)}")

        output_dir = settings.results_dir
        os.makedirs(output_dir, exist_ok=True)
        ts = int(time.time())

        if hasattr(output, "frames") and output.frames:
            from diffusers.utils import export_to_video
            out_path = os.path.join(output_dir, f"gen_{ts}_{seed}.mp4")
            export_to_video(output.frames[0], out_path, fps=fps_val)
            logger.info(f"Saved video to {out_path}")
            return f"/results/{os.path.basename(out_path)}"
        elif hasattr(output, "images") and output.images:
            out_path = os.path.join(output_dir, f"gen_{ts}_{seed}.png")
            output.images[0].save(out_path)
            logger.info(f"Saved image to {out_path}")
            return f"/results/{os.path.basename(out_path)}"
        else:
            raise RuntimeError(f"Unknown output type from {type(pipe).__name__}: no frames or images attribute")
