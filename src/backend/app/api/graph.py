import os
import json
import logging
import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.generate import TaskInfo, TaskStatus
from app.services.task_manager import TaskManager
from app.services.generator import extract_frames, get_model_config
from app.services.graph_solver import GraphSolver, GraphValidationError
from app.services.runners.base import GenerateParams
from app.services.runners.registry import RunnerRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["graph"])

task_manager = TaskManager()
solver = GraphSolver()


_GEN_NODE_TYPES = {"imageGen", "videoGen", "textToImage", "textToVideo", "imageToVideo", "videoToVideo", "imageToImage", "runwayVideoToVideo", "runwayImageToVideo"}

def _find_node_by_type(ctx: dict, ntype: str) -> dict | None:
    for nid in ctx["order"]:		
        node = ctx["nodes"][nid]		
        if node.get("type") == ntype:		
            return node		
    return None		

def _find_gen_node(ctx: dict) -> dict | None:
    for nid in ctx["order"]:
        node = ctx["nodes"][nid]
        if node.get("type") in _GEN_NODE_TYPES:
            return node
    return None


def _resolve_prompt(ctx: dict) -> str:
    text_node = _find_node_by_type(ctx, "inputText")
    if text_node is None:
        return ""
    return text_node.get("outputs", {}).get("text", "")


def _resolve_input(
    node_id: str,
    target_input: str,
    ctx: dict,
    node_outputs: dict[str, Any],
) -> Any:
    incoming = ctx["edges"].get(node_id, [])
    for edge in incoming:
        if edge["targetInput"] == target_input:
            source = edge["source"]
            source_output = edge["sourceOutput"]
            return node_outputs.get(source, {}).get(source_output)
    return None


def _graph_to_generation_params(graph: dict, ctx: dict) -> dict:
    gen_node = _find_gen_node(ctx)
    if gen_node is None:
        raise HTTPException(status_code=422, detail="Graph must have a generation node (textToImage, videoGen, etc.)")

    data = gen_node.get("data", {})
    is_video = gen_node.get("type") == "videoGen"
    prompt = _resolve_prompt(ctx)
    motion_prompt = data.get("motion_prompt", "")

    prompt_text = f"{prompt} {motion_prompt}".strip() or ""
    gen_defaults = {
        "width": data.get("width", 720),
        "height": data.get("height", 480),
        "steps": data.get("steps", 50),
        "cfg": data.get("cfg", 6.0),
        "seed": data.get("seed", 0),
        "strength": data.get("strength", 0.8),
        "scheduler": data.get("scheduler", ""),
        "model": data.get("model", settings.model_type),
    }

    params = {
        "prompt": prompt_text,
        "negative_prompt": data.get("negative_prompt", ""),
        "width": gen_defaults["width"],
        "height": gen_defaults["height"],
        "steps": gen_defaults["steps"],
        "cfg": gen_defaults["cfg"],
        "seed": gen_defaults["seed"],
        "strength": gen_defaults["strength"],
        "scheduler": gen_defaults["scheduler"],
        "model": gen_defaults["model"],
        "execution_mode": data.get("execution_mode", "local"),
    }

    for key in (
        "num_frames", "max_sequence_length", "decode_chunk_size",
        "noise_aug_strength", "min_guidance_scale", "max_guidance_scale",
        "fps", "motion_bucket_id",
    ):
        if key in data:
            params[key] = data[key]

    extra = {}
    for key, value in data.items():
        if key not in params and key not in (
            "execution_mode", "motion_prompt", "api_key_env", "precision",
        ):
            extra[key] = value
    params["extra"] = extra

    return params


