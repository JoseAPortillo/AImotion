import time
import unittest.mock
import pytest


class TestVramEndpoint:
    def test_vram_returns_200(self, client):
        resp = client.get("/hardware/vram")
        assert resp.status_code == 200

    def test_vram_response_shape(self, client):
        resp = client.get("/hardware/vram")
        data = resp.json()
        assert "gpu_available" in data
        assert "gpu_name" in data
        assert "vram_total_gb" in data
        assert "vram_free_gb" in data
        assert "vram_used_gb" in data
        assert "vram_percent" in data
        assert "alert" in data
        assert "message" in data

    def test_vram_field_types(self, client):
        resp = client.get("/hardware/vram")
        data = resp.json()
        assert isinstance(data["gpu_available"], bool)
        assert data["gpu_name"] is None or isinstance(data["gpu_name"], str)
        assert data["vram_total_gb"] is None or isinstance(data["vram_total_gb"], (int, float))
        assert data["vram_free_gb"] is None or isinstance(data["vram_free_gb"], (int, float))
        assert data["vram_used_gb"] is None or isinstance(data["vram_used_gb"], (int, float))
        assert data["vram_percent"] is None or isinstance(data["vram_percent"], (int, float))
        assert isinstance(data["alert"], bool)
        assert data["message"] is None or isinstance(data["message"], str)

    @pytest.mark.integration
    def test_vram_gpu_values(self, client):
        pytest.importorskip("torch")
        import torch
        if not torch.cuda.is_available():
            pytest.skip("CUDA not available")
        resp = client.get("/hardware/vram")
        data = resp.json()
        assert data["gpu_available"] is True
        assert data["gpu_name"] is not None
        assert data["vram_total_gb"] > 0
        assert data["vram_free_gb"] > 0
        assert data["vram_used_gb"] >= 0
        assert data["vram_percent"] >= 0


class TestVramCache:
    def test_rapid_calls_return_same_data(self, client):
        resp1 = client.get("/hardware/vram")
        resp2 = client.get("/hardware/vram")
        assert resp1.json() == resp2.json()

    def test_cache_ttl_expires(self, client):
        from app.api.hardware import _vram_cache_ts, _VRAM_CACHE_TTL
        resp1 = client.get("/hardware/vram")
        data1 = resp1.json()

        _vram_cache_ts_old = _vram_cache_ts

        import time
        fake_now = _vram_cache_ts + _VRAM_CACHE_TTL + 0.1
        with unittest.mock.patch("app.api.hardware.time.monotonic", return_value=fake_now):
            resp2 = client.get("/hardware/vram")
            data2 = resp2.json()
            assert data2 == data1

    def test_vram_health_consistency(self, client):
        vram = client.get("/hardware/vram").json()
        health = client.get("/health").json()
        assert health["gpu_available"] == vram["gpu_available"]
        assert health["gpu_name"] == vram["gpu_name"]
        assert health["vram_total_gb"] == vram["vram_total_gb"]
        assert health["vram_free_gb"] == vram["vram_free_gb"]

    def test_vram_models_status_consistency(self, client):
        vram = client.get("/hardware/vram").json()
        status = client.get("/models/status").json()
        assert status["gpu_available"] == vram["gpu_available"]
        assert status["gpu_name"] == vram["gpu_name"]
        assert status["vram_total_gb"] == vram["vram_total_gb"]
        assert status["vram_free_gb"] == vram["vram_free_gb"]
