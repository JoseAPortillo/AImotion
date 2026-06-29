import os
import json
import logging
from typing import Optional
from dataclasses import dataclass, asdict
from datetime import datetime

logger = logging.getLogger(__name__)

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "models_registry.json")


@dataclass
class InstalledModel:
    key: str
    hf_name: str
    alias: str
    pipeline_class: str
    dtype: str
    schedulers: dict[str, str]
    default_scheduler: str
    needs_token: bool
    defaults: dict
    installed_at: str


def _load_registry() -> list[dict]:
    path = os.path.abspath(REGISTRY_PATH)
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"Failed to load registry: {e}")
        return []


def _save_registry(entries: list[dict]):
    path = os.path.abspath(REGISTRY_PATH)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(entries, f, indent=2)


def list_installed() -> list[InstalledModel]:
    return [InstalledModel(**e) for e in _load_registry()]


def find_installed(key: str) -> Optional[InstalledModel]:
    for e in _load_registry():
        if e["key"] == key:
            return InstalledModel(**e)
    return None


def remove_installed(key: str) -> bool:
    entries = _load_registry()
    before = len(entries)
    entries = [e for e in entries if e["key"] != key]
    if len(entries) == before:
        return False
    _save_registry(entries)
    return True


def add_installed(model: InstalledModel):
    entries = _load_registry()
    entries = [e for e in entries if e["key"] != model.key]
    entries.append(asdict(model))
    _save_registry(entries)


def generate_key(hf_name: str) -> str:
    safe = hf_name.replace("/", "_").replace("-", "_").lower()
    existing = {e["key"] for e in _load_registry()}
    key = safe
    i = 1
    while key in existing:
        key = f"{safe}_{i}"
        i += 1
    return key


def hf_cache_path() -> str:
    return os.path.expanduser("~/.cache/huggingface/hub")


def is_model_cached(hf_name: str) -> bool:
    import glob
    safe = hf_name.replace("/", "--")
    pattern = f"models--{safe}*"
    cache_dir = hf_cache_path()
    if not os.path.isdir(cache_dir):
        return False
    return len(glob.glob(os.path.join(cache_dir, pattern))) > 0


KNOWN_PIPELINES = {
    "CogVideoXPipeline": {
        "module": "diffusers",
        "schedulers": {
            "cogvideox_ddim": "CogVideoXDDIMScheduler",
            "cogvideox_dpm": "CogVideoXDPMScheduler",
        },
        "default_scheduler": "cogvideox_ddim",
        "defaults": {
            "width": 720, "height": 480,
            "steps": 50, "cfg": 6.0,
            "num_frames": 49, "fps": 8,
            "max_seq": 226,
        },
    },
    "LTXPipeline": {
        "module": "diffusers",
        "schedulers": {
            "flow_match_euler": "FlowMatchEulerDiscreteScheduler",
            "flow_match_heun": "FlowMatchHeunDiscreteScheduler",
            "ltx_euler_ancestral_rf": "LTXEulerAncestralRFScheduler",
        },
        "default_scheduler": "flow_match_euler",
        "defaults": {
            "width": 704, "height": 512,
            "steps": 50, "cfg": 3.0,
            "num_frames": 97, "fps": 24,
            "max_seq": 256,
        },
    },
}


def discover_pipeline(hf_name: str) -> Optional[dict]:
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        info = api.model_info(hf_name)
        tags = {t.lower() for t in getattr(info, "tags", []) or []}
        pipeline_tag = getattr(info, "pipeline_tag", "") or ""

        logger.info(f"Model {hf_name}: pipeline_tag={pipeline_tag}, tags={tags}")

        supported = {
            "cogvideox": "CogVideoXPipeline",
            "ltx": "LTXPipeline",
        }

        cls_name = None
        for keyword, klass in supported.items():
            if keyword in tags or keyword in pipeline_tag:
                cls_name = klass
                break

        if not cls_name:
            for t in tags:
                if t in supported:
                    cls_name = supported[t]
                    break

        if not cls_name and "video" in pipeline_tag:
            cls_name = "CogVideoXPipeline"

        if cls_name and cls_name in KNOWN_PIPELINES:
            return {"pipeline_class": cls_name, **KNOWN_PIPELINES[cls_name]}

        logger.warning(f"Unsupported model {hf_name}: pipeline={pipeline_tag}, tags={tags}")
        return None

    except Exception as e:
        logger.warning(f"Failed to discover {hf_name}: {e}")
        return None
