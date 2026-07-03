import logging
from typing import Any

logger = logging.getLogger(__name__)


class GraphValidationError(Exception):
    pass


class GraphSolver:
    def topological_sort(self, nodes: list[dict], edges: list[dict]) -> list[str]:
        in_degree: dict[str, int] = {}
        adjacency: dict[str, list[str]] = {}

        for node in nodes:
            nid = node["id"]
            in_degree[nid] = 0
            adjacency[nid] = []

        for edge in edges:
            source = edge["source"]
            target = edge["target"]
            adjacency[source].append(target)
            in_degree[target] = in_degree.get(target, 0) + 1

        queue = [nid for nid, deg in in_degree.items() if deg == 0]
        sorted_ids = []

        while queue:
            nid = queue.pop(0)
            sorted_ids.append(nid)
            for neighbor in adjacency[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(sorted_ids) != len(nodes):
            raise GraphValidationError("Graph contains a cycle")

        return sorted_ids

    def validate(self, nodes: list[dict], edges: list[dict]):
        if not nodes:
            raise GraphValidationError("Graph must have at least one node")

        node_ids = {n["id"] for n in nodes}
        valid_types = {"inputText", "imageGen", "videoGen", "outputPlayer"}

        for node in nodes:
            ntype = node.get("type", "")
            if ntype not in valid_types:
                raise GraphValidationError(
                    f"Unknown node type '{ntype}' in node '{node['id']}'. "
                    f"Valid: {', '.join(sorted(valid_types))}"
                )

        for edge in edges:
            if edge["source"] not in node_ids:
                raise GraphValidationError(f"Edge source '{edge['source']}' not found in nodes")
            if edge["target"] not in node_ids:
                raise GraphValidationError(f"Edge target '{edge['target']}' not found in nodes")

        for node in nodes:
            ntype = node.get("type", "")
            nid = node["id"]
            if ntype == "videoGen":
                has_input = any(e["target"] == nid for e in edges)
                if not has_input:
                    raise GraphValidationError(f"videoGen node '{nid}' has no input connections")

    def resolve(self, graph: dict) -> dict[str, Any]:
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])

        self.validate(nodes, edges)
        order = self.topological_sort(nodes, edges)

        nodes_by_id = {n["id"]: n for n in nodes}
        edges_by_target: dict[str, list[dict]] = {}
        for edge in edges:
            edges_by_target.setdefault(edge["target"], []).append(edge)

        return {
            "graph_id": graph.get("graph_id", "unknown"),
            "order": order,
            "nodes": nodes_by_id,
            "edges": edges_by_target,
        }

    @staticmethod
    def get_upstream_value(
        node_id: str,
        target_input: str,
        nodes: dict[str, dict],
        edges: dict[str, list[dict]],
    ) -> Any:
        incoming = edges.get(node_id, [])
        for edge in incoming:
            if edge["targetInput"] == target_input:
                source = edge["source"]
                source_output = edge["sourceOutput"]
                source_node = nodes.get(source, {})
                return source_node.get("outputs", {}).get(source_output)
        return None

    @staticmethod
    def get_data(node: dict, key: str, default: Any = None) -> Any:
        data = node.get("data", {})
        inputs = node.get("inputs", {})
        return data.get(key) or inputs.get(key) or default
