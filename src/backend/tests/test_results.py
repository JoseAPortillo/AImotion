import os
from app.config import settings


def test_results_404_on_nonexistent(client):
    resp = client.get("/results/nonexistent.mp4")
    assert resp.status_code == 404


def test_results_serves_existing_file(client):
    os.makedirs(settings.results_dir, exist_ok=True)
    filepath = os.path.join(settings.results_dir, "test_output.mp4")
    with open(filepath, "wb") as f:
        f.write(b"fake_video_content")

    resp = client.get("/results/test_output.mp4")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "video/mp4"
    assert resp.content == b"fake_video_content"


def test_results_404_after_cleanup(client):
    os.makedirs(settings.results_dir, exist_ok=True)
    filepath = os.path.join(settings.results_dir, "temp.mp4")
    with open(filepath, "wb") as f:
        f.write(b"content")

    os.remove(filepath)
    resp = client.get("/results/temp.mp4")
    assert resp.status_code == 404
