import pytest
from unittest.mock import patch


def test_llm_generate_rejects_empty_prompt(client):
    resp = client.post("/llm/generate", json={"prompt": ""})
    assert resp.status_code == 422


def test_llm_generate_rejects_missing_prompt(client):
    resp = client.post("/llm/generate", json={})
    assert resp.status_code == 422


def test_llm_generate_rejects_invalid_temperature(client):
    resp = client.post("/llm/generate", json={"prompt": "hi", "temperature": 99})
    assert resp.status_code == 422


@patch("app.api.llm._call_ollama")
def test_llm_generate_basic(mock_call, client):
    mock_call.return_value = "Hello! How can I help you?"
    resp = client.post("/llm/generate", json={"prompt": "Say hello"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"] == "Hello! How can I help you?"


@patch("app.api.llm._call_ollama")
def test_llm_generate_with_system_prompt(mock_call, client):
    mock_call.return_value = "42"
    resp = client.post("/llm/generate", json={
        "prompt": "What is the answer?",
        "system_prompt": "You are a math tutor. Answer concisely.",
        "temperature": 0.1,
        "max_tokens": 100,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"] == "42"


@patch("app.api.llm._call_ollama")
def test_llm_generate_custom_model(mock_call, client):
    mock_call.return_value = "Sure, here's a poem..."
    resp = client.post("/llm/generate", json={
        "prompt": "Write a poem",
        "model": "llama3.1:8b",
    })
    assert resp.status_code == 200
    mock_call.assert_called_once()
    args, _ = mock_call.call_args
    assert args[0] == "llama3.1:8b"


@patch("app.api.llm._call_ollama", side_effect=Exception("model not available"))
def test_llm_generate_all_models_fail(mock_call, client, monkeypatch):
    monkeypatch.setattr("app.api.llm.DEFAULT_MODEL", "nonexistent")
    monkeypatch.setattr("app.api.llm.FALLBACK_MODELS", [])
    resp = client.post("/llm/generate", json={"prompt": "test"})
    assert resp.status_code == 502


@patch("app.api.llm._call_ollama")
def test_llm_generate_with_all_params(mock_call, client):
    mock_call.return_value = "Generated text"
    resp = client.post("/llm/generate", json={
        "prompt": "test",
        "system_prompt": "You are helpful",
        "model": "hermes3:latest",
        "temperature": 0.5,
        "max_tokens": 512,
        "top_p": 0.8,
        "top_k": 30,
        "seed": 42,
    })
    assert resp.status_code == 200
    mock_call.assert_called_once()
    args, _ = mock_call.call_args
    req = args[1]
    assert req.temperature == 0.5
    assert req.max_tokens == 512
    assert req.top_p == 0.8
    assert req.top_k == 30
    assert req.seed == 42
