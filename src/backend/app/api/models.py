import os
import logging
import threading
from hashlib import md5
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from huggingface_hub import HfApi, hf_hub_download
from app.config import settings
from app.services.generator import VideoGenerator, SUPPORTED_MODELS
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

    def to_dict(self):
        d: dict = {
            "status": self.status,
            "progress_pct": round(self.progress_pct, 1),
            "current_file": self.current_file,
            "total_files": self.total_files,
            "downloaded_files": self.downloaded_files,
            "error_msg": self.error_msg,
        }
        if self.status == "done":
            d.update(self.result_data)
        return d


install_tasks: dict[str, InstallTask] = {}
tasks_lock = threading.Lock()


def _run_install(task_id: str, hf_name: str, alias: str):
    task = install_tasks.get(task_id)
    if not task:
        return

    try:
        task.status = "discovering"
        discovered = discover_pipeline(hf_name)
        if discovered is None:
            task.status = "error"
            task.error_msg = (
                f"Model '{hf_name}' is not a valid or supported pipeline. "
                f"Ensure it exists on HuggingFace and contains model weights."
            )
            return

        pipeline_class_name = discovered["pipeline_class"]
        tok = settings.hf_token or None

        task.status = "downloading"

        api = HfApi()
        files = api.list_repo_files(hf_name)
        weight_exts = (".safetensors", ".bin", ".pt", ".pth")
        weight_files = [f for f in files if f.endswith(weight_exts)]

        if not weight_files:
            task.status = "error"
            task.error_msg = f"Model '{hf_name}' has no weight files"
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
            installed_at=__import__("datetime").datetime.now().isoformat(),
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


BUILTIN_CATALOG: list[dict] = [
    {
        "key": "cogvideox-2b",
        "name": "CogVideoX-2b",
        "hf_name": "THUDM/CogVideoX-2b",
        "type": "builtin",
        "size_gb": 5.2,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["cogvideox-2b"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["cogvideox-2b"].get("default_scheduler", ""),
    },
    {
        "key": "cogvideox-5b",
        "name": "CogVideoX-5b",
        "hf_name": "THUDM/CogVideoX-5b",
        "type": "builtin",
        "size_gb": 10.0,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["cogvideox-5b"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["cogvideox-5b"].get("default_scheduler", ""),
    },
    {
        "key": "ltx-video",
        "name": "LTX-Video",
        "hf_name": "Lightricks/LTX-Video",
        "type": "builtin",
        "size_gb": 8.0,
        "cached": False,
        "loaded": False,
        "schedulers": list(SUPPORTED_MODELS["ltx-video"].get("schedulers", {}).keys()),
        "default_scheduler": SUPPORTED_MODELS["ltx-video"].get("default_scheduler", ""),
    },
    {
        "key": "wan2.2",
        "name": "Wan2.2",
        "hf_name": None,
        "type": "future",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
    {
        "key": "seedance",
        "name": "Seedance",
        "hf_name": None,
        "type": "api",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
    {
        "key": "kling",
        "name": "Kling",
        "hf_name": None,
        "type": "api",
        "size_gb": None,
        "cached": False,
        "loaded": False,
        "schedulers": [],
        "default_scheduler": None,
    },
]


def _build_model_entry(m: dict) -> dict:
    entry = dict(m)
    if m["hf_name"]:
        entry["cached"] = is_model_cached(m["hf_name"])
    entry["loaded"] = (
        _video_generator._current_model_key == m["key"]
        or _video_generator._current_v2v_model_key == m["key"]
    )
    return entry


@router.get("")
async def list_models():
    results = []
    for m in BUILTIN_CATALOG:
        results.append(_build_model_entry(m))
    for inst in list_installed():
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
        })
    return {"models": results}


class InstallRequest(BaseModel):
    hf_name: str
    alias: str = ""


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
            if t.hf_name == hf_name and t.status in ("pending", "discovering", "downloading"):
                return {"status": "already_in_progress", "task_id": tid}

    task_id = md5(hf_name.encode()).hexdigest()[:12]
    task = InstallTask(hf_name)
    with tasks_lock:
        install_tasks[task_id] = task

    thread = threading.Thread(
        target=_run_install,
        args=(task_id, hf_name, req.alias),
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
    import torch
    gpu = {}
    if torch.cuda.is_available():
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
    }
