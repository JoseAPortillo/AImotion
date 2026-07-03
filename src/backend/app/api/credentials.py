import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.credential_manager import set_key, get_key, delete_key, list_services

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credentials", tags=["credentials"])


class SetCredentialRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


@router.get("")
async def list_credentials():
    services = list_services()
    return {"services": services}


@router.put("/{service}")
async def set_credential(service: str, body: SetCredentialRequest):
    set_key(service, body.api_key)
    return {"status": "ok", "service": service}


@router.get("/{service}")
async def get_credential(service: str, reveal: bool = False):
    key = get_key(service)
    if key is None:
        raise HTTPException(status_code=404, detail=f"No credential found for '{service}'")
    if reveal:
        return {"service": service, "api_key": key}
    masked = key[:4] + "*" * (len(key) - 8) + key[-4:] if len(key) > 8 else "****"
    return {"service": service, "api_key": masked}


@router.delete("/{service}")
async def delete_credential(service: str):
    if not delete_key(service):
        raise HTTPException(status_code=404, detail=f"No credential found for '{service}'")
    return {"status": "deleted", "service": service}
