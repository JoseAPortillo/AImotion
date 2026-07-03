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
