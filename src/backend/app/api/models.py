import os
import logging
import threading
import subprocess
import sys
import importlib
from datetime import datetime
from hashlib import md5
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from huggingface_hub import HfApi, hf_hub_download
from app.config import settings
from app.services.generator import VideoGenerator, get_model_config
from app.services.model_catalog import catalog
from app.services.diffusers_generator import infer_pipeline_params
from app.services.model_registry import (
    list_installed, find_installed, add_installed, remove_installed,
    remove_cached, generate_key, is_model_cached, discover_pipeline,
    InstalledModel,
)
from app.services.runners.registry import RunnerRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models", tags=["models"])

_video_generator = VideoGenerator()


class InstallTask:
    def __init__(self, hf_name: str):
        self.hf_name = hf_name
        self.status = "pending"
        self.progress_pct = 0.0
        self.current_file = ""
        self.total_files = 0
        self.downloaded_files = 0
        self.error_msg = ""
        self.cancel_event = threading.Event()
        self.result_data: dict = {}
        self._thread: threading.Thread | None = None
        self.requirements: list[dict] = []
        self.waiting_for_confirmation = False
        self.confirmation_event = threading.Event()

    def to_dict(self):
        d: dict = {
            "status": self.status,
            "progress_pct": round(self.progress_pct, 1),
            "current_file": self.current_file,
            "total_files": self.total_files,
            "downloaded_files": self.downloaded_files,
            "error_msg": self.error_msg,
        }
        if self.requirements:
            d["requirements"] = self.requirements
        if self.waiting_for_confirmation:
            d["waiting_for_confirmation"] = True
        if self.status == "done":
            d.update(self.result_data)
        return d


def _find_matching_family(hf_name: str):
    """Find a catalog family whose name appears in the HuggingFace repo name."""
    hf_lower = hf_name.lower()
    for fam in catalog.families:
        if fam.runner == "diffusers":
            continue
        if fam.family.lower() in hf_lower:
            return fam
        label_lower = fam.label.lower()
        if label_lower != fam.family.lower() and label_lower in hf_lower:
            return fam
    return None


def detect_requirements(hf_name: str, discovered: dict) -> list[dict]:
    """Detect requirements for a model based on its format and pipeline."""
    requirements = []
    family = _find_matching_family(hf_name)

    # Check if model has GGUF files
    try:
        api = HfApi()
        files = api.list_repo_files(hf_name)
        has_gguf = any(f.endswith('.gguf') or f.endswith('.ggufs') for f in files)

        if has_gguf:
            skip_gguf_reason = False
            if family:
                skip_gguf_reason = family.runner in ("gguf", "wan2.2")
            if not skip_gguf_reason:
                requirements.append({
                    "type": "python_package",
                    "package": "llama-cpp-python",
                    "reason": "Required for loading GGUF format models",
                    "optional": False,
                })
    except Exception as e:
        logger.warning(f"Could not check files for requirements: {e}")

    # Check if model needs HF token (gated models)
    try:
        api = HfApi()
        info = api.model_info(hf_name)
        if getattr(info, 'private', False) or getattr(info, 'gated', False):
            requirements.append({
                "type": "env_var",
                "name": "HF_TOKEN",
                "reason": "Required for accessing gated/private models",
                "optional": False,
            })
    except Exception as e:
        logger.warning(f"Could not check model access requirements: {e}")

    # Check if the model's family needs a custom runner or pip deps
    if family and family.runner not in ("diffusers",):
        if not RunnerRegistry.is_registered(family.runner):
            ri = family.runner_install
            if ri:
                requirements.append({
                    "type": "runner",
                    "runner_key": family.runner,
                    "package": ri.get("package"),
                    "url": ri.get("url"),
                    "entry": ri.get("entry"),
                    "reason": f"Required runner for {family.label} models",
                    "optional": True,
                })
        # For wan2.2, always add stable-diffusion-cpp-python even if runner is built-in
        if family.runner == "wan2.2":
            requirements.append({
                "type": "python_package",
                "package": "stable-diffusion-cpp-python",
                "reason": "Required Python package for Wan2.2 GGUF video generation",
                "optional": False,
            })

    return requirements


