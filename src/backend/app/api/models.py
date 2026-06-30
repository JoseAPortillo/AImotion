import os
import logging
import threading
import subprocess
import sys
from datetime import datetime
from hashlib import md5
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from huggingface_hub import HfApi, hf_hub_download
from app.config import settings
from app.services.generator import VideoGenerator, get_model_config
from app.services.model_catalog import catalog
from app.services.model_registry import (
    list_installed, find_installed, add_installed, remove_installed,
    generate_key, is_model_cached, discover_pipeline,
    InstalledModel,
)

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


def detect_requirements(hf_name: str, discovered: dict) -> list[dict]:
    """Detect requirements for a model based on its format and pipeline."""
    requirements = []
    
    # Check if model has GGUF files
    try:
        api = HfApi()
        files = api.list_repo_files(hf_name)
        has_gguf = any(f.endswith('.gguf') or f.endswith('.ggufs') for f in files)
        
        if has_gguf:
            # GGUF models need llama-cpp-python or similar
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
    
    # Check manifest for additional requirements
    pipeline_class = discovered.get("pipeline_class", "")
    for fam in catalog.families:
        if fam.pipeline_class == pipeline_class:
            # Add any requirements from manifest (future enhancement)
            break
    
    return requirements


def install_requirements(requirements: list[dict]) -> tuple[bool, str]:
    """Install Python package requirements."""
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
            # Check if env var is set
            name = req["name"]
            if not os.environ.get(name):
                return False, f"Environment variable {name} is not set. Please set it before installing."
    
    return True, "All requirements installed successfully"


install_tasks: dict[str, InstallTask] = {}
tasks_lock = threading.Lock()


def _run_install(task_id: str, hf_name: str, alias: str, cache_dir: str = ""):
    task = install_tasks.get(task_id)
    if not task:
        return

    # Use provided cache_dir or fall back to settings
    if not cache_dir:
        cache_dir = settings.model_cache_dir

    try:
        task.status = "discovering"
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

        pipeline_class_name = discovered["pipeline_class"]
        tok = settings.hf_token or None

        # Detect requirements and wait for user confirmation
        task.requirements = detect_requirements(hf_name, discovered)
        if task.requirements:
            task.status = "waiting_for_confirmation"
            task.waiting_for_confirmation = True
            logger.info(f"Waiting for user confirmation to install {len(task.requirements)} requirement(s)")
            
            # Wait for confirmation (or cancellation)
            task.confirmation_event.wait()
            
            if task.cancel_event.is_set():
                task.status = "cancelled"
                return
            
            # Install requirements
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

        if not weight_files:
            task.status = "error"
            task.error_msg = f"Model '{hf_name}' has no weight files"
            logger.info(f"Install task {task_id} stopped: no weight files found")
            return

        def _get_file_size(filename: str) -> int:
            try:
                meta = api.model_info(hf_name, files_metadata=True)
                for sibling in meta.siblings or []:
                    if sibling.rfilename == filename:
                        return sibling.size or 0
            except Exception:
                pass
            return 0

        total_size = sum(_get_file_size(f) for f in weight_files)
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
        downloaded_size = 0
        task.total_files = len(weight_files)

        for i, fname in enumerate(weight_files):
            if task.cancel_event.is_set():
                task.status = "cancelled"
                return

            task.current_file = os.path.basename(fname)
            task.downloaded_files = i

            try:
                hf_hub_download(
                    repo_id=hf_name,
                    filename=fname,
                    token=tok,
                    resume_download=True,
                    cache_dir=cache_dir,
                )
            except Exception as e:
                if task.cancel_event.is_set():
                    task.status = "cancelled"
                    return
                task.status = "error"
                task.error_msg = f"Failed to download {fname}: {e}"
                return

            downloaded_size += _get_file_size(fname)
            task.progress_pct = (downloaded_size / total_size * 100) if total_size else \
                ((i + 1) / len(weight_files) * 100)
            task.downloaded_files = i + 1

        if task.cancel_event.is_set():
            task.status = "cancelled"
            return

        key = generate_key(hf_name)
        final_alias = alias or hf_name.split("/")[-1]
        model = InstalledModel(
            key=key,
            hf_name=hf_name,
            alias=final_alias,
            pipeline_class=pipeline_class_name,
            dtype=discovered.get("dtype", "float16"),
            schedulers=discovered["schedulers"],
            default_scheduler=discovered["default_scheduler"],
            needs_token=False,
            defaults=discovered["defaults"],
            installed_at=datetime.now().isoformat(),
        )
        add_installed(model)

        task.status = "done"
        task.result_data = {
            "model_key": key,
            "alias": final_alias,
            "pipeline_class": pipeline_class_name,
            "schedulers": model.schedulers,
        }
        task.progress_pct = 100.0

    except Exception as e:
        logger.error(f"Install task {task_id} failed: {e}")
        task.status = "error"
        task.error_msg = str(e)


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
    }


@router.get("")
async def list_models():
    results = []
    for v in catalog.all_variants():
        if v.type in ("builtin", "future", "api"):
            results.append(_build_variant_entry(v))
    for inst in list_installed():
        variant = catalog.get_variant(inst.key)
        if variant and variant.type == "builtin":
            continue
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
            "accepts": variant.accepts() if variant else {},
            "defaults": variant.defaults if variant else {"steps": 50, "cfg": 7.0},
            "inputs": variant.inputs if variant else {},
            "is_video": variant.is_video if variant else False,
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

    key = generate_key(hf_name)
    existing = find_installed(key)
    if existing and is_model_cached(hf_name):
        return {"status": "already_installed", "model_key": existing.key}

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
    remove_installed(model_key)
    return {"status": "uninstalled", "model_key": model_key}


@router.post("/unload")
async def unload_models():
    _video_generator.unload()
    return {"status": "unloaded"}


@router.get("/status")
async def models_status():
    gpu = {}
    try:
        import torch
        torch_ok = True
    except ModuleNotFoundError:
        torch_ok = False
    if torch_ok and torch.cuda.is_available():
        device = torch.cuda.current_device()
        name = torch.cuda.get_device_name(device)
        props = torch.cuda.get_device_properties(device)
        total = getattr(props, "total_memory", 0) / (1024 ** 3)
        free = (
            torch.cuda.mem_get_info(device)[0] / (1024 ** 3)
            if hasattr(torch.cuda, "mem_get_info")
            else total * 0.7
        )
        gpu = {
            "gpu_available": True,
            "gpu_name": name,
            "vram_total_gb": round(total, 1),
            "vram_free_gb": round(free, 1),
        }
    else:
        gpu = {"gpu_available": False}
    return {
        **gpu,
        "current_model": _video_generator._current_model_key,
        "current_v2v_model": _video_generator._current_v2v_model_key,
        "cache_dir": settings.model_cache_dir,
    }
