# AImotion Plan

AImotion is a **desktop-first** node workflow for generating animations and video from image, video, and prompt inputs. The application runs natively on the user's machine — a Python/FastAPI backend with a desktop UI shell.

The MVP is a **pragmatic modular monolith** built in 3 phases, each delivering real value before moving to the next. The priority is getting a real video generated with a local model on the user's RTX 3080 as fast as possible — then wrapping it in a polished desktop experience.

---

## Product Goal

Deliver a desktop-first node workflow where users can create animations and video content for advertising, cinema, and series production. The pipeline starts from a storyboard or animation planning video and allows character design through a dedicated image-generation sub-workflow. The final output is a video2video generation conditioned by reference imagery (character style), prompts, and optional audio.

The MVP must support local preview, a local-first runtime, and a provider layer that can later switch between cloud and local execution without changing the workflow model.

---

## Development Methodology: Pragmatic SpecDriven

The full **SpecSecOps** (SDD + DevSecOps) methodology is the long-term target, but for a solo developer with an RTX 3080, the process must be lightweight to avoid friction.

### Phase 1 & 2 — Lightweight SDD

Each change follows 3 phases:

| Phase | Purpose | Minimum Output |
|---|---|---|
| **Spec** | Define requirements, success criteria, and edge cases | Delta specification |
| **Implement** | Write code + tests | Working code + passing tests |
| **Verify** | Run tests, manual smoke test | Verification confirmed |

No adversarial reviews, no threat models, no security champions. Embedded security means: no secrets in code, validate all inputs, use safe defaults.

### Phase 3+ — Full SpecSecOps

Once the project has a working product and more contributors, graduate to the full 8-phase SpecSecOps pipeline with DevSecOps integration, adversarial reviews, and fresh-context verification.

### Rules

1. **Tests are mandatory.** Every backend module must have tests. No test == incomplete task.
2. **Security by default.** No secrets in code, validate all inputs, strip keys from logs.
3. **Scope discipline.** Each phase delivers ONE thing that works. No scope creep.

---

## Core Architecture

| Layer | Decision | Phase | Purpose |
|---|---|---|---|
| Frontend | **Minimal HTML/JS** (Phase 1) → **React + React Flow** (Phase 2) → **Tauri webview** (Phase 2+) | P1-P2 | Render and edit the node graph, show preview/export. Phase 1 uses a basic web UI; Tauri and React Flow come when the pipeline works. |
| Desktop Shell | **None** in Phase 1. **Tauri** (Rust) in Phase 2+ | P2+ | Native window management, local file system access, subprocess lifecycle, OS integration |
| Backend | **Python** with **FastAPI**, modular monolith, local service | P1 | Validate the graph, orchestrate generation, expose APIs |
| Inference Engine | **LTX-Video 2B** via diffusers (Phase 1). More models in Phase 2+ | P1+ | The central generation pipeline. LTX-Video is chosen because it fits in ~8 GB VRAM with FP8 and runs on RTX 3080. |
| Async Execution | Asyncio background tasks | P1 | Run generations without blocking the UI |
| Media Processing | **FFmpeg** (via subprocess) | P3 | Merge video and audio, transcode, preview generation |
| Testing | **pytest** with pytest-asyncio, coverage | P1 | All backend code must have tests; no untested code ships |
| Health | **`/health`** endpoint (liveness) | P1 | The backend reports its health for desktop shell lifecycle management |

### Architecture Diagram (Phase 2+ target)

```
┌─────────────────────────────────────────────────────┐
│                 Desktop Shell (Tauri)                │
│  ┌───────────────────────────────────────────────┐  │
│  │         Webview: React + React Flow           │  │
│  │  [Node Editor] → [Preview] → [Export]         │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ HTTP (localhost)               │
│  ┌──────────────────▼────────────────────────────┐  │
│  │         Python Backend (FastAPI sidecar)       │  │
│  │  ┌────────────────────────────────────────┐   │  │
│  │  │         Inference Engine               │   │  │
│  │  │  ┌─────────┐  ┌──────────────┐        │   │  │
│  │  │  │  VAE    │  │    Model     │        │   │  │
│  │  │  │ Encoder │→│  Denoise     │        │   │  │
│  │  │  │ Decoder │  │  (LTX/Cog/  │        │   │  │
│  │  │  │         │  │   Wan)      │        │   │  │
│  │  │  └─────────┘  └──────────────┘        │   │  │
│  │  └────────────────────────────────────────┘   │  │
│  │  /health → liveness                          │  │
│  │  /graph  → validate + resolve execution       │  │
│  │  /run    → dispatch generation                │  │
│  │  /export → FFmpeg muxing                      │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ Subprocess / API calls         │
│  ┌──────────────────▼────────────────────────────┐  │
│  │         Provider Layer                        │  │
│  │  [Cloud Adapters] [Local Model Runners]       │  │
│  │  LTX-Video · CogVideoX · Wan · Seedance · Kling │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Execution Layer

- **Local (Phase 1):** LTX-Video 2B via diffusers. Single model, single pipeline.
- **Local (Phase 2+):** More model runners: CogVideoX, Wan2.2 (via cloud or if VRAM allows), custom pipelines.
- **Cloud (Phase 2+):** API clients for Seedance, Runway, Kling, etc. through a provider abstraction.
- The provider abstraction allows switching between cloud and local without changing the workflow graph.

### Provider Abstraction Layer

All cloud providers and local runners share the same `Generation` node contract. The abstraction layer sits between the graph executor and the provider implementation. **Designed and built in Phase 2**, not before.

```
Graph Executor → [Provider Abstraction] → [Cloud Adapter A] → Seedance API
                                      → [Cloud Adapter B] → Kling API
                                      → [Local Runner] → LTX-Video / CogVideoX
