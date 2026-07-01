import logging
from typing import Optional

from app.services.runners.base import BaseRunner

logger = logging.getLogger(__name__)


class RunnerRegistry:
    _instances: dict[str, BaseRunner] = {}

    @classmethod
    def register(cls, key: str, runner: BaseRunner):
        cls._instances[key] = runner
        logger.info("Runner registered: %s (%s)", key, type(runner).__name__)

    @classmethod
    def get(cls, key: str) -> Optional[BaseRunner]:
        return cls._instances.get(key)

    @classmethod
    def is_registered(cls, key: str) -> bool:
        return key in cls._instances

    @classmethod
    def get_or_fallback(cls, key: str, fallback: str = "diffusers") -> Optional[BaseRunner]:
        return cls._instances.get(key) or cls._instances.get(fallback)
