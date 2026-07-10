import pytest
import os
import tempfile
from app.services.credential_manager import set_key, get_key, delete_key, list_services, store_path


@pytest.fixture(autouse=True)
def isolated_credentials(monkeypatch):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        tmp = f.name
    monkeypatch.setenv("AIMATION_CREDENTIALS_PATH", tmp)
    yield
    if os.path.exists(tmp):
        os.remove(tmp)


class TestCredentialManager:
    def test_set_and_get(self):
        set_key("kling", "sk-abc123")
        assert get_key("kling") == "sk-abc123"

    def test_get_nonexistent(self):
        assert get_key("nonexistent") is None

    def test_list(self):
        assert list_services() == []
        set_key("kling", "key1")
        set_key("seedance", "key2")
        assert list_services() == ["kling", "seedance"]

    def test_delete(self):
        set_key("kling", "key1")
        assert delete_key("kling") is True
        assert get_key("kling") is None

    def test_delete_nonexistent(self):
        assert delete_key("nonexistent") is False

    def test_overwrite(self):
        set_key("kling", "original")
        set_key("kling", "updated")
        assert get_key("kling") == "updated"
        assert len(list_services()) == 1

    def test_encryption_at_rest(self):
        set_key("kling", "secret-value")
        with open(store_path()) as f:
            raw = f.read()
        assert "secret-value" not in raw


class TestCredentialsAPI:
    def test_list_empty(self, client):
        resp = client.get("/credentials")
        assert resp.status_code == 200
        assert resp.json()["services"] == []

    def test_set_and_get_masked(self, client):
        client.put("/credentials/kling", json={"api_key": "sk-test-key-12345"})
        resp = client.get("/credentials/kling")
        assert resp.status_code == 200
        data = resp.json()
        assert data["api_key"] != "sk-test-key-12345"
        assert "..." in data["api_key"]

    def test_get_revealed(self, client):
        client.put("/credentials/kling", json={"api_key": "sk-test-key-12345"})
        resp = client.get("/credentials/kling?reveal=true")
        assert resp.json()["api_key"] == "sk-test-key-12345"

    def test_get_nonexistent(self, client):
        assert client.get("/credentials/nonexistent").status_code == 404

    def test_delete(self, client):
        client.put("/credentials/kling", json={"api_key": "x"})
        assert client.delete("/credentials/kling").status_code == 200
        assert client.get("/credentials/kling").status_code == 404

    def test_delete_nonexistent(self, client):
        assert client.delete("/credentials/nonexistent").status_code == 404

    def test_set_rejects_empty_key(self, client):
        resp = client.put("/credentials/kling", json={"api_key": ""})
        assert resp.status_code == 422
