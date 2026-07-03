import abc
import logging
import threading
from typing import Optional, Callable, Awaitable

import httpx

from app.services.credential_manager import get_key
from app.services.runners.base import GenerateParams, GenerateResult

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.status_code = status_code
        super().__init__(message)


class BaseApiProvider(abc.ABC):
    service_name: str = ""

    @property
    @abc.abstractmethod
    def base_url(self) -> str:
        ...

    def _headers(self) -> dict[str, str]:
        api_key = get_key(self.service_name)
        if not api_key:
            raise ProviderError(
                f"No API key configured for '{self.service_name}'. "
                f"Add it in Settings → API Credentials.",
                status_code=401,
            )
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def _request(
        self, client: httpx.AsyncClient, method: str, path: str, json_body: dict | None = None,
    ) -> dict:
        url = f"{self.base_url}{path}"
        resp = await client.request(method, url, headers=self._headers(), json=json_body)
        if resp.status_code == 401:
            raise ProviderError(
                f"Invalid API key for '{self.service_name}'. Update it in API Credentials.",
                status_code=401,
            )
        if resp.status_code == 402:
            raise ProviderError(f"Insufficient credits for '{self.service_name}'.", status_code=402)
        if resp.status_code == 429:
            raise ProviderError(f"Rate limited by '{self.service_name}'. Try again later.", status_code=429)
        try:
            data = resp.json()
        except Exception:
            raise ProviderError(f"Provider returned non-JSON: {resp.status_code}", status_code=resp.status_code)
        if not resp.is_success:
            detail = data.get("detail") or data.get("message") or data.get("error") or str(data)
            raise ProviderError(f"Provider error: {detail}", status_code=resp.status_code)
        return data

    @abc.abstractmethod
    async def generate(
        self,
        params: GenerateParams,
        progress_callback: Optional[Callable[[int, int], Awaitable[None]]] = None,
        cancel_event: Optional[threading.Event] = None,
    ) -> GenerateResult:
        ...
