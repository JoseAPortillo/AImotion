import uuid
import asyncio
import logging
import os
import time
import threading
from typing import Optional
from app.models.generate import TaskStatus
from app.config import settings

logger = logging.getLogger(__name__)


class GenerationTask:
    def __init__(self, task_id: str, params: dict):
        self.task_id = task_id
        self.params = params
        self.status = TaskStatus.PENDING
        self.progress = 0.0
        self.current_step: Optional[int] = None
        self.total_steps: Optional[int] = None
        self.eta_sec: Optional[float] = None
        self.result_url: Optional[str] = None
        self.result_type: Optional[str] = None
        self.error: Optional[str] = None
        self.created_at = time.time()
        self.cancel_event = threading.Event()

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "progress": self.progress,
            "current_step": self.current_step,
            "total_steps": self.total_steps,
            "eta_sec": self.eta_sec,
            "result_url": self.result_url,
            "result_type": self.result_type,
            "error": self.error,
        }


class TaskManager:
    def __init__(self):
        self._tasks: dict[str, GenerationTask] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None

    async def create_task(self, params: dict) -> str:
        task_id = str(uuid.uuid4())
        async with self._lock:
            self._tasks[task_id] = GenerationTask(task_id, params)
        return task_id

    async def get_task(self, task_id: str) -> Optional[GenerationTask]:
        async with self._lock:
            return self._tasks.get(task_id)

    async def update_task(self, task_id: str, **kwargs):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                for key, value in kwargs.items():
                    setattr(task, key, value)

    async def set_running(self, task_id: str, total_steps: int):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = TaskStatus.RUNNING
                task.total_steps = total_steps

    async def set_progress(self, task_id: str, current_step: int, total_steps: int):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.current_step = current_step
                task.total_steps = total_steps
                task.progress = current_step / total_steps if total_steps > 0 else 0

    async def complete_task(self, task_id: str, result_url: str, result_type: str = "video"):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = TaskStatus.COMPLETED
                task.progress = 1.0
                task.result_url = result_url
                task.result_type = result_type

    async def fail_task(self, task_id: str, error: str):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = TaskStatus.FAILED
                task.error = error

    async def cancel_task(self, task_id: str):
        async with self._lock:
            task = self._tasks.get(task_id)
            if task and task.status in (TaskStatus.PENDING, TaskStatus.RUNNING):
                task.status = TaskStatus.CANCELLED
                task.cancel_event.set()

    async def start_cleanup(self):
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            now = time.time()
            ttl = settings.result_ttl_minutes * 60
            async with self._lock:
                expired = [
                    tid
                    for tid, task in self._tasks.items()
                    if task.status
                    in (TaskStatus.COMPLETED, TaskStatus.FAILED)
                    and (now - task.created_at) > ttl
                ]
                for tid in expired:
                    task = self._tasks.pop(tid, None)
                    if task and task.result_url:
                        filepath = task.result_url.lstrip("/results/")
                        full_path = os.path.join(settings.results_dir, filepath)
                        try:
                            if os.path.exists(full_path):
                                os.remove(full_path)
                        except OSError:
                            logger.warning(f"Failed to remove {full_path}")
                    if expired:
                        logger.info(f"Cleaned up {len(expired)} expired tasks")