def install_requirements(requirements: list[dict]) -> tuple[bool, str]:
    """Install Python package and runner requirements."""
    for req in requirements:
        if req["type"] == "python_package":
            package = req["package"]
            logger.info(f"Installing Python package: {package}")
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", package],
                    capture_output=True,
                    text=True,
                    timeout=300,
                )
                if result.returncode != 0:
                    return False, f"Failed to install {package}: {result.stderr}"
                logger.info(f"Successfully installed {package}")
            except subprocess.TimeoutExpired:
                return False, f"Timeout installing {package}"
            except Exception as e:
                return False, f"Error installing {package}: {e}"
        elif req["type"] == "env_var":
            name = req["name"]
            if not os.environ.get(name):
                return False, f"Environment variable {name} is not set. Please set it before installing."
        elif req["type"] == "runner":
            runner_key = req["runner_key"]
            package = req.get("package")
            url = req.get("url")
            install_target = url or package
            if install_target:
                try:
                    logger.info(f"Installing runner '{runner_key}' from {install_target}")
                    result = subprocess.run(
                        [sys.executable, "-m", "pip", "install", install_target],
                        capture_output=True, text=True, timeout=300,
                    )
                    if result.returncode == 0:
                        logger.info(f"Runner '{runner_key}' installed successfully")
                        _register_runner_from_package(runner_key, req)
                    else:
                        logger.warning(
                            f"Runner '{runner_key}' pip install failed (non-fatal): "
                            f"{result.stderr[:200]}"
                        )
                except subprocess.TimeoutExpired:
                    logger.warning(f"Runner '{runner_key}' pip install timed out (non-fatal)")
                except Exception as e:
                    logger.warning(f"Runner '{runner_key}' install error (non-fatal): {e}")
            else:
                _register_runner_from_package(runner_key, req)

    return True, "All requirements installed successfully"


def _register_runner_from_package(runner_key: str, req: dict):
    entry = req.get("entry")
    if not entry:
        return
    try:
        mod = importlib.import_module(entry)
        get_runner = getattr(mod, "get_runner_class", None)
        if get_runner:
            runner_cls = get_runner()
            RunnerRegistry.register(runner_key, runner_cls())
            logger.info("Runner '%s' registered dynamically", runner_key)
    except Exception as e:
        logger.warning(f"Failed to auto-register runner '{runner_key}': {e}")


install_tasks: dict[str, InstallTask] = {}
tasks_lock = threading.Lock()


