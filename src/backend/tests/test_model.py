import pytest


@pytest.mark.integration
def test_model_imports():
    """Verify that the generator module can be imported without errors."""
    from app.services.generator import VideoGenerator
    assert VideoGenerator is not None


@pytest.mark.integration
def test_model_loads():
    """Load the actual LTX-Video model. Requires GPU and model weights."""
    pytest.importorskip("torch")
    import torch
    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")

    from app.services.generator import VideoGenerator
    gen = VideoGenerator()
    gen.load_model()
    assert gen.pipeline is not None


@pytest.mark.integration
def test_model_generates_output():
    """Generate a short video with LTX-Video. Requires GPU."""
    pytest.importorskip("torch")
    import torch
    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")

    import tempfile
    import os
    from app.services.generator import VideoGenerator
    from app.config import settings

    gen = VideoGenerator()
    gen.load_model()

    result_url = gen.generate(
        prompt="a cat walking",
        width=256,
        height=256,
        steps=5,
        cfg=7.5,
        seed=42,
    )
    assert result_url.startswith("/results/")
    filepath = result_url.lstrip("/results/")
    full_path = os.path.join(settings.results_dir, filepath)
    assert os.path.exists(full_path)
    assert os.path.getsize(full_path) > 0
