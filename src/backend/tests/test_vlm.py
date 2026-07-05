import pytest
from unittest.mock import patch, AsyncMock


def test_vlm_analyze_rejects_missing_image(client):
    resp = client.post("/vlm/analyze", data={"prompt": "describe this"})
    assert resp.status_code == 422


def test_vlm_analyze_uses_default_prompt(client):
    resp = client.post("/vlm/analyze", files={"image": ("test.png", b"fake_png", "image/png")})
    assert resp.status_code == 502  # all VLM models fail in test env


def test_vlm_analyze_rejects_unsupported_format(client):
    resp = client.post(
        "/vlm/analyze",
        files={"image": ("test.txt", b"not an image", "text/plain")},
        data={"prompt": "describe this"},
    )
    assert resp.status_code == 422


def test_vlm_analyze_rejects_oversized_file(client):
    big = b"x" * (501 * 1024 * 1024)
    resp = client.post(
        "/vlm/analyze",
        files={"image": ("test.png", big, "image/png")},
        data={"prompt": "describe this"},
    )
    assert resp.status_code == 413


@patch("app.api.vlm._call_vlm", new_callable=AsyncMock)
def test_vlm_analyze_valid_request(mock_call, client):
    mock_call.return_value = "A beautiful sunset over mountains"
    resp = client.post(
        "/vlm/analyze",
        files={"image": ("test.png", b"fake_png_bytes", "image/png")},
        data={"prompt": "describe this image"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"] == "A beautiful sunset over mountains"


@patch("app.api.vlm._call_vlm", new_callable=AsyncMock)
def test_vlm_analyze_default_prompt(mock_call, client):
    mock_call.return_value = "An image with various elements"
    resp = client.post(
        "/vlm/analyze",
        files={"image": ("photo.jpg", b"fake_jpg_bytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "elements" in data["result"]


@patch("app.api.vlm.VLM_MODELS", ["nonexistent-model"])
@patch("app.api.vlm._call_vlm", new_callable=AsyncMock, side_effect=Exception("model not found"))
def test_vlm_analyze_all_models_fail(mock_call, client, monkeypatch):
    monkeypatch.setattr("app.api.vlm.VLM_MODELS", ["nonexistent-model"])
    resp = client.post(
        "/vlm/analyze",
        files={"image": ("test.png", b"fake_png", "image/png")},
        data={"prompt": "describe"},
    )
    assert resp.status_code == 502
