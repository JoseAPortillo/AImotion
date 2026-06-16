# AImotion Agent Instructions

Load [AImotion main skill](.github/skills/aimotion-main/SKILL.md) for project-wide planning and implementation decisions.

Load [AImotion agent](.github/agents/aimotion.agent.md) when you want the project-specific agent behavior and scope guardrails.

## Project Direction

- Build AImotion as a web-first node workflow for animation and video planning.
- Keep the system as a modular monolith with a decoupled backend.
- Treat the frontend as a graph editor, not as a place for heavy AI processing.
- Prefer REST for the MVP unless the UI clearly requires a different API style.

## MVP Architecture

- Frontend: React with React Flow or Litegraph.js.
- Backend: **Python** with FastAPI and a modular monolith structure.
- Async execution: Celery + Redis.
- Provider layer: cloud APIs plus local bridges such as ComfyUI or Ollama.
- Media processing: FFmpeg for audio/video muxing.

## Execution Layer Rules

- Cloud providers should connect through API clients to services such as Kling and Stability AI.
- Local execution should use API bridges such as Ollama or ComfyUI in API mode.
- Do not build a native local installer before the MVP proves the provider abstraction.
- Keep provider adapters replaceable so execution targets can change without redesigning the graph editor.

## MVP Node Set

- Image Input: accept a single image or an image sequence; read the first frame and continue by consecutive numbering, or accept a ZIP for frame batches.
- Video Input: accept a source video file.
- Prompt Input: accept textual guidance.
- Generation: resolve provider, model, and generation parameters dynamically based on connected inputs.
- Audio: attach an audio track for later muxing.
- Output: preview and export the final result as MP4 or GIF.

## Delivery Phases

- Phase 1: graph editor, workflow JSON, graph validation, and simulated generation.
- Phase 2: async jobs, progress reporting, ZIP/video ingestion, and cloud provider integration.
- Phase 3: FFmpeg muxing, export controls, local bridge support, and a lightweight model manager.

## Non-Negotiable Rules

- Keep local preview in the MVP.
- Support DevSecOps from the start: security checks, secrets management, access control, and observability are part of the normal flow.
- Validate the workflow graph before execution.
- Make the image sequence flow efficient for web usage; do not rely on one-file-at-a-time uploads for long sequences.
- Keep scope focused on the six core MVP nodes and avoid marketplace or advanced automation features.