```

**Adapter interface contract** (Phase 2):

| Concern | How It Works |
|---|---|
| **Capabilities reporting** | Each adapter exposes what input types it accepts, what params it supports, max resolution, max frames. The UI queries this to show/hide ports dynamically. |
| **Parameter mapping** | The graph stores generic params (steps, cfg, seed, denoising_strength, scheduler). Each adapter translates these to the provider's native API schema. |
| **Credential management** | API keys stored in OS credential manager (keyring, Tauri secure store). Never in graph JSON or config files. |
| **Progress reporting** | All adapters return a standard progress envelope for uniform UI consumption. |
| **Error normalization** | Provider errors mapped to canonical set: rate_limited, quota_exceeded, invalid_params, auth_failed, internal_error. |

This design means adding a new provider is just writing an adapter class — no graph changes, no UI changes (except maybe a logo). **But this is Phase 2 scope.** Phase 1 hardcodes the single local model.

---

## Hardware Reality

### Your Machine

| Component | Spec |
|---|---|
| GPU | **NVIDIA RTX 3080** (10 GB VRAM) |
| VRAM Budget | ~7-8 GB usable (OS + other apps) |
| System RAM | 64 GB |
| Storage | SSD NVMe |

### What This Means

- **Local models ≤2B params** at ≤512px with FP8 quantisation. That's LTX-Video 2B.
- **T5-XXL text encoder** must be CPU-offloaded (uses 11 GB+ on its own).
- **Larger models** (Wan2.2 14B, CogVideoX 5B) require cloud adapters or a better GPU.
- **FlashAttention** may not be available (RTX 3080 has compute capability 8.6). Fallback to xFormers memory-efficient attention.

---

## Delivery Phases

### Phase 1 — Real Generation with LTX-Video (4-6 weeks)

**Goal:** The user can open a web page, upload a video + prompt, and get a real generated video back from LTX-Video running locally.

| Deliverable | Details |
|---|---|
| Backend API | FastAPI with `/health`, `/generate` endpoint, async task management |
| LTX-Video integration | Load LTX-Video 2B via diffusers, VAE encode → denoise → VAE decode. FP8 quantisation, CPU offload for text encoder. |
| Minimal Web UI | Basic HTML/JS page (no framework). File upload for video, text input for prompt, submit button, preview player. No node graph yet. |
| Generation queue | Asyncio background task, basic progress polling |
| Testing | pytest with pytest-asyncio. Tests: `/health`, `/generate` contract, model loading, generation pipeline stub |
| Spec cycle | Lightweight SDD: spec → implement → verify |

**Exit criteria:**
- [ ] `GET /health` returns `{"status": "ok"}`
- [ ] `POST /generate` accepts video + prompt, returns a task ID
- [ ] `GET /generate/{task_id}` returns status, progress, and result URL when done
- [ ] LTX-Video generates a real video file on the RTX 3080 at 512px
- [ ] The web UI lets the user upload a file, enter a prompt, see progress, and play the result
- [ ] All backend modules have passing tests
- [ ] End-to-end test: upload → generate → preview works on the local machine

**What Phase 1 explicitly does NOT include:**
- No Tauri desktop shell
- No node graph editor (just a form)
- No provider abstraction layer
- No audio conditioning
- No ZIP ingestion
- No image input or reference conditioning
- No Group nodes
- No SpecSecOps (lightweight SDD only)

---

### Phase 2 — Desktop Shell + Graph Editor + More Models (6-8 weeks)

**Goal:** The user can create a node graph in a desktop app, run with multiple models, and optionally use a cloud provider.

| Deliverable | Details |
|---|---|
| Tauri desktop shell | Rust shell wrapping the React app. Sidecar management for the Python backend. |
| React + React Flow | Full node editor: Video Input, Image Input, Prompt Input, Generation, Sampling Parameters, Aspect & Resolution, Denoising Strength, Output, Group |
| Group nodes | Can be renamed, collapsed, expanded, moved as a unit. UI-only, flattened before execution. |
| Graph validation | Pydantic-based validation of the workflow JSON. DAG cycle detection, type checking of edges. |
| Graph execution engine | Resolve topological order, dispatch nodes in sequence, pass tensors between nodes. |
| Additional local models | CogVideoX-2B, plus detection logic for what fits in VRAM |
| First cloud provider | Seedance or Runway adapter. Simple API key in local config (credential manager deferred). |
| Provider abstraction | Adapter interface built, first two adapters (local + one cloud) proving the contract |
| Async worker | Proper background worker with progress reporting, cancellation |
| File handling | Video upload, temporary storage, basic cleanup |

**Exit criteria:**
- [ ] Tauri app opens a window showing the React Flow editor
- [ ] All 9 MVP node types can be placed, connected, configured
- [ ] Group nodes function correctly (rename, collapse, expand, move)
- [ ] Graph validation rejects invalid graphs (cycles, type mismatches, missing required connections)
- [ ] Graph execution engine resolves and dispatches a valid graph
- [ ] Local generation works with LTX-Video and CogVideoX-2B
- [ ] At least one cloud provider generates a video from the same graph
- [ ] SpecSecOps methodology introduced (lightweight still, but SDD phases documented)

---

### Phase 3 — Audio, Export, Model Installer, Polish (4-6 weeks)

**Goal:** The user can combine video + prompt + audio, export the final media, install new models from Hugging Face, and manage cloud provider credentials.

| Deliverable | Details |
|---|---|
| Audio conditioning | Whisper feature extraction → audio features passed to generation node |
| FFmpeg muxing | Merge generated video with audio track. Export MP4, GIF with configurable quality. |
| Credential manager | Encrypted local store for cloud API keys. UI to add, list, revoke per-provider credentials. |
| Local model installer | Paste a Hugging Face model ID → app downloads, verifies, detects model type, checks VRAM requirements, places in correct directory. Progress bar, pause/resume, delete, cache cleanup. |
| Cloud provider manager | UI to browse available providers, add/select API keys, view usage/quotas |
| Reference conditioning | IP-Adapter or ReferenceNet for character design → video2video workflows |
| Sub-workflow composition | Image gen sub-workflow feeds into video gen as reference image |
| Full SpecSecOps graduate | 8-phase SDD pipeline with DevSecOps, adversarial reviews, fresh-context verification |

---

## MVP Node Set

### Phase 1 Nodes (form-based, no graph)

| "Node" | Implementation |
|---|---|
| Video Input | File upload field |
| Prompt Input | Text area |
| Generation | Single hardcoded LTX-Video pipeline |
| Output | Video preview player + download |

### Phase 2+ Full Node Set

| Node | Responsibility |
|---|---|
| Video Input | Accept a source video file or image sequence. Load video, decode frames to tensor. Support ZIP for frame batches. |
| Image Input | Accept a single image for character design or reference style. Load image to tensor. |
| Audio Input | Accept an audio file for conditioning. Load audio, extract features via Whisper. **Phase 3** |
| Prompt Input | Accept positive and negative textual guidance. |
| Generation | Execute the selected model with all connected inputs. Core pipeline: VAE encode → denoise → VAE decode. Accepts denoising_strength and optional reference_image. |
| Sampling Parameters | Steps, CFG Scale, Seed, Scheduler type. |
| Aspect and Resolution | Resolution, Aspect Ratio, Duration, FPS. Native aspect ratio bucketing (no forced crop). |
| Denoising Strength | Float 0.0–1.0 for mutation control. |
| Output | Preview and export the final result. Merge audio + video, export MP4 or GIF. |
| Group | Visual container for sub-workflows. Can be renamed, collapsed, expanded. Does not affect execution order. |

---

## Workflow Contract

The frontend sends a graph description to the backend. The backend validates the graph, resolves node order, and dispatches execution. The graph is a full DAG — any node type can feed into any compatible input port.

**Phase 1 contract** (simple, no graph):
```json
{
  "video_url": "uploads/storyboard.mp4",
  "prompt": "cinematic action scene",
  "negative_prompt": "flickering, deformed faces",
  "width": 512,
  "height": 512,
  "steps": 25,
  "cfg": 7.5,
  "seed": 42
}
```

**Phase 2+ contract** (full graph DAG, same as original plan):
```json
{
  "graph_id": "character_animation_01",
  "nodes": [
    { "id": "storyboard", "type": "video_input", "data": { "url": "uploads/storyboard.mp4" } },
    { "id": "prompt", "type": "prompt_input", "data": { "positive": "...", "negative": "..." } },
    { "id": "sampling", "type": "sampling_params", "data": { "steps": 25, "cfg": 7.5, "seed": 42 } },
    { "id": "gen", "type": "generation", "data": { "provider": "local", "model": "ltx-video-2b" } },
    { "id": "output", "type": "output", "data": { "format": "mp4" } }
  ],
  "edges": [
    { "source": "storyboard", "sourceOutput": "video_tensor", "target": "gen", "targetInput": "video_input" },
    { "source": "prompt", "sourceOutput": "positive_prompt", "target": "gen", "targetInput": "positive_prompt" },
    { "source": "sampling", "sourceOutput": "params", "target": "gen", "targetInput": "sampling_params" },
    { "source": "gen", "sourceOutput": "video_output", "target": "output", "targetInput": "video_in" }
  ]
}
```

### Data Types

| Port Type | Internal Representation |
|---|---|
| video_tensor | `torch.Tensor [F, C, H, W]` |
| image_tensor | `torch.Tensor [1, C, H, W]` |
| audio_features | `torch.Tensor [1, D]` |
| prompt | `str` |
| generation_params | `dict` (steps, cfg, seed, denoising_strength, scheduler) |

---

## Software Requirements

| Component | Version |
|---|---|
| OS | Windows 10+ (primary dev target); Linux support via Tauri |
| GPU Drivers | CUDA Toolkit 12.1+ |
| Deep Learning | PyTorch 2.3+ with `torch.compile` support |
| Attention | xFormers (Phase 1). FlashAttention-2/3 if available (Phase 2+) |
| Optimisation | bitsandbytes (FP8 quantisation) |
| Generative | Hugging Face `diffusers`, `transformers`, `accelerate` |
| Text Encoder | T5-XXL (CPU-offloaded in Phase 1) |
| Scheduler | Flow Matching (LTX-Video native) |
| Media | FFmpeg (Phase 3) |

---

## Technical Scope Boundaries

### In Scope

- Phase 1: FastAPI backend + LTX-Video 2B generation + minimal web UI + pytest
- Phase 2: Tauri desktop shell + React Flow node editor + graph validation + cloud provider adapter + more local models
- Phase 3: Audio conditioning + FFmpeg export + credential manager + local model installer + reference conditioning + sub-workflows
- Group nodes for visual organisation (Phase 2)
- Provider abstraction layer with capabilities reporting (Phase 2)
- SpecSecOps graduated to full methodology (Phase 3)
- Aspect Ratio Bucketing (no forced resize)

### Out of Scope (MVP)

- Marketplace features or user plugin system
- Advanced automation or fully autonomous flows
- 3D or FBX export
- Browser/web deployment (the app is desktop-only)
- Fine-tuning / LoRA training UI (inference only)
- Multi-user or collaboration features
- Native installer (beyond Tauri's built-in bundler)

---

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| LTX-Video 2B quality is insufficient for production use | Phase 1 validates quality. If inadequate, pivot to cloud-only for video gen and keep local for preview. |
| RTX 3080 10 GB is too tight even for LTX-Video | FP8 quantisation, CPU offload text encoder, reduce max resolution to 384px. If still OOM, fall back to cloud adapters in Phase 2. |
| Tauri sidecar lifecycle is complex | Phase 1 avoids it entirely. When adding Tauri, use health endpoint for liveness checks with restart logic. |
| Long-running generation blocks the UI | Async worker with progress polling from Phase 1. |
| AI provider API changes break the adapter | Pin provider API versions where possible. Adapter interface versioned (Phase 2+). |
| VRAM exhaustion with multiple models loaded | Load one model at a time. Unload before switching. Model manager enforces this. |
| SpecSecOps overhead slows solo development | Lightweight 3-phase SDD for Phase 1-2. Full SpecSecOps only in Phase 3+ when project has traction. |

---

## Final Recommendation

Build AImotion in 3 pragmatic phases, each delivering real value:

1. **Phase 1 (now):** FastAPI + LTX-Video 2B + minimal web UI. Get a real video generated on your RTX 3080 within weeks, not months. No graph, no Tauri, no providers.

2. **Phase 2:** Tauri + React Flow + full node graph + graph validation + cloud provider. Turn the form into a real editor and add execution options.

3. **Phase 3:** Audio + export + model installer + reference conditioning + full SpecSecOps. Polish and scale.

Don't try to build what a team of 4 would build. Build what ONE person with an RTX 3080 can ship. Validate the core pipeline first, then wrap it in the dream UI.
