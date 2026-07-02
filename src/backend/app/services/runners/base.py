import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Callable, Awaitable

from PIL import Image


@dataclass
class GenerateParams:
    prompt: str
    negative_prompt: str = ""
    video_frames: Optional[list[Image.Image]] = None
    strength: float = 0.8
    width: Optional[int] = None
    height: Optional[int] = None
    steps: int = 50
    cfg: float = 7.0
    seed: int = 0
    scheduler: Optional[str] = None
    model: str = ""
    num_frames: Optional[int] = None
    max_sequence_length: Optional[int] = None
    decode_chunk_size: Optional[int] = None
    noise_aug_strength: Optional[float] = None
    min_guidance_scale: Optional[float] = None
    max_guidance_scale: Optional[float] = None
    fps: Optional[int] = None
    motion_bucket_id: Optional[int] = None
    extra: dict = field(default_factory=dict)


@dataclass
class GenerateResult:
    url: str
    media_type: str


class BaseRunner(ABC):
    runner_key: str = ""

    @abstractmethod
    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        ...

    @abstractmethod
    def load(self, model_key: str) -> None:
        ...

    @abstractmethod
    def unload(self) -> None:
        ...

    @abstractmethod
    def get_accepted_params(self, model_key: str) -> dict:
        ...