async def _execute_graph(task_id: str, graph: dict):
    try:
        ctx = solver.resolve(graph)
        task = await task_manager.get_task(task_id)
        if task is None or task.cancel_event.is_set():
            return

        nodes = ctx["nodes"]
        order = ctx["order"]
        node_outputs: dict[str, dict[str, Any]] = {}

        model_cfg = None
        gen_node = _find_gen_node(ctx)
        if gen_node:
            model = gen_node.get("data", {}).get("model", settings.model_type)
            model_cfg = get_model_config(model)
            if model_cfg:
                d = model_cfg["defaults"]
                steps_total = gen_node.get("data", {}).get("steps", d.get("steps", 50))
                await task_manager.set_running(task_id, steps_total)

        async def progress_callback(current: int, total: int):
            if task and task.cancel_event.is_set():
                raise asyncio.CancelledError("Generation cancelled by user")
            await task_manager.set_progress(task_id, current, total)

        for nid in order:
            node = nodes[nid]
            ntype = node.get("type", "")
            logger.info(f"Executing node: {nid} ({ntype})")

            if ntype == "inputText":
                node_outputs[nid] = node.get("outputs", {})

            elif ntype in _GEN_NODE_TYPES:
                params = _graph_to_generation_params(graph, ctx)

                video_frames = None
                resolved_video = _resolve_input(nid, "video_in", ctx, node_outputs)
                resolved_image = resolved_video or \
                    _resolve_input(nid, "image_in", ctx, node_outputs) or \
                    _resolve_input(nid, "ref_image", ctx, node_outputs) or \
                    _resolve_input(nid, "image", ctx, node_outputs)
                if resolved_video and os.path.exists(str(resolved_video)):
                    from app.services.generator import extract_frames
                    video_frames = extract_frames(str(resolved_video), max_frames=params.get("num_frames", 49))
                elif resolved_image and os.path.exists(str(resolved_image)):
                    from PIL import Image as PILImage
                    video_frames = [PILImage.open(str(resolved_image)).convert("RGB")]

                runner = _get_runner(params["model"])
                extra = params.get("extra", {})
                if resolved_video:
                    extra["video_path"] = str(resolved_video)
                if resolved_image:
                    extra["image_path"] = str(resolved_image)
                gen_params = GenerateParams(
                    prompt=params["prompt"],
                    negative_prompt=params.get("negative_prompt", ""),
                    video_frames=video_frames,
                    strength=params.get("strength", 0.8),
                    width=params["width"],
                    height=params["height"],
                    steps=params["steps"],
                    cfg=params["cfg"],
                    seed=params["seed"],
                    scheduler=params.get("scheduler"),
                    model=params["model"],
                    num_frames=params.get("num_frames"),
                    max_sequence_length=params.get("max_sequence_length"),
                    decode_chunk_size=params.get("decode_chunk_size"),
                    noise_aug_strength=params.get("noise_aug_strength"),
                    min_guidance_scale=params.get("min_guidance_scale"),
                    max_guidance_scale=params.get("max_guidance_scale"),
                    fps=params.get("fps"),
                    motion_bucket_id=params.get("motion_bucket_id"),
                    extra=extra,
                )

                result = await runner.generate(
                    gen_params, progress_callback, cancel_event=task.cancel_event if task else None,
                )
                node_outputs[nid] = {"image_path": result.url, "video_path": result.url}
                result_type = "image" if result.url.endswith(".png") else "video"
                await task_manager.complete_task(task_id, result.url, result_type)

            elif ntype == "outputPlayer":
                incoming = ctx["edges"].get(nid, [])
                for edge in incoming:
                    source_out = node_outputs.get(edge["source"], {})
                    for key, val in source_out.items():
                        logger.info(f"Output {nid}: {edge['source']}.{key} = {val}")

    except asyncio.CancelledError:
        logger.info(f"Graph task {task_id} was cancelled")
        await task_manager.cancel_task(task_id)
    except GraphValidationError as e:
        await task_manager.fail_task(task_id, f"Graph validation failed: {e}")
    except Exception as e:
        logger.exception(f"Graph task {task_id} failed")
        await task_manager.fail_task(task_id, str(e))


def _get_runner(model_key: str):
    from app.services.model_catalog import catalog
    variant = catalog.get_variant(model_key)
    family = variant.family if variant else None
    runner_key = family.runner if family else "diffusers"

    runner = RunnerRegistry.get(runner_key)
    if runner is not None:
        return runner

    if runner_key != "diffusers":
        raise ValueError(
            f"Runner '{runner_key}' is required for model '{model_key}' "
            f"but is not installed or registered."
        )

    runner = RunnerRegistry.get("diffusers")
    if runner is None:
        raise ValueError("Default runner 'diffusers' is not registered.")
    return runner


@router.post("/execute", status_code=202)
async def execute_graph(graph: dict):
    try:
        ctx = solver.resolve(graph)
    except GraphValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    params = _graph_to_generation_params(graph, ctx)
    task_id = await task_manager.create_task(params)
    asyncio.create_task(_execute_graph(task_id, graph))
    return TaskInfo(task_id=task_id, status=TaskStatus.PENDING).__dict__


@router.get("/tasks/{task_id}")
async def get_graph_task_status(task_id: str):
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()


@router.delete("/tasks/{task_id}")
async def cancel_graph_task(task_id: str):
    task = await task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
        return {"status": task.status.value}
    await task_manager.cancel_task(task_id)
    return {"status": "cancelling"}