def _run_install(task_id: str, hf_name: str, alias: str, cache_dir: str = ""):
    task = install_tasks.get(task_id)
    if not task:
        return

    if not cache_dir:
        cache_dir = settings.model_cache_dir

    try:
        task.status = "discovering"
        family = _find_matching_family(hf_name)

        hf_pipeline_tag = ""

        if family and family.runner != "diffusers":
            pipeline_class_name = None
            schedulers: dict = {}
            default_scheduler = ""
            defaults: dict = family.defaults or {"steps": 50, "cfg": 7.0}
            discovered: dict = {}
            try:
                api = HfApi()
                info = api.model_info(hf_name)
                hf_pipeline_tag = getattr(info, "pipeline_tag", "") or ""
            except Exception:
                pass
            logger.info(
                f"Non-diffusers family '{family.family}' for {hf_name} "
                f"(pipeline_tag={hf_pipeline_tag}), skipping pipeline detection"
            )
        else:
            discovered = discover_pipeline(hf_name)
            if "error" in discovered:
                task.status = "error"
                reasons = {
                    "no_weights": (
                        f"'{hf_name}' is not a standalone model — it has no weight files (.safetensors, .bin). "
                        f"This is likely a LoRA, motion adapter, ControlNet, or other component meant to be "
                        f"used with another model. You cannot install it alone."
                    ),
                    "no_class_name": (
                        f"'{hf_name}' has a model_index.json but no _class_name field, "
                        f"so the pipeline type can't be identified. It may be a component "
                        f"rather than a standalone model."
                    ),
                    "unsupported_pipeline": (
                        f"'{hf_name}' is not a supported model type. "
                        f"Only image and video generation pipelines are supported."
                    ),
                }
                task.error_msg = reasons.get(
                    discovered["error"],
                    f"'{hf_name}' cannot be installed: {discovered['error']}"
                )
                return
            else:
                pipeline_class_name = discovered["pipeline_class"]
                schedulers = discovered["schedulers"]
                default_scheduler = discovered["default_scheduler"]
                defaults = discovered.get("defaults", {"steps": 50, "cfg": 7.0})
                hf_pipeline_tag = discovered.get("pipeline_tag", "")

        tok = settings.hf_token or None

        # Detect requirements and wait for user confirmation
        task.requirements = detect_requirements(hf_name, discovered)
        if task.requirements:
            task.status = "waiting_for_confirmation"
            task.waiting_for_confirmation = True
            logger.info(f"Waiting for user confirmation to install {len(task.requirements)} requirement(s)")

            task.confirmation_event.wait()

            if task.cancel_event.is_set():
                task.status = "cancelled"
                return

            task.status = "installing_requirements"
            task.waiting_for_confirmation = False
            logger.info(f"Installing {len(task.requirements)} requirement(s)")

            success, msg = install_requirements(task.requirements)
            if not success:
                task.status = "error"
                task.error_msg = f"Failed to install requirements: {msg}"
                return

            logger.info("All requirements installed successfully")

        task.status = "downloading"

        api = HfApi()
        files = api.list_repo_files(hf_name)
        weight_exts = (".safetensors", ".bin", ".pt", ".pth", ".gguf", ".ggufs")
        weight_files = [f for f in files if f.endswith(weight_exts)]

        has_model_index = "model_index.json" in files
        if has_model_index:
            download_weights = weight_files
            checkpoint_file = ""
        else:
            checkpoint_file = weight_files[0] if weight_files else ""
            download_weights = [checkpoint_file] if checkpoint_file else []

        if not download_weights:
            task.status = "error"
            task.error_msg = f"Model '{hf_name}' has no weight files"
            logger.info(f"Install task {task_id} stopped: no weight files found")
            return

        # Files required by from_pretrained (configs, tokenizer, scheduler)
        _cfg_exts = (".json", ".model", ".txt", ".py")
        _cfg_prefixes = ("model_index.json", "scheduler/", "tokenizer/", "feature_extractor/")
        config_files = [
            f for f in files
            if f not in weight_files
            and (f.endswith(_cfg_exts) or f.startswith(_cfg_prefixes))
            and not f.endswith(("-workflow.json",))
            and not f.startswith(".")
        ]

        def _get_file_size(filename: str) -> int:
            try:
                meta = api.model_info(hf_name, files_metadata=True)
                for sibling in meta.siblings or []:
                    if sibling.rfilename == filename:
                        return sibling.size or 0
            except Exception:
                pass
            return 0

        total_weight_size = sum(_get_file_size(f) for f in download_weights)
        total_config_size = sum(_get_file_size(f) for f in config_files)
        total_size = total_weight_size + total_config_size
        if total_size > 0:
            import shutil
            os.makedirs(cache_dir, exist_ok=True)
            free_bytes = shutil.disk_usage(cache_dir).free
            needed = total_size + (1024 ** 3)
            if free_bytes < needed:
                free_gb = free_bytes / (1024 ** 3)
                needed_gb = needed / (1024 ** 3)
                task.status = "error"
                task.error_msg = (
                    f"Not enough disk space. Need ~{needed_gb:.1f} GB free, "
                    f"but only {free_gb:.1f} GB available. "
                    f"Free up space or choose a smaller model."
                )
                return

        def _download_file(fname: str) -> bool:
            try:
                hf_hub_download(
                    repo_id=hf_name,
                    filename=fname,
                    token=tok,
                    resume_download=True,
                    cache_dir=cache_dir,
                )
                return True
            except Exception as e:
                if task.cancel_event.is_set():
                    return False
                task.status = "error"
                task.error_msg = f"Failed to download {fname}: {e}"
                return False

        # Download config files first (small files, needed for from_pretrained)
        task.total_files = len(config_files) + len(download_weights)
        task.current_file = "config files"
        for i, fname in enumerate(config_files):
            if task.cancel_event.is_set():
                task.status = "cancelled"
                return
            task.downloaded_files = i
            if not _download_file(fname):
                return
            task.downloaded_files = i + 1

        # Download weight files with progress tracking
        downloaded_weight_size = 0
        task.current_file = ""
        for i, fname in enumerate(download_weights):
            if task.cancel_event.is_set():
                task.status = "cancelled"
                return

            task.current_file = os.path.basename(fname)
            task.downloaded_files = len(config_files) + i

            if not _download_file(fname):
                return

            downloaded_weight_size += _get_file_size(fname)
            task.progress_pct = ((total_config_size + downloaded_weight_size) / total_size * 100) if total_size else \
                ((len(config_files) + i + 1) / (len(config_files) + len(download_weights)) * 100)
            task.downloaded_files = len(config_files) + i + 1

        if task.cancel_event.is_set():
            task.status = "cancelled"
            return

        cat_variants = catalog.get_variants_by_hf(hf_name)
        key = cat_variants[0].key if cat_variants else generate_key(hf_name)
        for existing in list_installed():
            if existing.hf_name == hf_name and existing.key != key:
                logger.info(f"Removing stale registry entry '{existing.key}' for {hf_name}")
                remove_installed(existing.key)
        final_alias = alias or hf_name.split("/")[-1]
        model = InstalledModel(
            key=key,
            hf_name=hf_name,
            alias=final_alias,
            pipeline_class=pipeline_class_name or "",
            dtype=discovered.get("dtype", "float16"),
            schedulers=schedulers,
            default_scheduler=default_scheduler,
            needs_token=False,
            defaults=defaults,
            installed_at=datetime.now().isoformat(),
            hf_pipeline_tag=hf_pipeline_tag,
            repo_files=files,
            checkpoint_file=checkpoint_file,
        )
        add_installed(model)

        task.status = "done"
        task.result_data = {
            "model_key": key,
            "alias": final_alias,
            "pipeline_class": pipeline_class_name,
            "schedulers": schedulers,
        }
        task.progress_pct = 100.0

    except Exception as e:
        logger.error(f"Install task {task_id} failed: {e}")
        task.status = "error"
        task.error_msg = str(e)


