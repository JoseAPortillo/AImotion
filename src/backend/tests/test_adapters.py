import pytest
from unittest.mock import patch, MagicMock
from app.services.runners.registry import RunnerRegistry


def test_adapters_status_no_diffusers(client):
    resp = client.get("/adapters/status")
    assert resp.status_code == 503


@pytest.fixture
def mock_runner():
    gen = MagicMock()
    gen._active_lora = None
    runner = MagicMock()
    runner._gen = gen
    RunnerRegistry.register("diffusers", runner)
    yield runner
    RunnerRegistry._instances.pop("diffusers", None)


def test_adapters_status_ok(client, mock_runner):
    resp = client.get("/adapters/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["lora"] is False
    assert data["controlnet"] is False


def test_adapters_lora_apply_rejects_missing_file(client, mock_runner):
    resp = client.post("/adapters/lora/apply", data={"model": "test", "scale": 1.0})
    assert resp.status_code == 422


def test_adapters_lora_apply_rejects_unsupported_format(client, mock_runner):
    resp = client.post(
        "/adapters/lora/apply",
        files={"lora_file": ("lora.txt", b"fake", "text/plain")},
        data={"model": "test", "scale": 1.0},
    )
    assert resp.status_code == 422


def test_adapters_lora_apply_valid(client, mock_runner):
    mock_runner._gen.apply_lora = MagicMock()
    resp = client.post(
        "/adapters/lora/apply",
        files={"lora_file": ("lora.safetensors", b"fake_weights", "application/octet-stream")},
        data={"model": "cogvideox-2b", "scale": 0.8},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    mock_runner._gen.apply_lora.assert_called_once()


def test_adapters_lora_apply_error(client, mock_runner):
    mock_runner._gen.apply_lora = MagicMock(side_effect=ValueError("model not loaded"))
    resp = client.post(
        "/adapters/lora/apply",
        files={"lora_file": ("lora.safetensors", b"fake", "application/octet-stream")},
        data={"model": "cogvideox-2b", "scale": 1.0},
    )
    assert resp.status_code == 500


def test_adapters_lora_unload(client, mock_runner):
    mock_runner._gen.unload_lora = MagicMock()
    resp = client.post("/adapters/lora/unload")
    assert resp.status_code == 200
    mock_runner._gen.unload_lora.assert_called_once()


def test_adapters_controlnet_apply_returns_501(client, mock_runner):
    mock_runner._gen.apply_controlnet = MagicMock(side_effect=NotImplementedError("not yet"))
    resp = client.post(
        "/adapters/controlnet/apply",
        data={"model": "cogvideox-2b", "controlnet_model": "lllyasviel/control_v11p_sd15_openpose"},
    )
    assert resp.status_code == 501


def test_adapters_controlnet_unload(client, mock_runner):
    mock_runner._gen.unload_controlnet = MagicMock()
    resp = client.post("/adapters/controlnet/unload")
    assert resp.status_code == 200
