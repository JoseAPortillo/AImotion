import logging
import threading
from typing import Optional, Callable, Awaitable

from app.services.runners.base import BaseRunner, GenerateParams, GenerateResult
from app.services.model_catalog import catalog
from app.services.api_providers.kling import KlingProvider
from app.services.api_providers.seedance import SeedanceProvider

logger = logging.getLogger(__name__)

_PROVIDERS: dict[str, BaseRunner] = {
    "kling": KlingProvider(),
    "seedance": SeedanceProvider(),
}


class APIRunner(BaseRunner):
    runner_key = "api"

    def __init__(self):
        self._model_key: Optional[str] = None

    def _get_provider(self, model_key: str) -> BaseRunner:
        variant = catalog.get_variant(model_key)
        if variant is None:
            raise ValueError(f"Unknown API model '{model_key}'")
        family_name = variant.family.family
        provider = _PROVIDERS.get(family_name)
        if provider is None:
            raise ValueError(
                f"API provider for '{family_name}' is not implemented yet. "
                f"Available: {', '.join(sorted(_PROVIDERS))}"
            )
        return provider

    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        provider = self._get_provider(params.model)
        return await provider.generate(params, progress_callback, cancel_event)

    def load(self, model_key: str) -> None:
        self._model_key = model_key
        logger.info("API runner: model %s selected", model_key)

    def unload(self) -> None:
        self._model_key = None
        logger.info("API runner unloaded")

    def get_accepted_params(self, model_key: str) -> dict:
        provider = self._get_provider(model_key)
        return provider.get_accepted_params(model_key)
