# AImotion Agent Instructions

## Project Direction

- Build AImotion as a **desktop-first** node workflow for animation and video generation.
- MVP is a **pragmatic modular monolith** built in 3 phases, each delivering real value.
- Phase 1 priority: get a real video generated with LTX-Video 2B on the user's RTX 3080 FAST. No graph, no Tauri, no providers.
- Phase 2: Tauri + React Flow + full node graph + first cloud provider.
- Phase 3: Audio + export + model installer + reference conditioning + full SpecSecOps.

## Development Methodology

- **Phase 1-2:** Lightweight SDD (Spec → Implement → Verify). No adversarial reviews, no threat models.
- **Phase 3+:** Graduate to full SpecSecOps (8-phase SDD + DevSecOps).
- **Tests are mandatory.** Every backend module must have tests. No test == incomplete task.
- **Security by default.** No secrets in code, validate all inputs, strip keys from logs.

## Architecture

- Phase 1: Python/FastAPI backend + LTX-Video 2B via diffusers + minimal HTML/JS web UI on localhost.
- Phase 2: Tauri (Rust) desktop shell + React + React Flow node editor.
- Backend: modular monolith, local service, asyncio background tasks.
- Inference: LTX-Video 2B with FP8 quantisation, CPU-offloaded T5-XXL.
- Media: FFmpeg via subprocess (Phase 3).

## Hardware Reality

- GPU: NVIDIA RTX 3080 (10 GB VRAM). ~7-8 GB usable.
- Local models: ≤2B params at ≤512px with FP8 quantisation. LTX-Video 2B is the target.
- Larger models (Wan2.2, CogVideoX 5B+) require cloud adapters.

## MVP Node Set Evolution

- Phase 1: Form-based (video upload + prompt + generate + preview). No node graph.
- Phase 2: Full node editor with Video Input, Image Input, Prompt Input, Generation, Sampling Parameters, Aspect & Resolution, Denoising Strength, Output, Group.
- Phase 3: Audio Input, reference conditioning, sub-workflow composition.

## Delivery Phases

- Phase 1 (4-6 weeks): FastAPI + LTX-Video + minimal UI + pytest. Real video generation.
- Phase 2 (6-8 weeks): Tauri + React Flow + graph validation + cloud provider + more local models.
- Phase 3 (4-6 weeks): Audio + FFmpeg + credential manager + model installer + full SpecSecOps.

## Non-Negotiable Rules

- **Tests are mandatory.** Every backend module must have tests.
- **Security by default.** No secrets in code, validate all inputs.
- **Scope discipline.** Each phase delivers ONE thing that works. No scope creep.
- **Validate the pipeline first.** Real generation before graph editor or desktop shell.
