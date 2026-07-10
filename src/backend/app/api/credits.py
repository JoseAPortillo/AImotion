import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Query

from app.services.credential_manager import get_key
from app.services.credit_manager import credit_manager
from app.services.runners.api import _PROVIDERS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credits", tags=["credits"])

LOW_BALANCE_THRESHOLD = 100


@router.get("")
async def get_credits():
    providers_data = {}

    for name, provider in _PROVIDERS.items():
        key = get_key(name)
        has_balance = hasattr(provider, "get_balance") and callable(getattr(provider, "get_balance"))

        if not key:
            providers_data[name] = {
                "configured": False,
                "balance": None,
                "cached": None,
                "tier_info": None,
                "low_balance": False,
            }
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

        balance_val = None
        if live and isinstance(live.get("balance"), (int, float)):
            balance_val = live["balance"]
        elif cached and isinstance(cached.get("balance"), (int, float)):
            balance_val = cached["balance"]

        tier_info = None
        if live:
            tier_info = live.get("tier")
            if live.get("daily_generations"):
                tier_info = tier_info or {}
                tier_info["daily_generations"] = live["daily_generations"]
            if live.get("monthly_spend") is not None:
                tier_info = tier_info or {}
                tier_info["monthly_spend"] = live["monthly_spend"]
            if live.get("monthly_spend_cap") is not None:
                tier_info = tier_info or {}
                tier_info["monthly_spend_cap"] = live["monthly_spend_cap"]

        providers_data[name] = {
            "configured": True,
            "balance": live,
            "cached": cached,
            "tier_info": tier_info,
            "low_balance": balance_val is not None and balance_val < LOW_BALANCE_THRESHOLD,
        }

    summary = credit_manager.get_usage_summary()
    daily = credit_manager.get_daily_summary()

    return {
        "providers": providers_data,
        "total_credits_used": summary["total_credits_used"],
        "by_provider": summary["by_provider"],
        "recent": summary["recent"],
        "daily_summary": daily["daily"],
    }


@router.get("/usage")
async def get_provider_usage(
    provider: str = Query(..., description="Provider name"),
    days: int = Query(30, ge=1, le=90),
):
    p = _PROVIDERS.get(provider)
    if p is None:
        return {"error": f"Unknown provider: {provider}"}

    has_usage = hasattr(p, "get_usage_history") and callable(getattr(p, "get_usage_history"))
    if not has_usage:
        return {"provider": provider, "usage": None, "supported": False}

    try:
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=days)).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")
        usage = await p.get_usage_history(start_date=start, end_date=end)
        return {"provider": provider, "usage": usage, "supported": True}
    except Exception as e:
        logger.warning("Failed to fetch usage for %s: %s", provider, e)
        return {"provider": provider, "usage": None, "supported": True, "error": str(e)}
