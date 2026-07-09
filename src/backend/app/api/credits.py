import logging
from fastapi import APIRouter

from app.services.credential_manager import get_key
from app.services.credit_manager import credit_manager
from app.services.runners.api import _PROVIDERS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credits", tags=["credits"])


@router.get("")
async def get_credits():
    providers_data = {}

    for name, provider in _PROVIDERS.items():
        key = get_key(name)
        has_balance = hasattr(provider, "get_balance") and callable(getattr(provider, "get_balance"))

        if not key:
            providers_data[name] = {"configured": False, "balance": None, "cached": None}
            continue

        cached = credit_manager.get_cached_balance(name)
        live = None
        if has_balance:
            try:
                live = await provider.get_balance()
                if live:
                    credit_manager.cache_balance(name, live)
            except Exception as e:
                logger.warning("Failed to fetch balance for %s: %s", name, e)

        providers_data[name] = {
            "configured": True,
            "balance": live,
            "cached": cached,
        }

    summary = credit_manager.get_usage_summary()

    return {
        "providers": providers_data,
        "total_credits_used": summary["total_credits_used"],
        "by_provider": summary["by_provider"],
        "recent": summary["recent"],
    }