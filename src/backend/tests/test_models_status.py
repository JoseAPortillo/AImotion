import pytest


class TestModelsStatusEndpoint:
    def test_status_returns_200(self, client):
        resp = client.get("/models/status")
        assert resp.status_code == 200

    def test_status_response_shape(self, client):
        resp = client.get("/models/status")
        data = resp.json()
        assert "gpu_available" in data
        assert "gpu_name" in data
        assert "vram_total_gb" in data
        assert "vram_free_gb" in data
        assert "current_model" in data
        assert "current_v2v_model" in data
        assert "cache_dir" in data

    def test_status_gpu_field_types(self, client):
        resp = client.get("/models/status")
        data = resp.json()
        assert isinstance(data["gpu_available"], bool)
        assert data["gpu_name"] is None or isinstance(data["gpu_name"], str)
        assert data["vram_total_gb"] is None or isinstance(data["vram_total_gb"], (int, float))
        assert data["vram_free_gb"] is None or isinstance(data["vram_free_gb"], (int, float))

    def test_status_vram_matches_hardware(self, client):
        status = client.get("/models/status").json()
        vram = client.get("/hardware/vram").json()
        assert status["gpu_available"] == vram["gpu_available"]
        assert status["gpu_name"] == vram["gpu_name"]
        assert status["vram_total_gb"] == vram["vram_total_gb"]
        assert status["vram_free_gb"] == vram["vram_free_gb"]
