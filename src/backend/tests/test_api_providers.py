import pytest
from app.services.api_providers.kling import KlingProvider
from app.services.api_providers.seedance import SeedanceProvider
from app.services.api_providers.base import ProviderError


class TestKlingProvider:
    def test_service_name(self):
        assert KlingProvider().service_name == "kling"

    def test_get_accepted_params(self):
        p = KlingProvider()
        params = p.get_accepted_params("kling")
        assert "prompt" in params
        assert "negative_prompt" in params

    def test_generate_raises_without_key(self):
        # No API key configured in test env
        p = KlingProvider()
        with pytest.raises(ProviderError, match="No API key configured"):
            import asyncio
            from app.services.runners.base import GenerateParams
            asyncio.run(p.generate(GenerateParams(prompt="test")))

    def test_load_unload(self):
        p = KlingProvider()
        p.load("kling")
        p.unload()


class TestSeedanceProvider:
    def test_service_name(self):
        assert SeedanceProvider().service_name == "seedance"

    def test_get_accepted_params(self):
        p = SeedanceProvider()
        params = p.get_accepted_params("seedance")
        assert "prompt" in params

    def test_generate_raises_without_key(self):
        p = SeedanceProvider()
        with pytest.raises(ProviderError, match="No API key configured"):
            import asyncio
            from app.services.runners.base import GenerateParams
            asyncio.run(p.generate(GenerateParams(prompt="test")))

    def test_load_unload(self):
        p = SeedanceProvider()
        p.load("seedance")
        p.unload()


class TestAPIRunner:
    def test_runner_key(self):
        from app.services.runners.api import APIRunner
        assert APIRunner().runner_key == "api"

    def test_load_unload(self):
        from app.services.runners.api import APIRunner
        r = APIRunner()
        r.load("kling")
        r.unload()

    def test_get_accepted_params_kling(self):
        from app.services.runners.api import APIRunner
        params = APIRunner().get_accepted_params("kling")
        assert "prompt" in params

    def test_get_accepted_params_seedance(self):
        from app.services.runners.api import APIRunner
        params = APIRunner().get_accepted_params("seedance")
        assert "prompt" in params

    def test_get_accepted_params_unknown(self):
        from app.services.runners.api import APIRunner
        with pytest.raises(ValueError, match="Unknown API model"):
            APIRunner().get_accepted_params("nonexistent")
