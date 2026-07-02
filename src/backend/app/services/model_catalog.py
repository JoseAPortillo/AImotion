import json
import logging
import os
from typing import Optional

from app.services.model_registry import find_installed
from app.services.diffusers_generator import infer_pipeline_params

logger = logging.getLogger(__name__)

_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")


class ModelFamily:
    def __init__(self, data: dict):
        self.family: str = data["family"]
        self.label: str = data.get("label", self.family)
        self.description: str = data.get("description", "")
        self.runner: str = data.get("runner", "diffusers")
        self._data = data
        self.variants: list[ModelVariant] = [
            ModelVariant(v, self) for v in data.get("variants", [])
        ]

    @property
    def pipeline_class(self) -> Optional[str]:
        p = self._data.get("pipeline")
        if p:
            return p.get("class")
        return None

    @property
    def is_video(self) -> bool:
        p = self._data.get("pipeline")
        return p.get("video_pipeline", False) if p else False

    @property
    def runner_install(self) -> Optional[dict]:
        return self._data.get("runner_install")

    @property
    def schedulers(self) -> dict[str, str]:
        return self._data.get("schedulers", {})

    @property
    def default_scheduler(self) -> Optional[str]:
        return self._data.get("default_scheduler")

    @property
    def defaults(self) -> dict:
        return self._data.get("defaults", {})

    @property
    def inputs(self) -> dict:
        return self._data.get("inputs", {})

    def accepts(self) -> dict:
        inputs = self.inputs
        has_video = any("video" in k.lower() for k in inputs.keys())
        return {
            "image": "image" in inputs,
            "video": has_video,
            "strength": "strength" in inputs,
        }

    def get_variant(self, key: str) -> Optional["ModelVariant"]:
        for v in self.variants:
            if v.key == key:
                return v
        return None


class ModelVariant:
    def __init__(self, data: dict, family: ModelFamily):
        self.key: str = data["key"]
        self.name: str = data.get("name", self.key)
        self.hf_name: Optional[str] = data.get("hf_name")
        self.type: str = data.get("type", "future")
        self.size_gb: Optional[float] = data.get("size_gb")
        self.dtype: Optional[str] = data.get("dtype")
        self.needs_token: bool = data.get("needs_token", False)
        self._family = family
        self._data = data

    @property
    def family(self) -> ModelFamily:
        return self._family

    def _pipe_data(self) -> dict:
        return self._data.get("pipeline") or {}

    @property
    def pipeline_class(self) -> Optional[str]:
        p = self._pipe_data()
        if p:
            return p.get("class")
        return self._family.pipeline_class

    @property
    def is_video(self) -> bool:
        p = self._pipe_data()
        if p:
            return p.get("video_pipeline", False)
        return self._family.is_video

    @property
    def schedulers(self) -> dict[str, str]:
        return self._data.get("schedulers") or self._family.schedulers

    @property
    def default_scheduler(self) -> Optional[str]:
        return self._data.get("default_scheduler") or self._family.default_scheduler

    @property
    def defaults(self) -> dict:
        return self._data.get("defaults") or self._family.defaults

    @property
    def inputs(self) -> dict:
        family_inputs = self._family.inputs
        variant_inputs = self._data.get("inputs") or {}
        if not variant_inputs:
            return family_inputs
        merged = {**family_inputs, **variant_inputs}
        return merged

    def accepts(self) -> dict:
        inputs = self.inputs
        has_video = any("video" in k.lower() for k in inputs.keys())
        return {
            "image": "image" in inputs,
            "video": has_video,
            "strength": "strength" in inputs,
        }

    def to_entry(self, cached: bool = False, loaded: bool = False) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "hf_name": self.hf_name,
            "type": self.type,
            "size_gb": self.size_gb,
            "cached": cached,
            "loaded": loaded,
            "pipeline_class": self.pipeline_class,
            "schedulers": list(self.schedulers.keys()),
            "default_scheduler": self.default_scheduler,
            "accepts": self.accepts(),
            "is_video": self.is_video,
        }


