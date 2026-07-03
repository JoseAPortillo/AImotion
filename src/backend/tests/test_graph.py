import pytest


def _valid_graph():
    return {
        "graph_id": "test_workflow",
        "nodes": [
            {"id": "prompt", "type": "inputText", "outputs": {"text": "a cat"}},
            {
                "id": "gen",
                "type": "imageGen",
                "data": {"model": "sdxl", "steps": 20, "execution_mode": "local"},
                "inputs": {"prompt": ""},
                "outputs": {"image_path": ""},
            },
            {"id": "out", "type": "outputPlayer"},
        ],
        "edges": [
            {"source": "prompt", "sourceOutput": "text", "target": "gen", "targetInput": "prompt"},
            {"source": "gen", "sourceOutput": "image_path", "target": "out", "targetInput": "src"},
        ],
    }


class TestGraphExecute:
    def test_execute_returns_202(self, client):
        resp = client.post("/graph/execute", json=_valid_graph())
        assert resp.status_code == 202
        data = resp.json()
        assert "task_id" in data
        assert data["status"] == "pending"

    def test_execute_rejects_unknown_type(self, client):
        resp = client.post("/graph/execute", json={
            "nodes": [{"id": "x", "type": "alien"}],
            "edges": [],
        })
        assert resp.status_code == 422
        assert "Unknown node type" in resp.text

    def test_execute_rejects_cycle(self, client):
        resp = client.post("/graph/execute", json={
            "nodes": [
                {"id": "a", "type": "inputText"},
                {"id": "b", "type": "imageGen", "data": {}, "inputs": {"prompt": ""}},
            ],
            "edges": [
                {"source": "a", "target": "b"},
                {"source": "b", "target": "a"},
            ],
        })
        assert resp.status_code == 422
        assert "cycle" in resp.text.lower()

    def test_execute_rejects_video_gen_without_input(self, client):
        resp = client.post("/graph/execute", json={
            "nodes": [
                {"id": "v", "type": "videoGen", "data": {}, "inputs": {"ref_image": ""}},
            ],
            "edges": [],
        })
        assert resp.status_code == 422
        assert "no input" in resp.text.lower()

    def test_execute_then_poll(self, client):
        resp = client.post("/graph/execute", json=_valid_graph())
        assert resp.status_code == 202
        task_id = resp.json()["task_id"]

        poll = client.get(f"/graph/tasks/{task_id}")
        assert poll.status_code == 200
        data = poll.json()
        assert data["task_id"] == task_id
        assert data["status"] in ("pending", "running", "completed", "failed")

    def test_poll_unknown_task(self, client):
        resp = client.get("/graph/tasks/nonexistent")
        assert resp.status_code == 404

    def test_cancel_unknown_task(self, client):
        resp = client.delete("/graph/tasks/nonexistent")
        assert resp.status_code == 404

    def test_cancel_created_task(self, client):
        resp = client.post("/graph/execute", json=_valid_graph())
        assert resp.status_code == 202
        task_id = resp.json()["task_id"]

        cancel = client.delete(f"/graph/tasks/{task_id}")
        assert cancel.status_code == 200
        status = cancel.json()["status"]
        assert status in ("cancelling", "pending", "running", "completed", "failed"), f"unexpected status: {status}"
