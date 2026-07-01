import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class TimeEstimator:
    def __init__(self, total_steps: int):
        self._total_steps = total_steps
        self._start_time: Optional[float] = None
        self._current_step: int = 0
        self._step_timestamps: list[float] = []

    def start(self):
        self._start_time = time.time()
        self._step_timestamps.clear()
        self._current_step = 0

    def on_step(self, step: int):
        now = time.time()
        if self._start_time is None:
            self._start_time = now
        if step > self._current_step:
            self._current_step = step
            self._step_timestamps.append(now)

    @property
    def avg_time_per_step(self) -> Optional[float]:
        ts = self._step_timestamps
        if len(ts) < 2:
            return None
        return (ts[-1] - ts[0]) / (len(ts) - 1)

    @property
    def elapsed_sec(self) -> float:
        if self._start_time is None:
            return 0.0
        return time.time() - self._start_time

    @property
    def eta_sec(self) -> Optional[float]:
        avg = self.avg_time_per_step
        if avg is None or self._current_step >= self._total_steps:
            return None
        remaining = self._total_steps - self._current_step
        return avg * remaining

    def to_dict(self) -> dict:
        return {
            "elapsed_sec": round(self.elapsed_sec, 1),
            "avg_time_per_step": round(self.avg_time_per_step, 2) if self.avg_time_per_step is not None else None,
            "eta_sec": round(self.eta_sec, 1) if self.eta_sec is not None else None,
            "current_step": self._current_step,
            "total_steps": self._total_steps,
        }