def _is_diffusers_pipeline(pipeline_class: str) -> bool:
    """Check if pipeline_class is a valid diffusers pipeline."""
    try:
        import diffusers
        return hasattr(diffusers, pipeline_class)
    except Exception:
        return False


def _inputs_from_pipeline(pipeline_class: str) -> dict:
    """Infer inputs from pipeline class for installed models without a catalog variant."""
    params = infer_pipeline_params(pipeline_class)
    if params is None:
        return {}
    inputs = {}
    for pname, pinfo in params.items():
        inputs[pname] = {
            "has_default": pinfo.get("has_default", False),
            "default": pinfo.get("default"),
        }
    return inputs


def _accepts_from_pipeline(pipeline_class: str) -> dict:
    inputs = _inputs_from_pipeline(pipeline_class)
    return {
        "image": "image" in inputs,
        "video": "video" in inputs,
        "strength": "strength" in inputs,
    }


def _build_variant_entry(variant) -> dict:
    hf_name = variant.hf_name
    return {
        "key": variant.key,
        "name": variant.name,
        "hf_name": hf_name,
        "type": variant.type,
        "size_gb": variant.size_gb,
        "cached": is_model_cached(hf_name) if hf_name else False,
        "loaded": _video_generator._current_model_key == variant.key,
        "pipeline_class": variant.pipeline_class,
        "schedulers": list(variant.schedulers.keys()),
        "default_scheduler": variant.default_scheduler,
        "accepts": variant.accepts(),
        "defaults": variant.defaults,
        "inputs": variant.inputs,
        "is_video": variant.is_video,
        "runner": variant.family.runner,
        "pricing": variant._data.get("pricing"),
        "resolutions": variant._data.get("resolutions"),
    }


@router.get("")
async def list_models():
    results = []
    installed_list = list_installed()
    installed_keys = {inst.key for inst in installed_list}
    for v in catalog.all_variants():
        if v.type in ("builtin", "future", "api", "installable"):
            if v.key in installed_keys:
                continue
            if v.type != "api" and (v.hf_name is None or not is_model_cached(v.hf_name)):
                continue
            results.append(_build_variant_entry(v))
    for inst in installed_list:
        variant = catalog.get_variant(inst.key)
        if variant and variant.type == "builtin":
            continue
        if variant:
            pipeline_inputs = variant.inputs
            pipeline_accepts = variant.accepts()
            pipeline_defaults = variant.defaults
            is_video = variant.is_video
            runner = variant.family.runner
            if inst.pipeline_class and _is_diffusers_pipeline(inst.pipeline_class):
                runner = "diffusers"
        elif inst.pipeline_class:
            pipeline_inputs = _inputs_from_pipeline(inst.pipeline_class)
            pipeline_accepts = _accepts_from_pipeline(inst.pipeline_class)
            pipeline_defaults = inst.defaults or {"steps": 50, "cfg": 7.0}
            is_video = "video" in inst.pipeline_class.lower()
            runner = "diffusers"
        else:
            pipeline_inputs = {}
            pipeline_accepts = {}
            pipeline_defaults = {"steps": 50, "cfg": 7.0}
            is_video = False
            runner = "diffusers"
        results.append({
            "key": inst.key,
            "name": inst.alias or inst.hf_name,
            "hf_name": inst.hf_name,
            "type": "installed",
            "size_gb": None,
            "cached": is_model_cached(inst.hf_name),
            "loaded": _video_generator._current_model_key == inst.key,
            "schedulers": list(inst.schedulers.keys()),
            "default_scheduler": inst.default_scheduler,
            "alias": inst.alias,
            "pipeline_class": inst.pipeline_class,
            "accepts": pipeline_accepts,
            "defaults": pipeline_defaults,
            "inputs": pipeline_inputs,
            "is_video": is_video,
            "runner": runner,
        })
    return {"models": results}