class ModelCatalog:
    def __init__(self):
        self._families: dict[str, ModelFamily] = {}
        self._by_key: dict[str, ModelVariant] = {}
        self._by_hf: dict[str, ModelVariant] = {}
        self._load()

    def _load(self):
        if not os.path.isdir(_MODELS_DIR):
            logger.warning("Models directory not found: %s", _MODELS_DIR)
            return
        for fname in sorted(os.listdir(_MODELS_DIR)):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(_MODELS_DIR, fname)
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                family = ModelFamily(data)
                self._families[family.family] = family
                for v in family.variants:
                    self._by_key[v.key] = v
                    if v.hf_name:
                        self._by_hf[v.hf_name] = v
                logger.info("Loaded model family: %s (%d variants)", family.family, len(family.variants))
            except Exception as e:
                logger.warning("Failed to load %s: %s", fname, e)

    def get_variant(self, key: str) -> Optional[ModelVariant]:
        v = self._by_key.get(key)
        if v:
            return v
        inst = find_installed(key)
        if inst:
            return self._make_installed_variant(inst)
        return None

    def get_family(self, family: str) -> Optional[ModelFamily]:
        return self._families.get(family)

    def all_variants(self) -> list[ModelVariant]:
        return list(self._by_key.values())

    def builtin_variants(self) -> list[ModelVariant]:
        return [v for v in self._by_key.values() if v.type == "builtin"]

    def _find_family_for_installed(self, inst) -> Optional[ModelFamily]:
        hf_lower = (inst.hf_name or "").lower()
        key_lower = (inst.key or "").lower()
        for fam in self._families.values():
            fam_lower = fam.family.lower()
            if fam_lower in hf_lower or fam_lower in key_lower:
                return fam
            label_lower = fam.label.lower()
            if label_lower != fam_lower and (label_lower in hf_lower or label_lower in key_lower):
                return fam
        return None

    def _make_installed_variant(self, inst) -> ModelVariant:
        family = self._find_family_for_installed(inst)
        inputs = family.inputs if family else _infer_inputs(inst.pipeline_class)
        defaults = inst.defaults or (family.defaults if family else {"steps": 50, "cfg": 7.0})
        schedulers = inst.schedulers or (family.schedulers if family else {})
        default_scheduler = inst.default_scheduler or (family.default_scheduler if family else "")
        is_video = _is_video_pipeline(inst.pipeline_class) or (family and family.is_video)
        runner = family.runner if family else "diffusers"
        dummy_family = ModelFamily({
            "family": inst.key or inst.hf_name,
            "label": inst.alias or inst.hf_name,
            "runner": runner,
            "pipeline": {"class": inst.pipeline_class, "video_pipeline": is_video} if inst.pipeline_class or is_video else None,
            "schedulers": schedulers,
            "default_scheduler": default_scheduler,
            "defaults": defaults,
            "inputs": inputs,
            "variants": [{
                "key": inst.key,
                "name": inst.alias or inst.hf_name,
                "hf_name": inst.hf_name,
                "type": "installed",
                "dtype": inst.dtype or "float16",
                "needs_token": inst.needs_token or False,
            }],
        })
        return dummy_family.get_variant(inst.key)

    @property
    def families(self) -> list[ModelFamily]:
        return list(self._families.values())


_INFERRED_VIDEO_PIPELINES = {
    "CogVideoXPipeline", "CogVideoXImageToVideoPipeline", "CogVideoXVideoToVideoPipeline",
    "LTXPipeline", "I2VGenXLPipeline", "StableVideoDiffusionPipeline",
    "AnimateDiffPipeline", "VideoToVideoPipeline", "TextToVideoSDPipeline",
    "WanAnimatePipeline", "WanVideoToVideoPipeline", "WanImageToVideoPipeline",
}


def _is_video_pipeline(pipeline_class: str) -> bool:
    """Detect if pipeline is video-based, dynamically from signature or fallback set."""
    params = infer_pipeline_params(pipeline_class)
    if params is not None:
        return "video" in params or "num_frames" in params or "fps" in params
    return pipeline_class in _INFERRED_VIDEO_PIPELINES


def _infer_inputs(pipeline_class: str | None) -> dict:
    if not pipeline_class:
        return {}
    params = infer_pipeline_params(pipeline_class)
    if not params:
        return {"prompt": {"required": True, "type": "text"}}
    inputs: dict = {}
    for pname, pinfo in params.items():
        if pname in ("prompt",):
            inputs[pname] = {"required": True, "type": "text"}
        elif pname in ("num_frames", "width", "height", "max_sequence_length", "decode_chunk_size", "fps", "motion_bucket_id"):
            inputs[pname] = {"required": False, "type": "int", "default": pinfo.get("default")}
        elif pname in ("guidance_scale", "num_inference_steps"):
            pass  # mapped to cfg/steps from defaults
        elif pname in ("min_guidance_scale", "max_guidance_scale", "noise_aug_strength"):
            inputs[pname] = {"required": False, "type": "float", "default": pinfo.get("default", 0.0)}
        elif pname == "strength":
            inputs[pname] = {"required": False, "type": "float", "default": pinfo.get("default", 0.8), "min": 0, "max": 1}
        elif pname == "image":
            inputs[pname] = {"required": False, "type": "image"}
        elif pname == "video":
            inputs[pname] = {"required": False, "type": "video"}
        else:
            default_val = pinfo.get("default")
            if isinstance(default_val, float):
                inputs[pname] = {"required": False, "type": "float", "default": default_val}
            elif isinstance(default_val, bool):
                inputs[pname] = {"required": False, "type": "bool", "default": default_val}
            elif isinstance(default_val, int):
                inputs[pname] = {"required": False, "type": "int", "default": default_val}
            elif isinstance(default_val, str):
                inputs[pname] = {"required": False, "type": "text", "default": default_val}
            else:
                inputs[pname] = {"required": False, "type": "float", "default": default_val}
    return inputs


catalog = ModelCatalog()
