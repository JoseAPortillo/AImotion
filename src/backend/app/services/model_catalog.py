import json
import logging
import os
from typing import Optional

from app.services.model_registry import find_installed, is_model_cached
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
        return {
            "image": "image" in inputs,
            "video": "video" in inputs,
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

    @property
    def pipeline_class(self) -> Optional[str]:
        return self._family.pipeline_class

    @property
    def is_video(self) -> bool:
        return self._family.is_video

    @property
    def schedulers(self) -> dict[str, str]:
        return self._family.schedulers

    @property
    def default_scheduler(self) -> Optional[str]:
        return self._family.default_scheduler

    @property
    def defaults(self) -> dict:
        return self._family.defaults

    @property
    def inputs(self) -> dict:
        return self._family.inputs

    def accepts(self) -> dict:
        return self._family.accepts()

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
        if inst and is_model_cached(inst.hf_name):
            return self._make_installed_variant(inst)
        return None

    def get_family(self, family: str) -> Optional[ModelFamily]:
        return self._families.get(family)

    def all_variants(self) -> list[ModelVariant]:
        return list(self._by_key.values())

    def builtin_variants(self) -> list[ModelVariant]:
        return [v for v in self._by_key.values() if v.type == "builtin"]

    def _make_installed_variant(self, inst) -> ModelVariant:
        dummy_family = ModelFamily({
            "family": inst.key or inst.hf_name,
            "label": inst.alias or inst.hf_name,
            "pipeline": {"class": inst.pipeline_class, "video_pipeline": inst.pipeline_class in _INFERRED_VIDEO_PIPELINES} if inst.pipeline_class else None,
            "schedulers": inst.schedulers or {},
            "default_scheduler": inst.default_scheduler,
            "defaults": inst.defaults or {"steps": 50, "cfg": 7.0},
            "inputs": _infer_inputs(inst.pipeline_class),
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
}


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
        elif pname in ("num_frames", "width", "height", "max_sequence_length"):
            inputs[pname] = {"required": False, "type": "int", "default": pinfo.get("default")}
        elif pname in ("guidance_scale", "num_inference_steps"):
            pass
        elif pname == "strength":
            inputs[pname] = {"required": False, "type": "float", "default": pinfo.get("default", 0.8), "min": 0, "max": 1}
        elif pname == "image":
            inputs[pname] = {"required": False, "type": "image"}
        elif pname == "video":
            inputs[pname] = {"required": False, "type": "video"}
        else:
            inputs[pname] = {"required": False, "type": "text"}
    return inputs


catalog = ModelCatalog()
