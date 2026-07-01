import pytest


def test_generate_accepts_valid_request(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "a cat walking"},
        )
    assert resp.status_code == 202
    data = resp.json()
    assert "task_id" in data
    assert data["status"] in ("pending", "running")


def test_generate_accepts_without_video(client):
    resp = client.post("/generate", data={"prompt": "test"})
    assert resp.status_code == 202


def test_generate_accepts_missing_prompt(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
        )
    assert resp.status_code == 202


def test_generate_accepts_empty_prompt(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": ""},
        )
    assert resp.status_code == 202


def test_generate_rejects_invalid_format(client):
    resp = client.post(
        "/generate",
        files={"video": ("test.txt", b"not a video", "text/plain")},
        data={"prompt": "test"},
    )
    assert resp.status_code == 422


def test_generate_rejects_oversized_file(client):
    big_data = b"x" * (501 * 1024 * 1024)
    resp = client.post(
        "/generate",
        files={"video": ("big.mp4", big_data, "video/mp4")},
        data={"prompt": "test"},
    )
    assert resp.status_code == 413


def test_generate_validates_width_non_multiple_of_8(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "test", "width": 10},
        )
    assert resp.status_code == 422
    assert "multiple of 8" in resp.text.lower()


def test_generate_validates_height_non_multiple_of_8(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "test", "height": 10},
        )
    assert resp.status_code == 422
    assert "multiple of 8" in resp.text.lower()


def test_generate_validates_steps_range_low(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "test", "steps": 0},
        )
    assert resp.status_code == 422


def test_generate_validates_steps_range_high(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "test", "steps": 101},
        )
    assert resp.status_code == 422


def test_generate_width_exceeds_max(client, sample_video):
    with open(sample_video, "rb") as f:
        resp = client.post(
            "/generate",
            files={"video": ("test.mp4", f, "video/mp4")},
            data={"prompt": "test", "width": 1024},
        )
    assert resp.status_code == 422
