import os
import tempfile
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.runners.registry import RunnerRegistry
from app.services.runners.base import BaseRunner


class MockRunner(BaseRunner):
    runner_key = "mock"
    async def generate(self, params, progress_callback=None, cancel_event=None):
        from app.services.runners.base import GenerateResult
        return GenerateResult(url="/mock/output.png", media_type="image")
    def load(self, model_key):
        pass
    def unload(self):
        pass
    def get_accepted_params(self, model_key):
        return {}


RunnerRegistry.register("diffusers", MockRunner())
RunnerRegistry.register("gguf", MockRunner())
RunnerRegistry.register("api", MockRunner())


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_video():
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(b"\x00\x00\x00\x00fake_mp4_content")
        path = f.name
    yield path
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture
def sample_video_file(sample_video):
    return open(sample_video, "rb")


@pytest.fixture(autouse=True)
def clean_dirs():
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.results_dir, exist_ok=True)
    yield
    for d in [settings.upload_dir, settings.results_dir]:
        if os.path.exists(d):
            for f in os.listdir(d):
                try:
                    os.remove(os.path.join(d, f))
                except OSError:
                    pass
