import os
import json
import base64
import logging
import hashlib
import sys
from typing import Optional
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)


def _data_dir() -> str:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        path = os.path.join(base, "AImation")
    else:
        path = os.path.expanduser("~/.config/aimation")
    os.makedirs(path, exist_ok=True)
    return path


_DATA_DIR = _data_dir()


def store_path() -> str:
    return os.environ.get("AIMATION_CREDENTIALS_PATH") or os.path.join(_DATA_DIR, "credentials.json")


_MASTER_SECRET = os.environ.get("AIMATION_CREDENTIAL_KEY", "aimation-credential-key-v1")


def _get_cipher() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(_MASTER_SECRET.encode()).digest())
    return Fernet(key)


def _load_store() -> dict[str, str]:
    path = store_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("Corrupted credential store, starting fresh")
        return {}


def _save_store(store: dict[str, str]):
    path = store_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(store, f, indent=2)


def set_key(service: str, api_key: str):
    cipher = _get_cipher()
    store = _load_store()
    store[service] = cipher.encrypt(api_key.encode()).decode()
    _save_store(store)
    logger.info("Credential saved for service: %s", service)


def get_key(service: str) -> Optional[str]:
    cipher = _get_cipher()
    store = _load_store()
    encrypted = store.get(service)
    if encrypted is None:
        return None
    try:
        return cipher.decrypt(encrypted.encode()).decode()
    except Exception:
        logger.warning("Failed to decrypt credential for service: %s", service)
        return None


def delete_key(service: str) -> bool:
    store = _load_store()
    if service not in store:
        return False
    del store[service]
    _save_store(store)
    logger.info("Credential deleted for service: %s", service)
    return True


def list_services() -> list[str]:
    store = _load_store()
    return sorted(store.keys())
