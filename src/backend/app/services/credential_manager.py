import os
import json
import logging
from typing import Optional
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

CREDENTIALS_DIR = os.path.join(os.path.dirname(__file__), "..", "..")
KEY_FILE = os.path.abspath(os.path.join(CREDENTIALS_DIR, ".credentials.key"))
STORE_FILE = os.path.abspath(os.path.join(CREDENTIALS_DIR, "credentials.json"))


def _get_cipher() -> Fernet:
    if not os.path.exists(KEY_FILE):
        key = Fernet.generate_key()
        os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        logger.info("Generated new credential encryption key")
    else:
        with open(KEY_FILE, "rb") as f:
            key = f.read()
    return Fernet(key)


def _load_store() -> dict[str, str]:
    if not os.path.exists(STORE_FILE):
        return {}
    try:
        with open(STORE_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("Corrupted credential store, starting fresh")
        return {}


def _save_store(store: dict[str, str]):
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    with open(STORE_FILE, "w") as f:
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
