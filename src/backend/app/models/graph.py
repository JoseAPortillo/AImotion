from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Union


class NodeType(str, Enum):
    IMAGE_INPUT = "image_input"
    VIDEO_INPUT = "video_input"
    PROMPT_INPUT = "prompt_input"
    GENERATION = "generation"
    AUDIO = "audio"
    OUTPUT_VIDEO = "output_video"


@dataclass
class Position:
    x: float = 0.0
    y: float = 0.0


@dataclass
class ImageInputData:
    node_type: Literal[NodeType.IMAGE_INPUT] = NodeType.IMAGE_INPUT
    url: str | None = None
    zip_url: str | None = None
    frame_start: int = 1
    frame_step: int = 1


@dataclass
class VideoInputData:
    node_type: Literal[NodeType.VIDEO_INPUT] = NodeType.VIDEO_INPUT
    url: str | None = None


@dataclass
class PromptInputData:
    node_type: Literal[NodeType.PROMPT_INPUT] = NodeType.PROMPT_INPUT
    text: str = ""


@dataclass
class GenerationData:
    node_type: Literal[NodeType.GENERATION] = NodeType.GENERATION
    provider: str = "simulated"
    model: str = ""
    steps: int = 25
    cfg: float = 7.5
    width: int = 1024
    height: int = 576


@dataclass
class AudioData:
    node_type: Literal[NodeType.AUDIO] = NodeType.AUDIO
    url: str | None = None


@dataclass
class OutputVideoData:
    node_type: Literal[NodeType.OUTPUT_VIDEO] = NodeType.OUTPUT_VIDEO
    format: str = "mp4"
    resolution: str = "1080p"


NodeData = ImageInputData | VideoInputData | PromptInputData | GenerationData | AudioData | OutputVideoData


@dataclass
class WorkflowNode:
    id: str
    type: NodeType
    data: NodeData
    position: Position = field(default_factory=Position)


@dataclass
class WorkflowEdge:
    source: str
    sourceOutput: str
    target: str
    targetInput: str


@dataclass
class WorkflowGraph:
    graph_id: str
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]


@dataclass
class ExecutionRequest:
    graph: WorkflowGraph


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ExecutionResponse:
    graph_id: str
    status: ExecutionStatus = ExecutionStatus.PENDING
    result_url: str | None = None
    error: str | None = None
