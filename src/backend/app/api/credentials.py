import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.credential_manager import set_key, get_key, delete_key, list_services
from app.services.model_catalog import catalog

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credentials", tags=["credentials"])


class SetCredentialRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


class RenameCredentialRequest(BaseModel):
    new_name: str = Field(..., min_length=1)


def _mask_key(key: str) -> str:
    return key[:4] + "..." + key[-4:] if len(key) > 8 else "****"


@router.get("")
async def list_credentials():
    services = list_services()
    masked: dict[str, str | None] = {}
    for s in services:
        key = get_key(s)
        masked[s] = _mask_key(key) if key else None
    return {"services": services, "masked": masked}


@router.get("/providers")
async def list_providers():
    seen: set[str] = set()
    result: list[str] = []
    for v in catalog.all_variants():
        if v.type == "api" and v.family.family not in seen:
            seen.add(v.family.family)
            result.append(v.family.family)
    return {"providers": sorted(result)}


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
    return {"service": service, "api_key": _mask_key(key)}


@router.post("/{service}/rename")
async def rename_credential(service: str, body: RenameCredentialRequest):
    key = get_key(service)
    if key is None:
        raise HTTPException(status_code=404, detail=f"No credential found for '{service}'")
    if body.new_name == service:
        return {"status": "ok", "service": service}
    set_key(body.new_name, key)
    delete_key(service)
    return {"status": "renamed", "old_service": service, "new_service": body.new_name}


@router.delete("/{service}")
async def delete_credential(service: str):
    if not delete_key(service):
        raise HTTPException(status_code=404, detail=f"No credential found for '{service}'")
    return {"status": "deleted", "service": service}
