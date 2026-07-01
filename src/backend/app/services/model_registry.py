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
    from app.config import settings
    return os.path.join(settings.model_cache_dir, "hub")


def is_model_cached(hf_name: str) -> bool:
    import glob
    safe = hf_name.replace("/", "--")
    pattern = f"models--{safe}*"
    cache_dir = hf_cache_path()
    if not os.path.isdir(cache_dir):
        return False
    return len(glob.glob(os.path.join(cache_dir, pattern))) > 0


def remove_cached(hf_name: str):
    import glob, shutil
    safe = hf_name.replace("/", "--")
    pattern = f"models--{safe}*"
    cache_dir = hf_cache_path()
    if not os.path.isdir(cache_dir):
        return
    for entry in glob.glob(os.path.join(cache_dir, pattern)):
        if os.path.isdir(entry):
            shutil.rmtree(entry, ignore_errors=True)
            logger.info(f"Deleted cached model: {entry}")
        elif os.path.isfile(entry):
            os.remove(entry)
            logger.info(f"Deleted cached file: {entry}")


def _catalog_families():
    from app.services.model_catalog import catalog
    return catalog.families


def _catalog_family_for_pipeline(pipeline_class: str):
    for fam in _catalog_families():
        if fam.pipeline_class == pipeline_class:
            return fam
    return None




def _read_hf_json(hf_name: str, filename: str) -> Optional[dict]:
    try:
        import requests
        url = f"https://huggingface.co/{hf_name}/raw/main/{filename}"
        resp = requests.get(url, timeout=10, headers={"User-Agent": "AImation/0.1"})
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def _read_scheduler_config(hf_name: str, comp_name: str) -> Optional[dict]:
    candidates = [
        f"{comp_name}/config.json",
        f"{comp_name}/{comp_name}_config.json",
        f"{comp_name}/scheduler_config.json",
    ]
    for path in candidates:
        cfg = _read_hf_json(hf_name, path)
        if cfg and "_class_name" in cfg:
            return cfg
    return None


def _list_hf_files(hf_name: str) -> list[str]:
    try:
        from huggingface_hub import HfApi
        return HfApi().list_repo_files(hf_name)
    except Exception:
        return []


def discover_pipeline(hf_name: str) -> dict:
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        info = api.model_info(hf_name)
        tags = {t.lower() for t in getattr(info, "tags", []) or []}
        pipeline_tag = getattr(info, "pipeline_tag", "") or ""

        logger.info(f"Model {hf_name}: pipeline_tag={pipeline_tag}, tags={tags}")

        files = _list_hf_files(hf_name)
        weight_exts = (".safetensors", ".bin", ".pt", ".pth", ".gguf", ".ggufs")
        has_weights = any(f.endswith(weight_exts) for f in files)
        if not has_weights:
            logger.warning(f"Model {hf_name} has no weight files (non-model repo)")
            return {"error": "no_weights"}

        pipeline_class = None
        schedulers: dict[str, str] = {}

        model_index = _read_hf_json(hf_name, "model_index.json")
        if model_index:
            pipeline_class = model_index.get("_class_name", "")
            if not pipeline_class:
                logger.warning(f"Model {hf_name} has model_index.json but no _class_name")
                return {"error": "no_class_name"}

            for comp_name, comp_info in model_index.items():
                if comp_name.startswith("_"):
                    continue
                if not isinstance(comp_info, (list, tuple)) or len(comp_info) < 2:
                    continue
                class_name = comp_info[1]
                if not isinstance(class_name, str):
                    continue
                if "scheduler" in class_name.lower():
                    cfg = _read_scheduler_config(hf_name, comp_name)
                    if cfg and "_class_name" in cfg:
                        schedulers[comp_name] = cfg["_class_name"]

        if not pipeline_class:
            config = _read_hf_json(hf_name, "config.json")
            if config:
                pipeline_class = config.get("_class_name", "")
            if not pipeline_class:
                supported_keywords = {}
                for fam in _catalog_families():
                    pc = fam.pipeline_class
                    if pc:
                        supported_keywords[fam.family] = pc
                supported_keywords.setdefault("cogvideox", "CogVideoXPipeline")
                supported_keywords.setdefault("ltx", "LTXPipeline")
                for keyword, klass in supported_keywords.items():
                    if keyword in tags or keyword in pipeline_tag:
                        pipeline_class = klass
                        break
                if not pipeline_class:
                    for t in tags:
                        if t in supported_keywords:
                            pipeline_class = supported_keywords[t]
                            break
            if not pipeline_class and "video" in pipeline_tag:
                pipeline_class = "CogVideoXPipeline"
            if not pipeline_class and "image" in pipeline_tag:
                pipeline_class = "StableDiffusionXLPipeline"

        if not pipeline_class:
            logger.warning(f"Unsupported model {hf_name}: pipeline={pipeline_tag}, tags={tags}")
            return {"error": "unsupported_pipeline"}

        fam = _catalog_family_for_pipeline(pipeline_class)
        known = {}
        if fam:
            known = {
                "schedulers": fam.schedulers,
                "default_scheduler": fam.default_scheduler,
                "defaults": fam.defaults,
            }
        if not schedulers:
            schedulers = dict(known.get("schedulers", {}))

        default_scheduler = known.get("default_scheduler", "")
        if not default_scheduler and schedulers:
            default_scheduler = list(schedulers.keys())[0]

        is_video = (fam.is_video if fam else False) or "video" in pipeline_tag
        dtype = "bfloat16" if is_video else "float16"

        return {
            "pipeline_class": pipeline_class,
            "schedulers": schedulers,
            "default_scheduler": default_scheduler,
            "dtype": dtype,
            "defaults": known.get("defaults", {"steps": 50, "cfg": 7.0}),
        }

    except Exception as e:
        logger.warning(f"Failed to discover {hf_name}: {e}")
        return {"error": f"discovery failed: {e}"}
