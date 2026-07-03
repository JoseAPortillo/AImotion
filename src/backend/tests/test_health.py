import pytest


def test_health_returns_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200


def test_health_response_shape(client):
    resp = client.get("/health")
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "AImation API"
    assert "gpu_available" in data


def test_health_gpu_field_types(client):
    resp = client.get("/health")
    data = resp.json()
    assert isinstance(data["gpu_available"], bool)
    assert data["gpu_name"] is None or isinstance(data["gpu_name"], str)
    assert data["vram_total_gb"] is None or isinstance(data["vram_total_gb"], (int, float))


@pytest.mark.integration
def test_health_gpu_detection(client):
    """When CUDA is available, GPU fields should be populated."""
    import torch
    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")
    resp = client.get("/health")
    data = resp.json()
    assert data["gpu_available"] is True
    assert data["gpu_name"] is not None
    assert data["vram_total_gb"] is not None
