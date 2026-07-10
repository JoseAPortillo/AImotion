import json
import os
import logging
import sys
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def _data_dir() -> str:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        path = os.path.join(base, "AImation")
    else:
        path = os.path.expanduser("~/.config/aimation")
    os.makedirs(path, exist_ok=True)
    return path


def _store_path() -> str:
    return os.environ.get("AIMATION_CREDITS_PATH") or os.path.join(_data_dir(), "credits.json")


class CreditManager:
    def __init__(self):
        self._store: dict = {}
        self._load()

    def _load(self):
        path = _store_path()
        if os.path.exists(path):
            try:
                with open(path) as f:
                    self._store = json.load(f)
            except (json.JSONDecodeError, OSError):
                logger.warning("Corrupted credits store, starting fresh")
                self._store = {}
        if "history" not in self._store:
            self._store["history"] = []
        if "cache" not in self._store:
            self._store["cache"] = {}

    def _save(self):
        path = _store_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(self._store, f, indent=2, default=str)

    def record_usage(self, provider: str, model: str, credits: float, task_id: str, status: str = "completed"):
        self._store["history"].append({
            "provider": provider,
            "model": model,
            "credits": credits,
            "task_id": task_id,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        self._save()

    def cache_balance(self, provider: str, data: dict):
        self._store["cache"][provider] = {
            **data,
            "cached_at": datetime.now(timezone.utc).isoformat(),
        }
        self._save()

    def get_cached_balance(self, provider: str) -> dict | None:
        return self._store["cache"].get(provider)

    def get_usage_summary(self, provider: Optional[str] = None, limit: int = 50) -> dict:
        history = self._store["history"]
        if provider:
            history = [h for h in history if h["provider"] == provider]

        total_used = sum(h.get("credits", 0) for h in history if h.get("credits"))

        providers_used: dict[str, float] = {}
        for h in history:
            p = h["provider"]
            providers_used[p] = providers_used.get(p, 0) + h.get("credits", 0)

        return {
            "total_credits_used": total_used,
            "by_provider": providers_used,
            "recent": sorted(history, key=lambda x: x["timestamp"], reverse=True)[:limit],
        }

    def get_daily_summary(self, days: int = 30) -> dict:
        """Return usage grouped by date and model for the last N days."""
        now = datetime.now(timezone.utc)
        cutoff = now - __import__("datetime").timedelta(days=days)

        daily: dict[str, dict[str, float]] = {}
        for h in self._store["history"]:
            ts = h.get("timestamp", "")
            try:
                dt = datetime.fromisoformat(ts)
            except (ValueError, TypeError):
                continue
            if dt < cutoff:
                continue
            date_key = dt.strftime("%Y-%m-%d")
            model = h.get("model", "unknown")
            if date_key not in daily:
                daily[date_key] = {}
            daily[date_key][model] = daily[date_key].get(model, 0) + h.get("credits", 0)

        sorted_days = sorted(daily.items(), reverse=True)[:days]
        return {
            "daily": [
                {"date": date, "models": models}
                for date, models in sorted_days
            ],
            "days": days,
        }


credit_manager = CreditManager()