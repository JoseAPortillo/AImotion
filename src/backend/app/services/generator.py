import logging
from typing import Optional, Callable, Awaitable
from PIL import Image

from app.config import settings
from app.services.model_catalog import catalog
from app.services.diffusers_generator import DiffusersGenerator

logger = logging.getLogger(__name__)

SCHEDULER_NAMES: dict[str, str] = {}
for family in catalog.families:
    for key, cls_name in family.schedulers.items():
        SCHEDULER_NAMES.setdefault(cls_name, key)
        SCHEDULER_NAMES[key] = cls_name


def get_model_config(key: str) -> dict | None:
    variant = catalog.get_variant(key)
    if variant is None:
        return None
    return {
        "model_name": variant.hf_name or key,
        "pipeline_class": variant.pipeline_class,
        "dtype": variant.dtype or settings.dtype,
        "defaults": variant.defaults,
        "needs_token": variant.needs_token,
        "schedulers": variant.schedulers,
        "default_scheduler": variant.default_scheduler,
    }


def extract_frames(path: str, max_frames: int = 49) -> list[Image.Image]:
    import imageio
    reader = imageio.get_reader(path)
    all_frames = [Image.fromarray(f) for f in reader]
    reader.close()
    total = len(all_frames)
    if total <= max_frames:
        logger.info(f"Extracted {len(all_frames)} frames from {path}")
        return all_frames
    step = total / max_frames
    frames = [all_frames[int(i * step)] for i in range(max_frames)]
    logger.info(f"Extracted {len(frames)} frames from {path} (total source: {total})")
    return frames


class VideoGenerator(DiffusersGenerator):
    @property
    def _current_v2v_model_key(self):
        return self._current_model_key