class InstallRequest(BaseModel):
    hf_name: str
    alias: str = ""
    cache_dir: str = ""


@router.post("/install")
async def install_model(req: InstallRequest):
    hf_name = req.hf_name.strip()
    if not hf_name:
        raise HTTPException(status_code=422, detail="hf_name is required")

    cat_variants = catalog.get_variants_by_hf(hf_name)
    key = cat_variants[0].key if cat_variants else generate_key(hf_name)
    existing = find_installed(key)
    if existing and is_model_cached(hf_name):
        return {"status": "already_installed", "model_key": existing.key}
    for existing in list_installed():
        if existing.hf_name == hf_name and existing.key != key:
            logger.info(f"Cleaning up stale entry '{existing.key}' for {hf_name}")
            remove_installed(existing.key)

    with tasks_lock:
        for tid, t in install_tasks.items():
            if t.hf_name == hf_name and t.status in ("pending", "discovering", "downloading", "waiting_for_confirmation", "installing_requirements"):
                return {"status": "already_in_progress", "task_id": tid}

    task_id = md5(hf_name.encode()).hexdigest()[:12]
    task = InstallTask(hf_name)
    with tasks_lock:
        install_tasks[task_id] = task

    cache_dir = req.cache_dir.strip() if req.cache_dir else settings.model_cache_dir

    thread = threading.Thread(
        target=_run_install,
        args=(task_id, hf_name, req.alias, cache_dir),
        daemon=True,
    )
    task._thread = thread
    thread.start()

    return {"status": "started", "task_id": task_id}


@router.get("/install/{task_id}/progress")
async def install_progress(task_id: str):
    with tasks_lock:
        task = install_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()


@router.post("/install/{task_id}/confirm")
async def confirm_install(task_id: str):
    with tasks_lock:
        task = install_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "waiting_for_confirmation":
        raise HTTPException(status_code=400, detail=f"Task is not waiting for confirmation (current status: {task.status})")

    task.confirmation_event.set()
    return {"status": "confirmed", "message": "Installation will continue"}


@router.delete("/install/{task_id}")
async def cancel_install(task_id: str):
    with tasks_lock:
        task = install_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status in ("done", "error", "cancelled"):
        return {"status": task.status}
    task.cancel_event.set()
    return {"status": "cancelling"}


class UpdateAliasRequest(BaseModel):
    alias: str


@router.get("/{model_key}/signature")
async def model_signature(model_key: str):
    variant = catalog.get_variant(model_key)
    if variant is None:
        raise HTTPException(status_code=404, detail="Model not found")
    inputs = variant.inputs
    return {
        pname: {
            "has_default": "default" in pinfo,
            "default": pinfo.get("default"),
        }
        for pname, pinfo in inputs.items()
    }


@router.put("/{model_key}")
async def update_model(model_key: str, req: UpdateAliasRequest):
    model = find_installed(model_key)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    model.alias = req.alias
    add_installed(model)
    return {"status": "updated", "model_key": model_key, "alias": req.alias}


@router.delete("/{model_key}")
async def uninstall_model(model_key: str):
    model = find_installed(model_key)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found in registry")
    if _video_generator._current_model_key == model_key:
        _video_generator.unload()
    hf_name = model.hf_name
    remove_installed(model_key)
    if hf_name:
        remove_cached(hf_name)
    return {"status": "uninstalled", "model_key": model_key, "cleaned_cache": bool(hf_name)}


@router.post("/unload")
async def unload_models():
    _video_generator.unload()
    return {"status": "unloaded"}


@router.get("/status")
async def models_status():
    from app.api.hardware import _get_vram_info
    vram = _get_vram_info()
    gpu = {
        "gpu_available": vram.get("gpu_available", False),
        "gpu_name": vram.get("gpu_name"),
        "vram_total_gb": vram.get("vram_total_gb"),
        "vram_free_gb": vram.get("vram_free_gb"),
    }
    return {
        **gpu,
        "current_model": _video_generator._current_model_key,
        "current_v2v_model": _video_generator._current_v2v_model_key,
        "cache_dir": settings.model_cache_dir,
    }
