import pytest
from app.services.graph_solver import GraphSolver, GraphValidationError


@pytest.fixture
def solver():
    return GraphSolver()


_VALID_GRAPH = {
    "nodes": [
        {"id": "prompt", "type": "inputText", "outputs": {"text": "a cat"}},
        {
            "id": "gen",
            "type": "imageGen",
            "data": {"model": "sdxl", "steps": 20},
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


class TestTopologicalSort:
    def test_linear_graph(self, solver):
        order = solver.topological_sort(
            [
                {"id": "a", "type": "inputText"},
                {"id": "b", "type": "imageGen"},
                {"id": "c", "type": "outputPlayer"},
            ],
            [
                {"source": "a", "target": "b"},
                {"source": "b", "target": "c"},
            ],
        )
        assert order == ["a", "b", "c"]

    def test_reverse_order(self, solver):
        order = solver.topological_sort(
            [
                {"id": "a", "type": "inputText"},
                {"id": "b", "type": "imageGen"},
            ],
            [],
        )
        assert order[0] in ("a", "b")

    def test_cycle_detected(self, solver):
        with pytest.raises(GraphValidationError, match="cycle"):
            solver.topological_sort(
                [
                    {"id": "a", "type": "inputText"},
                    {"id": "b", "type": "imageGen"},
                ],
                [
                    {"source": "a", "target": "b"},
                    {"source": "b", "target": "a"},
                ],
            )

    def test_single_node(self, solver):
        order = solver.topological_sort(
            [{"id": "a", "type": "inputText"}],
            [],
        )
        assert order == ["a"]

    def test_diamond_graph(self, solver):
        order = solver.topological_sort(
            [
                {"id": "a", "type": "inputText"},
                {"id": "b", "type": "imageGen"},
                {"id": "c", "type": "imageGen"},
                {"id": "d", "type": "outputPlayer"},
            ],
            [
                {"source": "a", "target": "b"},
                {"source": "a", "target": "c"},
                {"source": "b", "target": "d"},
                {"source": "c", "target": "d"},
            ],
        )
        assert order[0] == "a"
        assert order[-1] == "d"
        assert set(order[1:3]) == {"b", "c"}


class TestValidate:
    def test_valid_graph(self, solver):
        solver.validate(_VALID_GRAPH["nodes"], _VALID_GRAPH["edges"])

    def test_empty_nodes(self, solver):
        with pytest.raises(GraphValidationError, match="at least one node"):
            solver.validate([], [])

    def test_unknown_type(self, solver):
        with pytest.raises(GraphValidationError, match="Unknown node type"):
            solver.validate(
                [{"id": "x", "type": "invalid_type"}],
                [],
            )

    def test_missing_source(self, solver):
        with pytest.raises(GraphValidationError, match="not found"):
            solver.validate(
                [{"id": "a", "type": "inputText"}],
                [{"source": "ghost", "target": "a"}],
            )

    def test_missing_target(self, solver):
        with pytest.raises(GraphValidationError, match="not found"):
            solver.validate(
                [{"id": "a", "type": "inputText"}],
                [{"source": "a", "target": "ghost"}],
            )

    def test_video_gen_needs_input(self, solver):
        with pytest.raises(GraphValidationError, match="no input"):
            solver.validate(
                [
                    {"id": "v", "type": "videoGen", "data": {}},
                ],
                [],
            )

    def test_video_gen_with_input_is_valid(self, solver):
        solver.validate(
            [
                {"id": "img", "type": "imageGen", "data": {}, "outputs": {"image_path": ""}},
                {"id": "v", "type": "videoGen", "data": {}, "inputs": {"ref_image": ""}},
            ],
            [
                {"source": "img", "sourceOutput": "image_path", "target": "v", "targetInput": "ref_image"},
            ],
        )


class TestResolve:
    def test_resolve_returns_context(self, solver):
        ctx = solver.resolve(_VALID_GRAPH)
        assert ctx["graph_id"] == "unknown"
        assert ctx["order"] == ["prompt", "gen", "out"]
        assert set(ctx["nodes"].keys()) == {"prompt", "gen", "out"}
        assert "gen" in ctx["edges"]
        assert "out" in ctx["edges"]

    def test_resolve_fails_on_cycle(self, solver):
        with pytest.raises(GraphValidationError, match="cycle"):
            solver.resolve({
                "nodes": [
                    {"id": "a", "type": "inputText"},
                    {"id": "b", "type": "imageGen"},
                ],
                "edges": [
                    {"source": "a", "target": "b"},
                    {"source": "b", "target": "a"},
                ],
            })


class TestGetUpstreamValue:
    def test_get_upstream(self, solver):
        nodes = {"a": {"outputs": {"text": "hello"}}}
        edges = {"b": [{"source": "a", "sourceOutput": "text", "targetInput": "prompt"}]}
        val = solver.get_upstream_value("b", "prompt", nodes, edges)
        assert val == "hello"

    def test_no_upstream(self, solver):
        val = solver.get_upstream_value("a", "prompt", {}, {})
        assert val is None
