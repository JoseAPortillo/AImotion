from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class HealthResponse:
    status: str
    service: str
    gpu_available: bool
    gpu_name: Optional[str] = None
    vram_total_gb: Optional[float] = None
    vram_free_gb: Optional[float] = None


@dataclass
class TaskInfo:
    task_id: str
    status: TaskStatus
    progress: float = 0.0
    current_step: Optional[int] = None
    total_steps: Optional[int] = None
    eta_sec: Optional[float] = None
    result_url: Optional[str] = None
    error: Optional[str] = None


@dataclass
class GenerateResponse:
    task_id: str
    status: TaskStatus
