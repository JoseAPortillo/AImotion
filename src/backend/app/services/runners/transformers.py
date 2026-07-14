import logging
import os
import threading
from typing import Optional, Callable, Awaitable

from PIL import Image

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult

logger = logging.getLogger(__name__)


class TransformersRunner(BaseRunner):
    runner_key = "transformers"

    def __init__(self):
        self._model_key: Optional[str] = None
        self._model = None
        self._processor = None
        self._loaded = False

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        import torch

        try:
            # Get image from params (first frame if available)
            image = None
            if params.video_frames and len(params.video_frames) > 0:
                image = params.video_frames[0]

            # Build task prompt
            task_prompt = params.prompt or "Describe the image in detail"

            # Process inputs based on model type
            inputs = self._build_inputs(task_prompt, image)

            # Cast inputs to match model dtype
            model_dtype = next(self._model.parameters()).dtype
            inputs = {
                k: v.to(model_dtype) if hasattr(v, 'to') and v.is_floating_point() else v
                for k, v in inputs.items()
            }

            # Generate
            with torch.no_grad():
                outputs = self._model.generate(
                    **inputs,
                    max_new_tokens=params.extra.get("max_new_tokens", 512),
                    do_sample=params.extra.get("do_sample", True),
                    temperature=params.extra.get("temperature", 0.7),
                )

            # Decode output
            result_text = self._decode_output(outputs, task_prompt)

            # Save result as text file
            from app.config import settings
            import hashlib
            from datetime import datetime

            os.makedirs(settings.results_dir, exist_ok=True)
            hash_str = hashlib.md5(
                f"{result_text}{datetime.now().isoformat()}".encode()
            ).hexdigest()[:12]
            result_path = os.path.join(settings.results_dir, f"transformers_{hash_str}.txt")

            with open(result_path, "w", encoding="utf-8") as f:
                f.write(result_text)

            result_url = f"/results/{os.path.basename(result_path)}"

            if progress_callback:
                await progress_callback(100, 100)

            return GenerateResult(url=result_url, media_type="text")

        except Exception as e:
            logger.error(f"Transformers generation failed: {e}")
            raise

    def _build_inputs(self, prompt: str, image: Optional[Image.Image]) -> dict:
        """Build inputs based on model type."""
        model_class = type(self._model).__name__

        # Florence-2 models
        if "Florence" in model_class:
            if image:
                inputs = self._processor(text=prompt, images=image, return_tensors="pt")
            else:
                inputs = self._processor(text=prompt, return_tensors="pt")
            return {k: v.to(self._model.device) for k, v in inputs.items()}

        # BLIP-2 models
        elif "Blip2" in model_class:
            if image:
                inputs = self._processor(images=image, text=prompt, return_tensors="pt")
            else:
                inputs = self._processor(text=prompt, return_tensors="pt")
            return {k: v.to(self._model.device) for k, v in inputs.items()}

        # Qwen-VL models
        elif "Qwen" in model_class:
            messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]}]
            text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            if image:
                inputs = self._processor(text=[text], images=[image], return_tensors="pt")
            else:
                inputs = self._processor(text=[text], return_tensors="pt")
            return {k: v.to(self._model.device) for k, v in inputs.items()}

        # Generic fallback
        else:
            if image:
                inputs = self._processor(text=prompt, images=image, return_tensors="pt")
            else:
                inputs = self._processor(text=prompt, return_tensors="pt")
            return {k: v.to(self._model.device) for k, v in inputs.items()}

    def _decode_output(self, outputs, prompt: str) -> str:
        """Decode model output to text."""
        model_class = type(self._model).__name__

        # Florence-2 special decoding
        if "Florence" in model_class:
            generated_ids = outputs
            generated_text = self._processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
            # Parse Florence-2 output format
            parsed = self._processor.post_process_generation(
                generated_text,
                task=prompt,
                image_size=(self._processor.image_processor.crop_size["height"],
                           self._processor.image_processor.crop_size["width"])
            )
            # Extract text value from dict
            if isinstance(parsed, dict):
                values = list(parsed.values())
                return str(values[0]) if values else ""
            return str(parsed)

        # Standard decoding for other models
        else:
            generated_ids = outputs[0]
            input_length = outputs.shape[1] if len(outputs.shape) > 1 else 0
            response_tokens = generated_ids[input_length:]
            return self._processor.decode(response_tokens, skip_special_tokens=True)

    def _resolve_hf_name(self, model_key: str) -> str:
        """Resolve a registry key to a HuggingFace repo ID."""
        from app.services.model_registry import find_installed
        from app.services.model_catalog import catalog

        # Try registry first
        inst = find_installed(model_key)
        if inst and inst.hf_name:
            return inst.hf_name

        # Try catalog
        variant = catalog.get_variant(model_key)
        if variant and getattr(variant, "hf_name", None):
            return variant.hf_name

        # Already looks like an HF name (contains /)
        if "/" in model_key:
            return model_key

        return model_key

    def load(self, model_key: str) -> None:
        """Load model and processor into memory."""
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor

        hf_name = self._resolve_hf_name(model_key)
        logger.info(f"Loading transformers model: {model_key} -> {hf_name}")

        # Try to find model class from catalog
        model_class_name = self._detect_model_class(hf_name)

        # Load processor
        self._processor = AutoProcessor.from_pretrained(
            hf_name,
            trust_remote_code=True,
        )

        # Load model with appropriate class
        if model_class_name:
            try:
                model_cls = getattr(__import__("transformers", fromlist=[model_class_name]), model_class_name)
                self._model = model_cls.from_pretrained(
                    hf_name,
                    torch_dtype=torch.float16,
                    trust_remote_code=True,
                )
            except (AttributeError, ImportError):
                self._model = AutoModelForCausalLM.from_pretrained(
                    hf_name,
                    torch_dtype=torch.float16,
                    trust_remote_code=True,
                )
        else:
            try:
                self._model = AutoModelForCausalLM.from_pretrained(
                    hf_name,
                    torch_dtype=torch.float16,
                    device_map="auto",
                    trust_remote_code=True,
                )
            except (ValueError, RuntimeError):
                self._model = AutoModelForCausalLM.from_pretrained(
                    hf_name,
                    torch_dtype=torch.float16,
                    trust_remote_code=True,
                )

        # Move to GPU if available and model didn't auto-place
        if hasattr(self._model, 'device') and self._model.device.type == 'cpu' and torch.cuda.is_available():
            self._model = self._model.cuda()

        self._model_key = model_key
        self._loaded = True
        logger.info(f"Transformers model loaded: {model_key}")

    def _detect_model_class(self, model_key: str) -> Optional[str]:
        """Detect model class from config.json."""
        from huggingface_hub import hf_hub_download
        import json

        try:
            config_path = hf_hub_download(repo_id=model_key, filename="config.json")
            with open(config_path, "r") as f:
                config = json.load(f)

            # Check architectures field
            architectures = config.get("architectures", [])
            if architectures:
                return architectures[0]

            # Check _class_name field
            class_name = config.get("_class_name")
            if class_name:
                return class_name

        except Exception as e:
            logger.warning(f"Could not detect model class for {model_key}: {e}")

        return None

    def unload(self) -> None:
        """Free model resources."""
        import torch

        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None

        self._model_key = None
        self._loaded = False

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        logger.info("Transformers runner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        return {
            "prompt": {"has_default": False, "default": None},
            "image": {"has_default": False, "default": None},
            "max_new_tokens": {"has_default": True, "default": 512},
            "temperature": {"has_default": True, "default": 0.7},
            "do_sample": {"has_default": True, "default": True},
        }
